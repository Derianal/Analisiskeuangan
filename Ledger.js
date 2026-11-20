/**
 * PUSAT KEUANGAN — LABA RUGI PER TOKO (harian)
 *
 * Sumber penjualan:
 *  - TikTok Shop API : TTS_Orders (nilai pesanan = sub_total), TTS_OrderLines (HPP per seller SKU),
 *                      TTS_Finance (potongan platform & ongkir per pesanan), TTS_Returns (refund).
 *  - KasirKu / manual: sheet Transactions yang sudah punya Store Code.
 *  - Shopee          : menyusul setelah API Shopee aktif.
 * Biaya (sheet FinCosts): Gaji, Operasional, Iklan, Pajak — per toko, atau biaya bersama yang dibagi
 * dengan aturan tercatat (porsi omzet / rata). Gaji/operasional/pajak bulanan diakui rata per hari (akrual).
 *
 * Aturan:
 *  - Data yang belum tersedia TIDAK dianggap 0: HPP kosong & potongan platform yang belum settle
 *    ditandai, dan laba toko itu berstatus BELUM FINAL.
 *  - Biaya kantor lama (level Cabang/Pusat) tidak dibagi otomatis ke toko; ditampilkan terpisah.
 *  - Semua pembacaan dibatasi akses toko pengguna.
 */
const PL_GROUPS = ['Gaji', 'Operasional', 'Iklan', 'Pajak'];
const PL_CATEGORIES = {
  Gaji: ['Gaji staf toko', 'Gaji admin bersama', 'Bonus/komisi', 'Lembur'],
  Operasional: ['Packing & lakban', 'Sewa tempat', 'Listrik & air', 'Internet', 'Transportasi', 'Perlengkapan', 'Lainnya'],
  Iklan: ['GMV Max', 'Shopee Ads', 'Iklan TikTok lainnya', 'Iklan lainnya'],
  Pajak: ['PPh Final UMKM 0,5%', 'PPh 22 dipotong marketplace', 'PPh 21 karyawan', 'PPN (jika PKP)', 'PBB', 'Pajak reklame', 'Pajak lainnya']
};
const PL_SKU_HEADERS = ['Kode Toko', 'Seller SKU', 'Nama', 'HPP', 'Berlaku Mulai', 'Dicatat Oleh', 'Dicatat Pada'];
// CEK DOKUMENTASI: status retur TikTok yang berarti uang sudah dikembalikan ke pembeli.
const PL_REFUND_DONE = /COMPLETE|REFUNDED|SUCCESS/i;

function plToday_() { return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd'); }
function plDates_(end, n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(finAddDays_(end, -i)); return out; }
function plSheetRows_(name, width) {
  const sh = getDatabase_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
}
function plSkuSheet_() {
  const ss = getDatabase_();
  let sh = ss.getSheetByName('HPP_SKU');
  if (!sh) sh = ss.insertSheet('HPP_SKU');
  if (!sh.getLastRow()) { sh.appendRow(PL_SKU_HEADERS); sh.setFrozenRows(1); }   // sheet ada tapi kosong → tulis judul
  return sh;
}
/** HPP per SKU dengan riwayat: yang dipakai = HPP terbaru yang berlaku pada tanggal transaksi. */
/** Kunci SKU: huruf besar, tanpa spasi berlebih (spasi ganda/di ujung sering terbawa dari Excel). */
function plSkuKey_(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toUpperCase(); }
/** SKU baris pesanan untuk HPP. Bila Seller SKU kosong di marketplace, pakai ID varian (TikTok sku_id / Shopee model_id). */
function plLineSku_(src, r, noIdFallback) {
  const map = typeof skuMapIndex_ === 'function' ? skuMapIndex_() : {};
  if (src === 'tts') {
    const mapped = map[skuMapKeyTts_(r[9])]; if (mapped) return mapped;   // pemetaan di aplikasi didahulukan
    return String(r[10] || '').trim() || (noIdFallback ? '' : String(r[9] || '').trim());
  }
  const mappedSp = map[skuMapKeySp_(r[7], r[8])]; if (mappedSp) return mappedSp;
  return String(r[10] || r[9] || '').trim() || (noIdFallback ? '' : String(r[8] && String(r[8]) !== '0' ? r[8] : r[7] || '').trim());
}
function plLineName_(product, variant) { const p = String(product || '').slice(0, 70), v = String(variant || ''); return p + (v ? ' — ' + v : ''); }
function plSkuIndex_() {
  const idx = {};
  plSheetRows_('HPP_SKU', PL_SKU_HEADERS.length).forEach(function(r) {
    const store = String(r[0] || '*').trim().toUpperCase() || '*', sku = plSkuKey_(r[1]);
    const cost = numOrNull_(r[3]), from = finDate_(r[4]) || '2000-01-01';
    if (!sku || cost === null) return;
    (idx[store + '|' + sku] = idx[store + '|' + sku] || []).push({ from: from, cost: cost });
  });
  Object.keys(idx).forEach(function(k) { idx[k].sort(function(a, b) { return a.from < b.from ? -1 : 1; }); });
  return function(store, sku, date) {
    // HPP khusus toko dipakai bila ada untuk tanggal itu; kalau tidak, pakai HPP "Semua toko".
    const k = plSkuKey_(sku);
    const at = function(list) { let hit = null; (list || []).forEach(function(x) { if (x.from <= date) hit = x.cost; }); return hit; };
    const own = at(idx[store + '|' + k]);
    return own !== null ? own : at(idx['*|' + k]);
  };
}
function plSaveSkuCost_(p) {
  p = p || {};
  const store = String(p.storeCode || '*').trim().toUpperCase() || '*';
  if (store === '*') assertAllStoresScope_('HPP untuk semua toko'); else requireStoreCode_(store);
  const sku = String(p.sku || '').trim();
  if (!sku) throw new Error('Isi seller SKU (kode SKU yang sama dengan di marketplace).');
  const cost = finNum_(p.cost);
  if (cost === null || cost < 0) throw new Error('HPP harus angka 0 atau lebih.');
  const from = finDate_(p.from || plToday_());
  if (!from) throw new Error('Tanggal berlaku tidak valid.');
  const row = [store, sku, String(p.name || '').slice(0, 200), cost, from, currentActorEmail_(), new Date()];
  withScriptLock_(function() { plSkuSheet_().appendRow(row); });
  plMarkDirty_(from); // laba sejak tanggal berlaku HPP dihitung ulang
  auditChange_('sku-cost', 'HPP_SKU', store + '|' + sku, null, row);
  return { ok: true, message: 'HPP ' + sku + ' (' + (store === '*' ? 'semua toko' : store) + ') = ' + cost + ' berlaku mulai ' + from + '. HPP lama tetap dipakai untuk transaksi sebelum tanggal itu.' };
}
function plListSku_(p) {
  p = p || {};
  const scope = allowedStoreList_();
  return plSheetRows_('HPP_SKU', PL_SKU_HEADERS.length).filter(function(r) {
    const st = String(r[0] || '*').toUpperCase();
    if (p.storeCode && st !== String(p.storeCode).toUpperCase() && st !== '*') return false;
    return !scope || st === '*' || scope.indexOf(st) >= 0;
  }).map(function(r) { return { storeCode: String(r[0] || '*'), sku: String(r[1]), name: String(r[2] || ''), cost: numOrNull_(r[3]), from: finDate_(r[4]), by: String(r[5] || '') }; }).reverse();
}

/* ---------------- Biaya per toko ---------------- */
/** Baca biaya dari FinCosts (termasuk baris lama) dalam bentuk seragam. */
function plCosts_() {
  const W = FIN_SHEETS.FinCosts.length;
  return finRows_('FinCosts').filter(function(r) { return r[0] && String(r[9]) !== 'DIBATALKAN'; }).map(function(r) {
    const cat = String(r[4] || ''), level = String(r[2] || '');
    let group = String(r[12] || '');
    if (PL_GROUPS.indexOf(group) < 0) group = /iklan/i.test(cat) ? 'Iklan' : /gaji/i.test(cat) ? 'Gaji' : /pajak|pph|ppn|pbb/i.test(cat) ? 'Pajak' : 'Operasional';
    const days = Math.max(1, Math.min(366, Number(r[13]) || (group === 'Iklan' ? 1 : 30)));
    return { id: String(r[0]), date: finDate_(r[1]), level: level, code: String(r[3] || '').trim().toUpperCase(), cat: cat, amount: finNum_(r[5]),
      note: String(r[6] || ''), by: String(r[7] || ''), group: group, days: days, rule: String(r[14] || ''),
      stores: String(r[15] || '').split(',').map(function(x) { return x.trim().toUpperCase(); }).filter(Boolean), width: W };
  }).filter(function(c) { return c.date && c.amount !== null; });
}
/**
 * Simpan biaya. Satu toko: {storeCode}. Biaya bersama: {shared:true, rule:'omzet'|'rata', stores:[...]} (Owner/Keuangan).
 * group: Gaji/Operasional/Iklan/Pajak. spread: 'bulanan' (30 hari) | 'sekali' (1 hari). Iklan selalu 1 hari.
 */
function plSaveCost_(p) {
  p = p || {};
  const date = finDate_(p.date);
  if (!date) throw new Error('Tanggal biaya tidak valid.');
  const group = String(p.group || '');
  if (PL_GROUPS.indexOf(group) < 0) throw new Error('Pilih jenis biaya: Gaji, Operasional, Iklan, atau Pajak.');
  const cat = String(p.category || '').trim().slice(0, 80);
  if (!cat) throw new Error('Pilih rincian biaya.');
  const amount = finNum_(p.amount);
  if (amount === null || amount <= 0) throw new Error('Nominal harus lebih dari 0.');
  const days = group === 'Iklan' ? 1 : (p.spread === 'sekali' ? 1 : 30);
  let level, code, rule = '', stores = [];
  if (p.target === 'cabang' || p.target === 'pusat') {
    assertAllStoresScope_(p.target === 'cabang' ? 'Biaya cabang' : 'Biaya pusat');
    rule = p.rule === 'rata' ? 'rata' : 'omzet';
    if (p.target === 'cabang') {
      const br = String(p.branch || '').trim().toUpperCase();
      if (!br || !finStoresFromRows_(finRows_('FinStores')).some(function(s) { return s.active && String(s.branch || '').trim().toUpperCase() === br; })) throw new Error('Cabang ' + (br || '(kosong)') + ' tidak punya toko aktif di Master Toko.');
      level = 'Cabang'; code = br;
    } else { level = 'Pusat'; code = 'PUSAT'; }
  } else if (p.shared) {
    assertAllStoresScope_('Biaya bersama');
    rule = p.rule === 'rata' ? 'rata' : 'omzet';
    const known = finStoresFromRows_(finRows_('FinStores')).map(function(s) { return s.code; });
    stores = (Array.isArray(p.stores) ? p.stores : []).map(function(s) { return String(s).trim().toUpperCase(); }).filter(function(s, i, a) { return s && a.indexOf(s) === i; });
    if (stores.length < 2) throw new Error('Biaya bersama harus dibagi ke minimal 2 toko.');
    stores.forEach(function(s) { if (known.indexOf(s) < 0) throw new Error('Toko ' + s + ' tidak ada di Master Toko.'); });
    level = 'Bersama'; code = 'BERSAMA';
  } else {
    const store = requireStoreCode_(p.storeCode);
    level = 'Toko'; code = store.code;
  }
  const id = Utilities.getUuid();
  const row = [id, date, level, code, cat, amount, String(p.note || '').slice(0, 300), currentActorEmail_(), new Date(), 'AKTIF', '', '', group, days, rule, stores.join(',')];
  withScriptLock_(function() { finSheet_('FinCosts').appendRow(row); });
  auditChange_('cost-create', 'FinCosts', id, null, row);
  const spreadText = days === 1 ? 'diakui pada tanggal itu' : 'dibagi rata 30 hari mulai tanggal itu (akrual)';
  const target = level === 'Cabang' ? ' untuk Kantor ' + code + ' (dibagi ke semua toko cabang ini, ' + (rule === 'rata' ? 'rata' : 'porsi omzet') + ')'
    : level === 'Pusat' ? ' untuk Pusat (dibagi ke semua toko semua cabang, ' + (rule === 'rata' ? 'rata' : 'porsi omzet') + ')'
    : p.shared ? ' dibagi ke ' + stores.length + ' toko (' + (rule === 'rata' ? 'rata' : 'porsi omzet') + ')' : ' untuk toko ' + code;
  return { ok: true, id: id, message: group + ' "' + cat + '" ' + amount + target + ', ' + spreadText + '.' };
}
/** Daftar biaya yang menyentuh satu toko (langsung atau bagian dari biaya bersama), dibatasi akses. */
/** Toko yang menanggung biaya: Bersama = toko terpilih; Cabang = semua toko aktif di cabang itu (termasuk toko baru); Pusat = semua toko aktif. */
function plCostTargets_(c, allActive) {
  if (c.level === 'Bersama') return c.stores;
  if (c.level === 'Cabang') return allActive.filter(function(s) { return String(s.branch || '').trim().toUpperCase() === c.code; }).map(function(s) { return s.code; });
  if (c.level === 'Pusat') return allActive.map(function(s) { return s.code; });
  return [];
}
function plListCosts_(p) {
  p = p || {};
  const want = String(p.storeCode || '').trim().toUpperCase();
  if (want) assertStoreAllowed_(want);
  const scope = allowedStoreList_();
  const since = finDate_(p.since) || finAddDays_(plToday_(), -90);
  const allActive = finStoresFromRows_(finRows_('FinStores')).filter(function(s) { return s.active; });
  const tokoBranch = want ? String((allActive.find(function(s) { return s.code === want; }) || {}).branch || '').toUpperCase() : '';
  const wantBranch = String(p.branch || '').trim().toUpperCase();
  return plCosts_().filter(function(c) {
    const end = finAddDays_(c.date, c.days - 1);
    if (end < since) return false;
    const touched = c.level === 'Toko' ? [c.code] : plCostTargets_(c, allActive);
    if (wantBranch) return (c.level === 'Cabang' && c.code === wantBranch) || c.level === 'Pusat' || touched.some(function(s) { return allActive.some(function(x) { return x.code === s && String(x.branch || '').toUpperCase() === wantBranch; }); });
    if (want) return touched.indexOf(want) >= 0 || (tokoBranch && c.level === 'Cabang' && c.code === tokoBranch);
    if (!scope) return true;
    return touched.length > 0 && touched.some(function(s) { return scope.indexOf(s) >= 0; });
  }).sort(function(a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 300).map(function(c) {
    return { id: c.id, date: c.date, group: c.group, category: c.cat, level: c.level, storeCode: c.level === 'Toko' ? c.code : '', branch: c.level === 'Cabang' ? c.code : '', stores: c.stores, rule: c.rule,
      amount: c.amount, days: c.days, note: c.note, by: c.by };
  });
}

/* ---------------- Penyusunan laba rugi harian ---------------- */
function plEmptyDay_() { return { orders: 0, gross: 0, ret: 0, hpp: 0, hppMissing: 0, fee: 0, feePending: 0, ship: 0, ads: 0, gaji: 0, ops: 0, tax: 0 }; }
/**
 * Data laba rugi harian per toko untuk N hari terakhir (default 60, cukup untuk membandingkan 30 hari vs 30 hari sebelumnya).
 * Hasil: {dates, stores:[{code,name,channel}], daily:{code:[hari...]}, office:{unallocated:[...]}, notes, generatedAt}
 */
function plGetData_(opts) {
  opts = opts || {};
  const n = Math.max(2, Math.min(370, Number(opts.days) || 60)); // 2× periode (maks 180 hari) untuk pembanding
  const end = finDate_(opts.endDate) || plToday_();
  const dates = plDates_(end, n), start = dates[0];
  const pos = {}; dates.forEach(function(d, i) { pos[d] = i; });
  const scope = allowedStoreList_();
  const stores = finStoresFromRows_(finRows_('FinStores')).filter(function(s) { return s.active && (!scope || scope.indexOf(s.code) >= 0); });
  const daily = {}; stores.forEach(function(s) { daily[s.code] = dates.map(plEmptyDay_); });
  const has = function(code) { return Object.prototype.hasOwnProperty.call(daily, code); };
  const notes = [];
  // Penjualan dibaca dari ringkasan PL_Harian (dihitung ulang otomatis hanya untuk tanggal yang berubah).
  const fresh = plEnsureFresh_();
  const netAll = {}, gI = PL_SUM_FIELDS.indexOf('gross'), rI = PL_SUM_FIELDS.indexOf('ret');   // omzet bersih SEMUA toko → porsi pembagian biaya yang adil
  plSummaryRows_(start, end).forEach(function(r) {
    const code = String(r[1]).toUpperCase(), date = finDate_(r[2]);
    if (!Object.prototype.hasOwnProperty.call(pos, date)) return;
    (netAll[code] = netAll[code] || {})[pos[date]] = (Number(r[3 + gI]) || 0) - (Number(r[3 + rI]) || 0);
    if (!has(code)) return;
    const d = daily[code][pos[date]];
    PL_SUM_FIELDS.forEach(function(f, k) { d[f] = Number(r[3 + k]) || 0; });
  });
  const unassignedSales = fresh.unassigned;
  // 3) Biaya (akrual) — langsung ke toko, atau dibagi sesuai aturan tercatat
  const unallocated = dates.map(function() { return 0; });
  const key = { Gaji: 'gaji', Operasional: 'ops', Iklan: 'ads', Pajak: 'tax' };
  const allActive = finStoresFromRows_(finRows_('FinStores')).filter(function(s) { return s.active; });
  plCosts_().forEach(function(c) {
    const perDay = c.amount / c.days;
    for (let k = 0; k < c.days; k++) {
      const date = finAddDays_(c.date, k);
      if (!Object.prototype.hasOwnProperty.call(pos, date)) continue;
      const i = pos[date];
      if (c.level === 'Toko') { if (has(c.code)) daily[c.code][i][key[c.group]] += perDay; continue; }
      const targets = plCostTargets_(c, allActive);
      if (targets.length) {
        const share = targets.map(function(s) { return { s: s, net: Math.max(0, (netAll[s] || {})[i] || 0) }; });
        const tot = share.reduce(function(a, x) { return a + x.net; }, 0);
        share.forEach(function(x) { if (!has(x.s)) return; const part = c.rule === 'rata' || !tot ? perDay / targets.length : perDay * x.net / tot; daily[x.s][i][key[c.group]] += part; });
      } else if (!scope) unallocated[i] += perDay; // tidak ada toko tujuan (mis. cabang tanpa toko aktif)
    }
  });
  if (unassignedSales) notes.push(unassignedSales + ' transaksi/pesanan belum punya kode toko dan tidak dihitung. Petakan di Kelola tim → Pemetaan data lama.');
  if (unallocated.some(function(v) { return v; })) notes.push('Ada biaya yang tidak punya toko tujuan (mis. cabang tanpa toko aktif); hanya mengurangi laba kantor.');
  const round = function(v) { return Math.round(v * 100) / 100; };
  Object.keys(daily).forEach(function(c) { daily[c] = daily[c].map(function(d) { Object.keys(d).forEach(function(k) { d[k] = round(d[k]); }); return d; }); });
  return { dates: dates, stores: stores.map(function(s) { return { code: s.code, name: s.name, channel: s.platform, dataMethod: s.dataMethod, branch: String(s.branch || '').trim().toUpperCase() }; }),
    daily: daily, office: { unallocated: unallocated.map(round), visible: !scope }, categories: PL_CATEGORIES, notes: notes, generatedAt: ttsNow_() };
}
/**
 * Hitung komponen PENJUALAN harian semua toko aktif untuk daftar tanggal (dari data mentah).
 * Dipakai untuk membangun ringkasan PL_Harian; tidak dibatasi akses (proses sistem, hasil disaring saat dibaca).
 */
/** Tanggal yyyy-MM-dd dari sel sheet. Google Sheets sering mengubah teks '2026-11-10T12:00:00' menjadi objek Date,
 *  sehingga String(...).slice(0,10) menghasilkan 'Tue Nov 10' dan pesanan tidak terhitung. */
function plDayKey_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}
function plComputeSales_(dates) {
  const pos = {}; dates.forEach(function(d, i) { pos[d] = i; });
  const daily = {};
  finStoresFromRows_(finRows_('FinStores')).forEach(function(s) { daily[s.code] = dates.map(plEmptyDay_); });
  const has = function(code) { return Object.prototype.hasOwnProperty.call(daily, code); };
  let unassignedSales = 0;
  const hppOf = plSkuIndex_();

  // 1) TikTok Shop API
  const ord = plSheetRows_('TTS_Orders', 23), orderInfo = {};
  ord.forEach(function(r) {
    const code = String(r[2] || '').toUpperCase(), date = plDayKey_(r[4]), status = String(r[7] || '');
    if (!code) { unassignedSales++; return; }
    if (!has(code) || !Object.prototype.hasOwnProperty.call(pos, date)) return;
    if (TTS_NON_SALE_STATUS.indexOf(status) >= 0) return;
    const gross = numOrNull_(r[12]);
    const d = daily[code][pos[date]];
    d.orders++; if (gross !== null) d.gross += gross;
    orderInfo[code + '|' + String(r[3])] = { date: date, gross: gross || 0, settled: false };
  });
  plSheetRows_('TTS_OrderLines', 20).forEach(function(r) {
    const code = String(r[2] || '').toUpperCase(), key = code + '|' + String(r[3]);
    const o = orderInfo[key]; if (!o) return;
    const qty = numOrNull_(r[13]) || 1, cost = hppOf(code, plLineSku_('tts', r), o.date);
    const d = daily[code][pos[o.date]];
    if (cost === null) d.hppMissing += (numOrNull_(r[15]) || 0); else d.hpp += cost * qty;
  });
  plSheetRows_('TTS_Finance', 18).forEach(function(r) {
    const code = String(r[2] || '').toUpperCase(), o = orderInfo[code + '|' + String(r[6])];
    if (!o) return;
    const d = daily[code][pos[o.date]];
    const fee = numOrNull_(r[10]), ship = numOrNull_(r[14]);
    if (fee !== null) d.fee += -fee;          // fee_tax_amount bernilai negatif (potongan)
    if (ship !== null) d.ship += -Math.min(0, ship); // hanya ongkir yang mengurangi penghasilan penjual
    o.settled = true;
  });
  Object.keys(orderInfo).forEach(function(k) { const o = orderInfo[k]; if (!o.settled) daily[k.split('|')[0]][pos[o.date]].feePending += o.gross; });
  plSheetRows_('TTS_Returns', 15).forEach(function(r) {
    const code = String(r[2] || '').toUpperCase(), date = plDayKey_(r[5]);
    if (!has(code) || !Object.prototype.hasOwnProperty.call(pos, date) || !PL_REFUND_DONE.test(String(r[8]))) return;
    const v = numOrNull_(r[13]); if (v !== null) daily[code][pos[date]].ret += v;
  });

  // 1b) Shopee API — HANYA mode LIVE (data uji/sandbox tidak masuk laporan). Toko dipetakan dari SP_Shops saat ini.
  if (typeof spShops_ === 'function' && getDatabase_().getSheetByName('SP_Shops')) {
    const spMap = {}; spShops_().forEach(function(s) { if (s.env === 'live' && s.storeCode) spMap[s.id] = s.storeCode.toUpperCase(); });
    const spOrd = {};
    plSheetRows_('SP_Orders', 14).forEach(function(r) {
      if (String(r[12]) !== 'live') return;
      const code = spMap[String(r[1])], date = plDayKey_(r[4]), status = String(r[7] || '');
      if (!code) { unassignedSales++; return; }
      if (!has(code) || !Object.prototype.hasOwnProperty.call(pos, date) || SP_NON_SALE_STATUS.indexOf(status) >= 0) return;
      daily[code][pos[date]].orders++;
      spOrd['live|' + r[1] + '|' + r[3]] = { code: code, date: date, gross: 0, settled: false };
    });
    plSheetRows_('SP_OrderLines', 18).forEach(function(r) {
      const o = spOrd[String(r[0]).split('|').slice(0, 3).join('|')]; if (!o) return;
      const d = daily[o.code][pos[o.date]], total = numOrNull_(r[16]), qty = numOrNull_(r[13]) || 0;
      if (total !== null) { d.gross += total; o.gross += total; }
      const cost = hppOf(o.code, plLineSku_('sp', r), o.date);
      if (cost === null) d.hppMissing += total || 0; else d.hpp += cost * qty;
    });
    plSheetRows_('SP_Escrow', 20).forEach(function(r) {
      const o = spOrd[String(r[0])]; if (!o) return;
      const d = daily[o.code][pos[o.date]], v = function(i) { return numOrNull_(r[i]) || 0; };
      // Potongan platform = komisi + biaya layanan + biaya transaksi + komisi affiliate (AMS) + biaya kampanye.
      d.fee += Math.abs(v(6)) + Math.abs(v(7)) + Math.abs(v(8)) + Math.abs(v(9)) + Math.abs(v(10));
      d.ship += Math.max(0, -v(11));           // CEK DOKUMENTASI: final_shipping_fee negatif = ongkir ditanggung penjual
      d.tax += Math.abs(v(15));                 // PPh 22 dipotong Shopee (withholding_tax) — jangan dicatat ulang manual
      d.ret += Math.abs(v(16));                 // CEK DOKUMENTASI: seller_return_refund = refund ke pembeli
      o.settled = true;
    });
    Object.keys(spOrd).forEach(function(k) { const o = spOrd[k]; if (!o.settled) daily[o.code][pos[o.date]].feePending += o.gross; });
  }

  // 2) KasirKu & transaksi manual (sheet Transactions)
  plSheetRows_('Transactions', 18).forEach(function(r) {
    const code = String(r[17] || '').toUpperCase(), date = normalizeImportDate_(r[2]);
    if (!code) { unassignedSales++; return; }
    if (!has(code) || !Object.prototype.hasOwnProperty.call(pos, date)) return;
    const d = daily[code][pos[date]];
    const rev = numOrNull_(r[5]), cogs = numOrNull_(r[9]);
    d.orders += numOrNull_(r[6]) || 0; if (rev !== null) d.gross += rev;
    if (cogs === null) d.hppMissing += rev || 0; else d.hpp += cogs;
    d.fee += (numOrNull_(r[10]) || 0) + (numOrNull_(r[11]) || 0) + (numOrNull_(r[12]) || 0);
    d.ads += numOrNull_(r[8]) || 0; d.ops += numOrNull_(r[13]) || 0;
  });

  return { daily: daily, unassigned: unassignedSales };
}
/** Hitung total satu toko dari baris harian (dipakai AI & uji). */
function plTotals_(days) {
  const t = plEmptyDay_();
  days.forEach(function(d) { Object.keys(t).forEach(function(k) { t[k] += d[k] || 0; }); });
  t.net = t.gross - t.ret; t.grossProfit = t.net - t.hpp; t.afterSelling = t.grossProfit - t.fee - t.ship - t.ads;
  t.ebt = t.afterSelling - t.gaji - t.ops; t.netProfit = t.ebt - t.tax;
  t.margin = t.net ? t.netProfit / t.net : null; t.final = t.hppMissing === 0 && t.feePending === 0;
  return t;
}
/** Ringkasan laba rugi per toko untuk Analis AI (hanya angka agregat, tanpa data pembeli). */
function plSummaryForAI_(f) {
  f = f || {};
  const days = Math.max(1, Math.min(180, Number(f.days) || 30));
  const data = plGetData_({ days: days * 2, endDate: f.endDate || '' });
  const cur = data.dates.slice(days), from = days;
  const want = String(f.storeCode || '').toUpperCase();
  const rows = data.stores.filter(function(s) { return !want || s.code === want; }).map(function(s) {
    const t = plTotals_(data.daily[s.code].slice(from)), prev = plTotals_(data.daily[s.code].slice(0, from));
    const r = function(v) { return v === null ? null : Math.round(v); };
    return { toko: s.code, nama: s.name, kanal: s.channel, pesanan: t.orders, omzetBersih: r(t.net), hpp: r(t.hpp), labaKotor: r(t.grossProfit),
      potonganPlatform: r(t.fee), ongkir: r(t.ship), iklan: r(t.ads), gaji: r(t.gaji), operasional: r(t.ops), pajak: r(t.tax), labaBersih: r(t.netProfit),
      marginBersihPersen: t.margin === null ? null : Math.round(t.margin * 1000) / 10, labaBersihPeriodeSebelumnya: r(prev.netProfit),
      final: t.final, omzetTanpaHpp: r(t.hppMissing), omzetBelumSettle: r(t.feePending) };
  });
  return { periode: cur[0] + ' s/d ' + cur[cur.length - 1], pembanding: data.dates[0] + ' s/d ' + data.dates[from - 1], toko: rows, catatan: data.notes };
}

/* ---------------- Laporan Keuangan (rentang tanggal bebas) dari mesin laba rugi yang sama dengan Pusat Keuangan ---------------- */
function plReport_(f) {
  f = f || {};
  const start = finDate_(f.start), end = finDate_(f.end);
  if (!start || !end) throw new Error('Isi tanggal mulai dan akhir.');
  if (start > end) throw new Error('Tanggal mulai tidak boleh melewati tanggal akhir.');
  const n = finDays_(start, end);
  if (n > 180) throw new Error('Rentang maksimal 180 hari. Perkecil rentangnya.');
  const data = plGetData_({ days: n * 2, endDate: end });
  const branchOf = {}; finStoresFromRows_(finRows_('FinStores')).forEach(function(s) { branchOf[s.code] = s.branch || '—'; });
  const pick = function(t) {
    const r = function(v) { return Math.round(v); };
    return { orders: t.orders, omzet: r(t.net), hpp: r(t.hpp), labaKotor: r(t.grossProfit), potongan: r(t.fee + t.ship), iklan: r(t.ads),
      gajiOps: r(t.gaji + t.ops), pajak: r(t.tax), labaBersih: r(t.netProfit), margin: t.margin, final: t.final, hppMissing: r(t.hppMissing), feePending: r(t.feePending) };
  };
  const sumDays = function(codes, a, b) { const days = []; codes.forEach(function(c) { days.push.apply(days, data.daily[c].slice(a, b)); }); return plTotals_(days); };
  const row = function(label, codes) {
    const cur = pick(sumDays(codes, n, 2 * n)), prev = pick(sumDays(codes, 0, n));
    cur.label = label; cur.prevLabaBersih = prev.labaBersih; cur.prevOmzet = prev.omzet; return cur;
  };
  const stores = data.stores.map(function(s) { const x = row(s.code + ' — ' + s.name, [s.code]); x.code = s.code; x.channel = s.channel; x.branch = branchOf[s.code] || '—'; return x; });
  const group = function(key) { const g = {}; data.stores.forEach(function(s) { const k = key(s); (g[k] = g[k] || []).push(s.code); }); return Object.keys(g).sort().map(function(k) { return row(k, g[k]); }); };
  const all = data.stores.map(function(s) { return s.code; });
  const total = row('Semua toko', all);
  const office = data.office.visible ? Math.round(data.office.unallocated.slice(n).reduce(function(a, v) { return a + v; }, 0)) : null;
  total.biayaKantor = office; total.labaBersihKantor = office === null ? null : total.labaBersih - office;
  return { start: start, end: end, prevStart: data.dates[0], prevEnd: data.dates[n - 1], days: n, total: total, stores: stores,
    branches: group(function(s) { return branchOf[s.code] || '—'; }), channels: group(function(s) { return s.channel || 'Lainnya'; }), notes: data.notes };
}
function plReportText_(f) {
  const r = plReport_(f), rp = function(v) { return v === null || v === undefined ? '—' : 'Rp ' + Math.round(v).toLocaleString('id-ID'); };
  const t = r.total, lines = ['*Laporan Keuangan ' + r.start + ' s/d ' + r.end + '*' + (t.final ? '' : ' (BELUM FINAL)'), '',
    'Pesanan: ' + t.orders, 'Omzet bersih: ' + rp(t.omzet), 'HPP: ' + rp(t.hpp), 'Laba kotor: ' + rp(t.labaKotor),
    'Potongan platform + ongkir: ' + rp(t.potongan), 'Iklan: ' + rp(t.iklan), 'Gaji + operasional: ' + rp(t.gajiOps), 'Pajak: ' + rp(t.pajak),
    '*Laba bersih toko: ' + rp(t.labaBersih) + '* (periode lalu ' + rp(t.prevLabaBersih) + ')'];
  if (t.biayaKantor) lines.push('Biaya kantor lain: ' + rp(t.biayaKantor), '*Laba bersih kantor: ' + rp(t.labaBersihKantor) + '*');
  lines.push('', '*Per toko*');
  r.stores.forEach(function(s) { lines.push('• ' + s.label + ': laba ' + rp(s.labaBersih) + ' dari omzet ' + rp(s.omzet) + (s.final ? '' : ' (belum final)')); });
  if (!t.final) lines.push('', 'Belum final: ' + (t.hppMissing ? 'omzet ' + rp(t.hppMissing) + ' belum ada HPP. ' : '') + (t.feePending ? 'omzet ' + rp(t.feePending) + ' belum settle.' : ''));
  return { text: lines.join('\n') };
}

/* ---------------- HPP massal: tempel dari Excel (SKU <tab> HPP) ---------------- */
function plParsePrice_(v) {
  let t = String(v == null ? '' : v).replace(/rp\.?/ig, '').replace(/\s/g, '');
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');      // 10.000 / 1.234,5
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');                    // 10,000
  else if (/^\d+,\d+$/.test(t)) t = t.replace(',', '.');                                       // 1500,5
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
function plSkuBulk_(p) {
  p = p || {};
  const store = String(p.storeCode || '*').trim().toUpperCase() || '*';
  if (store === '*') assertAllStoresScope_('HPP untuk semua toko'); else requireStoreCode_(store);
  const from = finDate_(p.from || '');
  if (!from) throw new Error('Isi tanggal Berlaku mulai.');
  const lines = String(p.text || '').split(/\r?\n/);
  if (lines.length > 3000) throw new Error('Maksimal 3000 baris sekali tempel.');
  // SKU yang pernah terjual (TikTok & Shopee) untuk dicocokkan
  const sold = {};
  const addSold = function(sku, name, note) { const k = plSkuKey_(sku); if (!k) return; const x = sold[k] || (sold[k] = { sku: String(sku).trim(), name: String(name || ''), note: note || '', lines: 0 }); x.lines++; };
  plSheetRows_('TTS_OrderLines', 20).forEach(function(r) { addSold(plLineSku_('tts', r), plLineName_(r[11], r[12]), r[10] ? '' : 'TikTok tanpa Seller SKU'); });
  if (getDatabase_().getSheetByName('SP_OrderLines')) plSheetRows_('SP_OrderLines', 18).forEach(function(r) { addSold(plLineSku_('sp', r), plLineName_(r[11], r[12]), (r[10] || r[9]) ? '' : 'Shopee tanpa SKU'); });
  const cur = plSkuIndex_();
  const rows = [], seen = {}, skipped = [];
  lines.forEach(function(line, i) {
    const raw = String(line || '');
    if (!raw.trim()) return;
    let sku = '', price = '';
    if (raw.indexOf('\t') >= 0) { const parts = raw.split('\t').map(function(x) { return x.trim(); }).filter(function(x) { return x !== ''; }); sku = parts[0] || ''; price = parts.length > 1 ? parts[parts.length - 1] : ''; }
    else { const m = raw.match(/^(.*?)\s+((?:rp\.?\s*)?[\d.,]+)\s*$/i); if (m) { sku = m[1]; price = m[2]; } else sku = raw; }
    sku = String(sku).trim().replace(/\s+/g, ' ');
    const cost = plParsePrice_(price);
    if (!sku || cost === null) { skipped.push({ line: i + 1, text: raw.slice(0, 80), reason: cost === null ? 'HPP bukan angka (mungkin baris judul)' : 'SKU kosong' }); return; }
    const k = plSkuKey_(sku);
    if (seen[k] !== undefined) { rows[seen[k]].dupe = true; rows[seen[k]].cost = cost; return; }
    const old = cur(store, sku, from);
    seen[k] = rows.length;
    rows.push({ line: i + 1, sku: sku, cost: cost, sold: !!sold[k], soldLines: sold[k] ? sold[k].lines : 0, oldCost: old, same: old === cost, dupe: false });
  });
  const toSave = rows.filter(function(r) { return !r.same; });
  // Tautan otomatis: varian marketplace yang belum dipetakan & tanpa HPP → SKU dari tempelan yang paling cocok
  let links = [], namesMissing = 0;
  if (p.autoLink !== false && typeof skuMapList_ === 'function') {
    const pasted = {}; rows.forEach(function(r) { pasted[plSkuKey_(r.sku)] = r.sku; });
    const ml = skuMapList_({ extraCatalog: rows.map(function(r) { return r.sku; }) }); namesMissing = ml.namesMissing;
    ml.rows.forEach(function(x) {
      if (x.internalSku || !x.suggest || !pasted[plSkuKey_(x.suggest)]) return;
      if (x.sellerSku && pasted[plSkuKey_(x.sellerSku)]) return;            // Seller SKU sudah sama persis, tidak perlu ditautkan
      links.push({ key: x.key, platform: x.platform, store: x.storeCode, product: x.product, variant: x.variant, sold: x.sold, sku: pasted[plSkuKey_(x.suggest)], score: x.score,
        sure: (x.sameGroup || x.score >= 75) && !x.ambiguous, ambiguous: !!x.ambiguous });
    });
    links.sort(function(a, b) { return (b.sure ? 1 : 0) - (a.sure ? 1 : 0) || b.sold - a.sold; });
    links.forEach(function(l) { const k = l.key.indexOf('tts|') === 0 ? l.key.slice(4) : ''; if (k && sold[plSkuKey_(k)]) delete sold[plSkuKey_(k)]; });
  }
  const after = function(k) { return seen[k] !== undefined || cur(store === '*' ? '*' : store, k, from) !== null; };
  const missing = Object.keys(sold).filter(function(k) { return !after(k); }).map(function(k) { return sold[k]; }).sort(function(a, b) { return b.lines - a.lines; });
  const summary = { store: store, from: from, total: rows.length, toSave: toSave.length, unchanged: rows.length - toSave.length,
    matched: rows.filter(function(r) { return r.sold; }).length, notSold: rows.filter(function(r) { return !r.sold; }).length,
    dupes: rows.filter(function(r) { return r.dupe; }).length, skipped: skipped, rows: rows, missing: missing.slice(0, 100), missingCount: missing.length,
    namesMissing: namesMissing, links: links.slice(0, 500), linksSure: links.filter(function(l) { return l.sure; }).length };
  if (!p.apply) return summary;
  const linkKeys = {}; (p.linkKeys || []).forEach(function(k) { linkKeys[k] = true; });
  const chosen = links.filter(function(l) { return linkKeys[l.key]; });
  if (!toSave.length && !chosen.length) throw new Error('Tidak ada HPP baru atau tautan untuk disimpan.');
  const actor = currentActorEmail_(), now = new Date();
  const values = toSave.map(function(r) { return [store, r.sku, '', r.cost, from, actor, now]; });
  if (values.length) {
    withScriptLock_(function() { const sh = plSkuSheet_(); ensureRoom_(sh, values.length, PL_SKU_HEADERS.length).getRange(sh.getLastRow() + 1, 1, values.length, PL_SKU_HEADERS.length).setValues(values); });
    plMarkDirty_(from);
    auditChange_('sku-cost-bulk', 'HPP_SKU', store + ' (' + values.length + ' SKU)', null, { from: from, count: values.length, firstSku: values[0][1] });
  }
  let linked = 0;
  if (chosen.length) linked = skuMapSave_({ items: chosen.map(function(l) { return { key: l.key, internalSku: l.sku }; }) }).changed;
  summary.saved = values.length; summary.linked = linked;
  summary.message = values.length + ' HPP disimpan (' + (store === '*' ? 'semua toko' : store) + ', berlaku mulai ' + from + ')' + (linked ? ' dan ' + linked + ' varian marketplace ditautkan' : '') + '. Laba dihitung ulang otomatis. Produk di TikTok/Shopee tidak diubah.';
  return summary;
}

/* ---------------- Produk terlaris untuk Analis AI (agregat, tanpa data pembeli) ---------------- */
function plProductsForAI_(f) {
  f = f || {};
  const days = Math.max(1, Math.min(180, Number(f.days) || 30)), end = finDate_(f.endDate) || plToday_(), start = finAddDays_(end, -(days - 1));
  const scope = allowedStoreList_(), want = String(f.storeCode || '').toUpperCase();
  const ok = function(code) { code = String(code || '').toUpperCase(); return code && (!scope || scope.indexOf(code) >= 0) && (!want || code === want); };
  const inP = function(d) { return d && d >= start && d <= end; };
  const agg = {};
  const add = function(key, name, sku, store, units, omzet, src) {
    const x = agg[key] || (agg[key] = { produk: name, skuGudang: sku || '', unit: 0, omzet: 0, toko: {}, sumber: {} });
    x.unit += units || 0; if (omzet !== null && omzet !== undefined) x.omzet += omzet; x.toko[store] = true; x.sumber[src] = true;
  };
  const db = getDatabase_();
  // TikTok (1 baris item = 1 unit; batal/belum bayar tidak dihitung)
  if (db.getSheetByName('TTS_OrderLines')) plSheetRows_('TTS_OrderLines', 20).forEach(function(r) {
    const store = String(r[2] || '').toUpperCase(), d = plDayKey_(r[5]);
    if (!ok(store) || !inP(d) || TTS_NON_SALE_STATUS.indexOf(String(r[6])) >= 0) return;
    const mapped = (typeof skuMapIndex_ === 'function' ? skuMapIndex_() : {})[skuMapKeyTts_(r[9])] || String(r[10] || '');
    const name = String(r[11] || '').slice(0, 80) + (r[12] ? ' — ' + r[12] : '');
    add(mapped ? 'SKU:' + plSkuKey_(mapped) : 'TT:' + name.toUpperCase(), name, mapped, store, 1, numOrNull_(r[15]), 'TikTok');
  });
  // Shopee LIVE
  if (db.getSheetByName('SP_OrderLines') && typeof spShops_ === 'function') {
    const spMap = {}; spShops_().forEach(function(s) { if (s.env === 'live' && s.storeCode) spMap[s.id] = s.storeCode.toUpperCase(); });
    const st = {}; plSheetRows_('SP_Orders', 14).forEach(function(r) { if (String(r[12]) === 'live') st[r[1] + '|' + r[3]] = String(r[7]); });
    plSheetRows_('SP_OrderLines', 18).forEach(function(r) {
      if (String(r[0]).indexOf('live|') !== 0) return;
      const store = spMap[String(r[1])] || '', d = plDayKey_(r[5]);
      if (!ok(store) || !inP(d) || /CANCEL|UNPAID|RETURN/.test(st[r[1] + '|' + r[3]] || '')) return;
      const sku = plLineSku_('sp', r, true), name = String(r[11] || '').slice(0, 80) + (r[12] ? ' — ' + r[12] : '');
      add(sku ? 'SKU:' + plSkuKey_(sku) : 'SP:' + name.toUpperCase(), name, sku, store, numOrNull_(r[13]) || 1, numOrNull_(r[16]), 'Shopee');
    });
  }
  // KasirKu & transaksi manual
  plSheetRows_('Transactions', 18).forEach(function(r) {
    const store = String(r[17] || '').toUpperCase(), d = normalizeImportDate_(r[2]);
    if (!ok(store) || !inP(d) || !String(r[4] || '').trim()) return;
    const name = String(r[4]).trim().slice(0, 80);
    add('KK:' + name.toUpperCase(), name, '', store, numOrNull_(r[7]) || 0, numOrNull_(r[5]), String(r[3] || 'Offline'));
  });
  const list = Object.keys(agg).map(function(k) { const x = agg[k]; return { produk: x.produk, skuGudang: x.skuGudang, unit: x.unit, omzet: Math.round(x.omzet), toko: Object.keys(x.toko), sumber: Object.keys(x.sumber) }; });
  return { periode: start + ' s/d ' + end, jumlahProduk: list.length,
    terlarisMenurutUnit: list.slice().sort(function(a, b) { return b.unit - a.unit; }).slice(0, 25),
    terlarisMenurutOmzet: list.slice().sort(function(a, b) { return b.omzet - a.omzet; }).slice(0, 25),
    catatan: 'Unit TikTok dihitung 1 per baris item. Pesanan batal/belum dibayar tidak dihitung. Omzet = harga jual item setelah diskon penjual. Produk yang sama di beberapa toko digabung bila sudah dipetakan ke SKU gudang.' };
}
