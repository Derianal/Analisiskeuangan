/**
 * STOK GUDANG PER TOKO (buku mutasi)
 *
 * - Setiap toko punya gudang sendiri. Stok = jumlah semua mutasi (Stok_Mutasi) untuk toko + seller SKU.
 * - Mutasi manual: MASUK, KELUAR, PENYESUAIAN (hasil hitung fisik; disimpan sebagai selisih).
 * - Mutasi otomatis: PENJUALAN dari TikTok API (TTS_OrderLines) & KasirKu (Transactions), sekali per item
 *   (kunci Ref unik); BATAL_PENJUALAN bila pesanan yang sudah memotong stok kemudian dibatalkan.
 * - Stok toko mulai dihitung sejak mutasi manual pertama (stok awal). Penjualan sebelum itu tidak memotong stok.
 * - Retur tidak otomatis menambah stok (barang retur bisa rusak); catat MASUK secara manual bila layak jual.
 * - Belum mengirim stok ke marketplace (tahap berikutnya, setelah izin API tulis tersedia).
 */
const STOCK_HEADERS = ['ID', 'Waktu', 'Kode Toko', 'Seller SKU', 'Jenis', 'Qty', 'Sumber', 'Ref', 'Catatan', 'Oleh'];
const STOCK_MANUAL = { in: 'MASUK', out: 'KELUAR', adj: 'PENYESUAIAN' };

function stockSheet_() {
  const ss = getDatabase_();
  let sh = ss.getSheetByName('Stok_Mutasi');
  if (!sh) sh = ss.insertSheet('Stok_Mutasi');
  if (!sh.getLastRow()) { sh.appendRow(STOCK_HEADERS); sh.setFrozenRows(1); }   // sheet ada tapi kosong → tulis judul
  return sh;
}
function stockRows_() {
  const sh = stockSheet_();
  return sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, STOCK_HEADERS.length).getValues() : [];
}
function stockStamp_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
  return String(v || '');
}
/** Saldo per toko|SKU dan waktu mulai pelacakan per toko. */
function stockState_() {
  const bal = {}, start = {}, refs = {};
  stockRows_().forEach(function(r) {
    const store = String(r[2]).toUpperCase(), sku = String(r[3]).toUpperCase(), kind = String(r[4]), qty = Number(r[5]) || 0, t = stockStamp_(r[1]);
    const k = store + '|' + sku;
    bal[k] = (bal[k] || 0) + qty;
    if (r[7]) refs[String(r[7])] = true;
    if (['MASUK', 'KELUAR', 'PENYESUAIAN'].indexOf(kind) >= 0 && (!start[store] || t < start[store])) start[store] = t;
  });
  return { bal: bal, start: start, refs: refs };
}
/** Catat mutasi manual untuk satu toko (terkunci ke toko; dicek akses). */
function stockSave_(p) {
  p = p || {};
  const store = requireStoreCode_(p.storeCode);
  const sku = String(p.sku || '').trim().toUpperCase();
  if (!sku || sku.length > 80) throw new Error('Isi seller SKU (sama dengan kode SKU di marketplace/KasirKu).');
  const kind = STOCK_MANUAL[p.type];
  if (!kind) throw new Error('Pilih jenis: stok masuk, stok keluar, atau penyesuaian.');
  const qty = Number(p.qty);
  if (!isFinite(qty) || qty < 0 || Math.round(qty) !== qty || (kind !== 'PENYESUAIAN' && qty === 0)) throw new Error('Jumlah harus bilangan bulat' + (kind === 'PENYESUAIAN' ? ' 0 atau lebih.' : ' lebih dari 0.'));
  return withScriptLock_(function() {
    const st = stockState_(), cur = st.bal[store.code + '|' + sku] || 0;
    let delta = kind === 'MASUK' ? qty : kind === 'KELUAR' ? -qty : qty - cur;
    if (kind === 'KELUAR' && qty > cur) throw new Error('Stok ' + sku + ' di ' + store.code + ' hanya ' + cur + '. Gunakan penyesuaian bila hitung fisik berbeda.');
    const note = String(p.note || '').slice(0, 200) + (kind === 'PENYESUAIAN' ? (p.note ? ' • ' : '') + 'hitung fisik ' + qty + ' (sebelumnya ' + cur + ')' : '');
    const row = [Utilities.getUuid(), new Date(), store.code, sku, kind, delta, 'manual', '', note, currentActorEmail_()];
    stockSheet_().appendRow(row);
    auditChange_('stock-' + kind.toLowerCase(), 'Stok_Mutasi', store.code + '|' + sku, { stok: cur }, { stok: cur + delta, mutasi: delta });
    return { ok: true, sku: sku, before: cur, after: cur + delta,
      message: sku + ' di gudang ' + store.code + ': ' + cur + ' → ' + (cur + delta) + '. Toko lain tidak berubah.' + (st.start[store.code] ? '' : ' Ini stok awal toko ini; penjualan mulai sekarang akan memotong stok otomatis.') };
  });
}
/** SKU dari catatan KasirKu ("…; SKU=BB-xxx; …"). */
function stockKasirSku_(note) {
  const m = String(note || '').match(/SKU=([^;]+)/);
  return m ? m[1].trim().toUpperCase() : '';
}
/**
 * Terapkan penjualan ke stok (idempoten). Dipanggil setelah sinkron TikTok, setelah transaksi KasirKu masuk,
 * dan dari tombol "Perbarui dari penjualan". Mengembalikan jumlah mutasi baru.
 */
function stockApplySales_() {
  return withScriptLock_(function() {
    const st = stockState_(), out = [], now = new Date();
    let skippedNoSku = 0;
    const orderStatus = {};
    const ordSh = getDatabase_().getSheetByName('TTS_Orders');
    if (ordSh && ordSh.getLastRow() > 1) ordSh.getRange(2, 1, ordSh.getLastRow() - 1, 8).getValues().forEach(function(r) { orderStatus[String(r[2]).toUpperCase() + '|' + r[3]] = String(r[7]); });
    // TikTok: satu baris item = 1 unit (lihat catatan TikTokShop.js)
    plSheetRows_('TTS_OrderLines', 20).forEach(function(r) {
      const store = String(r[2] || '').toUpperCase(), order = String(r[3]), line = String(r[4]), sku = plLineSku_('tts', r, true).toUpperCase();
      if (!store || !st.start[store]) return;
      if (stockStamp_(r[5]) < st.start[store]) return;
      if (!sku) { skippedNoSku++; return; }
      const qty = Number(r[13]) || 1, ref = 'TTS|' + store + '|' + order + '|' + line;
      const status = orderStatus[store + '|' + order] || String(r[6] || '');
      const cancelled = TTS_NON_SALE_STATUS.indexOf(status) >= 0;
      if (!cancelled && !st.refs[ref] && status !== 'UNPAID') { out.push([Utilities.getUuid(), now, store, sku, 'PENJUALAN', -qty, 'TikTok API', ref, 'Pesanan ' + order, '(sistem)']); st.refs[ref] = true; }
      if (cancelled && st.refs[ref] && !st.refs[ref + '|BATAL']) { out.push([Utilities.getUuid(), now, store, sku, 'BATAL_PENJUALAN', qty, 'TikTok API', ref + '|BATAL', 'Pesanan ' + order + ' dibatalkan', '(sistem)']); st.refs[ref + '|BATAL'] = true; }
    });
    // Shopee LIVE: jumlah per item; SKU = model_sku atau item_sku
    if (typeof spShops_ === 'function' && getDatabase_().getSheetByName('SP_Shops')) {
      const spMap = {}, spStatus = {};
      spShops_().forEach(function(s) { if (s.env === 'live' && s.storeCode) spMap[s.id] = s.storeCode.toUpperCase(); });
      plSheetRows_('SP_Orders', 14).forEach(function(r) { if (String(r[12]) === 'live') spStatus[String(r[1]) + '|' + r[3]] = String(r[7]); });
      plSheetRows_('SP_OrderLines', 18).forEach(function(r) {
        if (String(r[0]).indexOf('live|') !== 0) return;
        const store = spMap[String(r[1])], order = String(r[3]);
        if (!store || !st.start[store] || stockStamp_(r[5]) < st.start[store]) return;
        const sku = plLineSku_('sp', r, true).toUpperCase();
        if (!sku) { skippedNoSku++; return; }
        const qty = Number(r[13]) || 1, ref = 'SP|' + store + '|' + order + '|' + r[4], status = spStatus[String(r[1]) + '|' + order] || String(r[6]);
        const cancelled = SP_NON_SALE_STATUS.indexOf(status) >= 0 && status !== 'UNPAID';
        if (!cancelled && status !== 'UNPAID' && !st.refs[ref]) { out.push([Utilities.getUuid(), now, store, sku, 'PENJUALAN', -qty, 'Shopee API', ref, 'Pesanan ' + order, '(sistem)']); st.refs[ref] = true; }
        if (cancelled && st.refs[ref] && !st.refs[ref + '|BATAL']) { out.push([Utilities.getUuid(), now, store, sku, 'BATAL_PENJUALAN', qty, 'Shopee API', ref + '|BATAL', 'Pesanan ' + order + ' dibatalkan', '(sistem)']); st.refs[ref + '|BATAL'] = true; }
      });
    }
    // KasirKu: kolom Units = jumlah, SKU dari catatan
    plSheetRows_('Transactions', 18).forEach(function(r) {
      const store = String(r[17] || '').toUpperCase(), id = String(r[0]);
      if (!store || !st.start[store] || id.indexOf('KASIRKU:') !== 0) return;
      const when = r[1] instanceof Date ? stockStamp_(r[1]) : String(normalizeImportDate_(r[2])) + 'T23:59:59';
      if (when < st.start[store]) return;
      const sku = stockKasirSku_(r[14]);
      if (!sku) { skippedNoSku++; return; }
      const ref = 'KSR|' + store + '|' + id;
      if (st.refs[ref]) return;
      out.push([Utilities.getUuid(), now, store, sku, 'PENJUALAN', -(Number(r[7]) || 1), 'KasirKu', ref, String(r[4] || '').slice(0, 100), '(sistem)']);
      st.refs[ref] = true;
    });
    if (out.length) { const sh = stockSheet_(); ensureRoom_(sh, out.length, STOCK_HEADERS.length).getRange(sh.getLastRow() + 1, 1, out.length, STOCK_HEADERS.length).setValues(out); }
    return { added: out.length, skippedNoSku: skippedNoSku, message: out.length + ' mutasi penjualan/pembatalan baru diterapkan ke stok.' + (skippedNoSku ? ' ' + skippedNoSku + ' item tanpa SKU tidak bisa memotong stok.' : '') };
  });
}
/** Stok satu toko: saldo, terjual 7 hari, perkiraan habis, status, mutasi terakhir. */
function stockGet_(p) {
  p = p || {};
  const store = String(p.storeCode || '').trim().toUpperCase();
  if (!store) throw new Error('Pilih satu toko. Setiap toko punya gudang sendiri.');
  assertStoreAllowed_(store);
  const rows = stockRows_().filter(function(r) { return String(r[2]).toUpperCase() === store; });
  const since = Utilities.formatDate(new Date(Date.now() - 7 * 86400000), 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
  const items = {}, names = {};
  plListSku_({ storeCode: store }).forEach(function(x) { if (x.name) names[String(x.sku).toUpperCase()] = x.name; });
  rows.forEach(function(r) {
    const sku = String(r[3]).toUpperCase(), it = items[sku] || (items[sku] = { sku: sku, name: names[sku] || '', qty: 0, sold7: 0, last: '' });
    it.qty += Number(r[5]) || 0;
    const t = stockStamp_(r[1]);
    if (String(r[4]) === 'PENJUALAN' && t >= since) it.sold7 += -(Number(r[5]) || 0);
    if (String(r[4]) === 'BATAL_PENJUALAN' && t >= since) it.sold7 -= Number(r[5]) || 0;
    if (t > it.last) it.last = t;
  });
  const list = Object.keys(items).map(function(k) {
    const it = items[k], perDay = it.sold7 / 7, days = perDay > 0 ? it.qty / perDay : null;
    it.daysLeft = days === null ? null : Math.round(days * 10) / 10;
    it.status = it.qty <= 0 ? 'Habis' : (days !== null && days < 7 ? 'Menipis' : 'Aman');
    return it;
  }).sort(function(a, b) { return (a.daysLeft === null ? 1e9 : a.daysLeft) - (b.daysLeft === null ? 1e9 : b.daysLeft); });
  const history = rows.slice(-30).reverse().map(function(r) { return { time: stockStamp_(r[1]), sku: String(r[3]), kind: String(r[4]), qty: Number(r[5]), source: String(r[6]), note: String(r[8] || ''), by: String(r[9] || '') }; });
  const st = stockState_();
  return { storeCode: store, trackingSince: st.start[store] || '', items: list, history: history };
}
