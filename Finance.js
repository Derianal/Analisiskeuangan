/**
 * LAPORAN KEUANGAN MULTI-TOKO
 * Struktur: Toko -> Cabang -> Total. Iklan & biaya lain dicatat per Toko / Cabang / Pusat.
 * Prinsip: data kosong = tidak tersedia (null), bukan nol. Biaya tidak dialokasikan tanpa dasar.
 * Sheet baru (dibuat otomatis saat pertama dipakai): FinStores, FinSales, FinCosts.
 */
const FIN_SHEETS = {
  // Kolom baru ditambahkan di BELAKANG agar data lama tetap terbaca.
  FinStores: ['Kode', 'Nama Toko', 'Platform', 'Cabang', 'Mata Uang', 'Aktif', 'Alias', 'Diubah',
    'ID Toko Platform', 'Penanggung Jawab', 'Metode Data', 'Sync Terakhir', 'Status Sync'],
  FinSales: ['Ref ID', 'Tanggal', 'Kode Toko', 'Nomor Pesanan', 'SKU', 'Produk', 'Qty', 'Omzet',
    'Pendapatan Platform', 'Modal', 'Mata Uang', 'Sumber File', 'Import ID', 'Diimpor', 'Status Pesanan'],
  FinCosts: ['ID', 'Tanggal', 'Level', 'Kode', 'Kategori', 'Nominal', 'Catatan', 'Dicatat Oleh', 'Dicatat Pada',
    'Status', 'Dibatalkan Oleh', 'Dibatalkan Pada', 'Jenis', 'Akrual Hari', 'Aturan Bagi', 'Toko Dibagi']
};
const FIN_PLATFORMS = ['Shopee', 'TikTok', 'Lazada', 'Tokopedia', 'POS/Toko', 'Lainnya'];
const FIN_COST_LEVELS = ['Toko', 'Cabang', 'Pusat'];
const FIN_COST_CATEGORIES = ['Iklan', 'Komisi Affiliate', 'Packing', 'Ongkir Ditanggung', 'Gaji', 'Sewa',
  'Listrik & Air', 'Internet', 'Transportasi', 'Perlengkapan', 'Lainnya'];
const FIN_DEFAULT_RULES = { omzetDropPct: 30, marginDropPt: 3, abnormalLossPct: 50 };

/* ---------------- util ---------------- */
function finSheet_(name) {
  const ss = getDatabase_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, FIN_SHEETS[name].length).setValues([FIN_SHEETS[name]])
      .setFontWeight('bold').setBackground('#eaf0f8');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < FIN_SHEETS[name].length) {
    // Migrasi aman: hanya menambah judul kolom baru di belakang.
    sh.getRange(1, 1, 1, FIN_SHEETS[name].length).setValues([FIN_SHEETS[name]]);
  }
  return sh;
}
function finRows_(name) {
  const sh = finSheet_(name);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, FIN_SHEETS[name].length).getValues();
}
/** Angka: '' / null -> null. Mendukung 1.250.000 ; 1,250,000 ; 1.250.000,50 ; Rp ; IDR. */
function finNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/(IDR|Rp)\s*/gi, '').replace(/\s/g, '');
  if (s === '' || s === '-') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (!/^-?[\d.,]+$/.test(s)) return null;
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  } else if (s.indexOf(',') >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}
/** Tanggal -> 'yyyy-MM-dd'. Format d/m/y dianggap tanggal Indonesia (hari dulu). */
function finDate_(v) {
  const tz = Session.getScriptTimeZone();
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return Utilities.formatDate(new Date(Date.UTC(1899, 11, 30) + v * 86400000), 'UTC', 'yyyy-MM-dd');
  }
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return finValidYmd_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return finValidYmd_(+m[3], +m[2], +m[1]);
  return '';
}
function finValidYmd_(y, mo, d) {
  if (y < 2000 || y > 2100) return '';
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function finAddDays_(ymd, n) {
  const p = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return t.toISOString().slice(0, 10);
}
function finDays_(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000) + 1;
}
function finKey_(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function finPick_(obj, aliases) {
  const norm = k => String(k).toLowerCase().replace(/[\s_\-().%\/]/g, '');
  const map = {};
  Object.keys(obj || {}).forEach(k => { map[norm(k)] = obj[k]; });
  for (let i = 0; i < aliases.length; i++) {
    const k = norm(aliases[i]);
    if (Object.prototype.hasOwnProperty.call(map, k)) return map[k];
  }
  return undefined;
}

/* ---------------- master toko ---------------- */
function finStoresFromRows_(rows) {
  return rows.filter(r => r[0]).map(r => ({
    code: String(r[0]).trim(), name: String(r[1]).trim(), platform: String(r[2] || 'Lainnya'),
    branch: String(r[3] || '').trim(), currency: String(r[4] || 'IDR').toUpperCase(),
    active: String(r[5]).toLowerCase() !== 'false',
    aliases: String(r[6] || '').split(',').map(x => x.trim()).filter(Boolean),
    platformShopId: String(r[8] || ''), pic: String(r[9] || ''),
    dataMethod: String(r[10] || 'Impor'), lastSync: r[11] instanceof Date ? r[11].toISOString() : String(r[11] || ''),
    syncStatus: String(r[12] || '')
  }));
}
/** Peta kode Master Toko -> sumber data yang terhubung (TikTok API, Shopee API, perangkat KasirKu). Tanpa token. */
function finApiLinks_() {
  const out = {}, add = (code, label) => { if (!code) return; (out[code] = out[code] || []).push(label); };
  try { if (typeof ttsShops_ === 'function') ttsShops_().forEach(t => { if (t.id) add(t.storeCode, 'TikTok API: ' + t.name + ' (' + t.status + ')'); }); } catch (e) {}
  try { if (typeof spShops_ === 'function') spShops_().forEach(t => add(t.storeCode, 'Shopee API' + (t.env === 'live' ? '' : ' UJI') + ': ' + t.name + ' (' + t.status + ')')); } catch (e) {}
  try { if (typeof kskRows_ === 'function') kskRows_().forEach(r => { if (String(r[4]) === 'AKTIF') add(String(r[2]), 'KasirKu: ' + String(r[1])); }); } catch (e) {}
  return out;
}
function finListStores_() {
  const scope = allowedStoreList_();
  const stores = finStoresFromRows_(finRows_('FinStores')).filter(s => !scope || scope.indexOf(s.code) >= 0);
  const links = finApiLinks_();
  stores.forEach(s => { s.api = links[s.code] || []; });
  return { stores: stores, allStores: !scope, platforms: FIN_PLATFORMS,
    levels: FIN_COST_LEVELS, categories: FIN_COST_CATEGORIES };
}
function finSaveStore_(p) {
  p = p || {};
  const code = String(p.code || '').trim().toUpperCase();
  const name = String(p.name || '').trim();
  const branch = String(p.branch || '').trim();
  if (!/^[A-Z0-9\-]{1,20}$/.test(code)) throw new Error('Kode toko 1–20 karakter (huruf/angka/-). Contoh: S1, TT-UTAMA.');
  if (!name) throw new Error('Nama toko wajib diisi.');
  if (!branch) throw new Error('Cabang wajib diisi.');
  const platform = FIN_PLATFORMS.indexOf(p.platform) >= 0 ? p.platform : 'Lainnya';
  // Kolom yang tidak dikirim formulir (alias, mata uang, ID toko, PJ, metode) dipertahankan dari data lama.
  const prevRow = finRows_('FinStores').find(r => String(r[0]).trim().toUpperCase() === code) || null;
  const keep = (v, i, d) => v !== undefined ? v : (prevRow ? prevRow[i] : d);
  const currency = String(keep(p.currency, 4, 'IDR') || 'IDR').trim().toUpperCase() || 'IDR';
  const aliases = String(keep(p.aliases, 6, '') || '').split(',').map(x => x.trim()).filter(Boolean).join(', ');
  if (p.platformShopId === undefined && prevRow) p.platformShopId = prevRow[8];
  if (p.pic === undefined && prevRow) p.pic = prevRow[9];
  if (p.dataMethod === undefined && prevRow) p.dataMethod = String(prevRow[10] || '');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Server sibuk, coba lagi.');
  try {
    const sh = finSheet_('FinStores');
    const rows = finRows_('FinStores');
    const others = finStoresFromRows_(rows).filter(s => s.code !== code);
    const names = [name].concat(aliases ? aliases.split(', ') : []).map(finKey_);
    others.forEach(s => {
      const used = [s.name].concat(s.aliases).map(finKey_);
      names.forEach(n => { if (used.indexOf(n) >= 0) throw new Error('Nama/alias "' + n + '" sudah dipakai toko ' + s.code + '.'); });
    });
    const idx = rows.findIndex(r => String(r[0]).trim().toUpperCase() === code);
    const before = idx >= 0 ? rows[idx].slice() : null;
    // Metode 'API' hanya label rencana; status sinkronisasi diisi oleh proses sinkron, bukan oleh formulir.
    const method = p.dataMethod === 'API' ? 'API' : 'Impor';
    const row = [code, name, platform, branch, currency, p.active === false || p.active === 'false' ? false : true, aliases, new Date(),
      String(p.platformShopId || '').trim().slice(0, 60), String(p.pic || '').trim().slice(0, 120), method,
      before ? before[11] : '', before ? (before[12] || (method === 'API' ? 'API belum terhubung' : '')) : (method === 'API' ? 'API belum terhubung' : '')];
    if (idx >= 0) sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    if (typeof auditChange_ === 'function') auditChange_(idx >= 0 ? 'store-update' : 'store-create', 'FinStores', code, before, row);
    return { success: true, message: idx >= 0 ? 'Toko diperbarui.' : 'Toko ditambahkan.' };
  } finally { lock.releaseLock(); }
}

/** Hapus toko dari Master Toko. Ditolak bila masih dipetakan ke TikTok/Shopee/KasirKu. Data transaksi lama tidak dihapus. */
function finDeleteStore_(p) {
  p = p || {};
  const code = String(p.code || '').trim().toUpperCase();
  if (String(p.confirm || '') !== 'HAPUS') throw new Error('Ketik HAPUS untuk konfirmasi.');
  const links = finApiLinks_()[code] || [];
  if (links.length) throw new Error('Toko ' + code + ' masih terhubung ke: ' + links.join('; ') + '. Lepas pemetaannya dulu di Koneksi Toko.');
  return withScriptLock_(function() {
    const rows = finRows_('FinStores'), idx = rows.findIndex(r => String(r[0]).trim().toUpperCase() === code);
    if (idx < 0) throw new Error('Toko ' + code + ' tidak ditemukan.');
    finSheet_('FinStores').deleteRow(idx + 2);
    if (typeof auditChange_ === 'function') auditChange_('store-delete', 'FinStores', code, rows[idx], null);
    if (typeof plMarkDirty_ === 'function') plMarkDirty_('');
    return { success: true, message: 'Toko ' + code + ' dihapus dari Master Toko. Data penjualan/biaya lama dengan kode ini tetap tersimpan (tidak dihapus).' };
  });
}

/* ---------------- biaya ---------------- */
function finSaveCost_(p) {
  p = p || {};
  const date = finDate_(p.date);
  if (!date) throw new Error('Tanggal biaya tidak valid.');
  const level = FIN_COST_LEVELS.indexOf(p.level) >= 0 ? p.level : '';
  if (!level) throw new Error('Pilih level biaya: Toko, Cabang, atau Pusat.');
  const code = level === 'Pusat' ? 'PUSAT' : String(p.code || '').trim();
  if (!code) throw new Error(level === 'Toko' ? 'Pilih toko.' : 'Pilih cabang.');
  const stores = finStoresFromRows_(finRows_('FinStores'));
  if (level === 'Toko' && !stores.some(s => s.code === code)) throw new Error('Kode toko tidak ditemukan di Master Toko.');
  if (level === 'Cabang' && !stores.some(s => s.branch === code)) throw new Error('Cabang tidak ditemukan di Master Toko.');
  if (level === 'Toko') assertStoreAllowed_(code); else assertAllStoresScope_('Biaya tingkat ' + level);
  const category = String(p.category || '').trim();
  if (!category) throw new Error('Kategori biaya wajib diisi.');
  const amount = finNum_(p.amount);
  if (amount === null || amount < 0) throw new Error('Nominal biaya harus angka 0 atau lebih.');
  const actor = (typeof TEAM_REQUEST_CONTEXT_ !== 'undefined' && TEAM_REQUEST_CONTEXT_) ? TEAM_REQUEST_CONTEXT_.email : '';
  const sh = finSheet_('FinCosts');
  const id = p.id ? String(p.id) : Utilities.getUuid();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Server sibuk, coba lagi.');
  try {
  const rows = finRows_('FinCosts');
  const idx = p.id ? rows.findIndex(r => String(r[0]) === id) : -1;
  if (p.id && idx < 0) throw new Error('Biaya yang mau diedit tidak ditemukan.');
  if (idx >= 0 && String(rows[idx][9]) === 'DIBATALKAN') throw new Error('Biaya ini sudah dibatalkan dan tidak bisa diedit. Catat biaya baru bila perlu.');
  if (idx >= 0) { if (String(rows[idx][2]) === 'Toko') assertStoreAllowed_(rows[idx][3]); else assertAllStoresScope_('Mengubah biaya cabang/pusat'); }
  const before = idx >= 0 ? rows[idx].slice() : null;
  const row = [id, date, level, code, category, amount, String(p.note || '').slice(0, 300), actor, new Date(), 'AKTIF', '', ''];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  if (typeof auditChange_ === 'function') auditChange_(idx >= 0 ? 'cost-update' : 'cost-create', 'FinCosts', id, before, row);
  } finally { lock.releaseLock(); }
  return { success: true, id: id, message: p.id ? 'Biaya diperbarui.' : 'Biaya disimpan.' };
}
/** Biaya tidak dihapus permanen: ditandai DIBATALKAN, tercatat siapa & kapan, dan tidak masuk laporan. */
function finDeleteCost_(id) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Server sibuk, coba lagi.');
  try {
    const rows = finRows_('FinCosts');
    const idx = rows.findIndex(r => String(r[0]) === String(id));
    if (idx < 0) throw new Error('Biaya tidak ditemukan.');
    if (String(rows[idx][2]) === 'Toko') assertStoreAllowed_(rows[idx][3]); else assertAllStoresScope_('Membatalkan biaya cabang/pusat');
    if (String(rows[idx][9]) === 'DIBATALKAN') return { success: true, message: 'Biaya sudah dibatalkan sebelumnya.' };
    const before = rows[idx].slice();
    const actor = (typeof TEAM_REQUEST_CONTEXT_ !== 'undefined' && TEAM_REQUEST_CONTEXT_) ? TEAM_REQUEST_CONTEXT_.email : '';
    const after = before.slice(); after[9] = 'DIBATALKAN'; after[10] = actor; after[11] = new Date();
    finSheet_('FinCosts').getRange(idx + 2, 1, 1, after.length).setValues([after]);
    if (typeof auditChange_ === 'function') auditChange_('cost-cancel', 'FinCosts', String(id), before, after);
    return { success: true, message: 'Biaya dibatalkan (riwayat tetap tersimpan).' };
  } finally { lock.releaseLock(); }
}
function finListCosts_(f) {
  f = f || {};
  const scope = allowedStoreList_();
  return finRows_('FinCosts').filter(r => r[0] && String(r[9]) !== 'DIBATALKAN' &&
    (!scope || (String(r[2]) === 'Toko' && scope.indexOf(String(r[3]).trim()) >= 0))).map(r => ({
    id: String(r[0]), date: finDate_(r[1]), level: String(r[2]), code: String(r[3]),
    category: String(r[4]), amount: finNum_(r[5]), note: String(r[6] || ''), by: String(r[7] || '')
  })).filter(c => (!f.start || c.date >= f.start) && (!f.end || c.date <= f.end))
    .sort((a, b) => a.date < b.date ? 1 : -1);
}

/* ---------------- impor penjualan (BigSeller / marketplace) ---------------- */
const FIN_ALIASES = {
  date: ['tanggal', 'tanggal pesanan', 'waktu pesanan dibuat', 'waktu pembuatan pesanan', 'waktu dibuat', 'order date', 'created time', 'order created time', 'waktu bayar', 'tanggal bayar', 'date'],
  store: ['nama toko', 'toko', 'shop', 'shop name', 'store', 'store name', 'nama toko marketplace'],
  order: ['nomor pesanan', 'no. pesanan', 'no pesanan', 'id pesanan', 'order id', 'order number', 'order no'],
  sku: ['sku', 'sku penjual', 'seller sku', 'sku gudang', 'sku master', 'kode sku', 'sku produk'],
  product: ['nama produk', 'produk', 'product name', 'nama barang', 'judul produk'],
  qty: ['jumlah', 'qty', 'quantity', 'kuantitas', 'jumlah produk', 'jumlah terjual'],
  omzet: ['omzet', 'total penjualan', 'penjualan', 'subtotal produk', 'total harga produk', 'harga total', 'gmv', 'nilai pesanan', 'jumlah penjualan', 'sales amount'],
  income: ['pendapatan platform', 'pendapatan', 'estimasi pendapatan', 'penghasilan', 'dana penjualan', 'pendapatan penjualan', 'income', 'settlement amount', 'total penghasilan'],
  cost: ['modal', 'hpp', 'harga modal', 'total modal', 'biaya produk', 'cogs', 'cost', 'harga pokok'],
  currency: ['mata uang', 'currency'],
  status: ['status pesanan', 'order status', 'status', 'status order']
};
/** Pesanan batal / belum dibayar bukan penjualan. Pola dicocokkan pada teks status (huruf kecil). */
const FIN_EXCLUDED_STATUS = /cancel|batal|unpaid|belum bayar|belum dibayar|menunggu pembayaran|awaiting payment|gagal/;
/** payload: {fileName, rows:[{kolom:nilai}], defaultStore?} — kolom data pembeli disaring di browser. */
function finImportSales_(payload) {
  if (!payload || !Array.isArray(payload.rows) || !payload.rows.length) throw new Error('File tidak berisi baris data.');
  if (payload.rows.length > 30000) throw new Error('Maksimal 30.000 baris per impor. Ekspor periode lebih pendek.');
  const stores = finStoresFromRows_(finRows_('FinStores'));
  if (!stores.length) throw new Error('Isi Master Toko dulu sebelum impor.');
  const byName = {};
  stores.forEach(s => { [s.name].concat(s.aliases, [s.code]).forEach(n => { byName[finKey_(n)] = s; }); });
  const fallback = payload.defaultStore ? stores.find(s => s.code === payload.defaultStore) : null;
  if (payload.defaultStore && !fallback) throw new Error('Toko pilihan ' + payload.defaultStore + ' tidak ada di Master Toko.');
  if (fallback) assertStoreAllowed_(fallback.code);
  const denied = {};
  const importId = Utilities.getUuid(), now = new Date(), file = String(payload.fileName || 'File').slice(0, 200);
  const rowsIn = applyColumnMap_(payload.rows, 'fin', payload.columnMap);
  const seen = {}, out = [], unknown = {}, problems = [];
  let missingCost = 0, missingIncome = 0, excludedStatus = 0, noStatus = 0, usedDefaultStore = 0;
  rowsIn.forEach((r, i) => {
    const line = i + 2;
    const date = finDate_(finPick_(r, FIN_ALIASES.date));
    if (!date) { problems.push('Baris ' + line + ': tanggal tidak valid'); return; }
    const storeRaw = finPick_(r, FIN_ALIASES.store);
    const store = storeRaw !== undefined && String(storeRaw).trim() ? byName[finKey_(storeRaw)] : fallback;
    if (!store) { unknown[String(storeRaw || '(kosong)')] = (unknown[String(storeRaw || '(kosong)')] || 0) + 1; return; }
    if (!(storeRaw !== undefined && String(storeRaw).trim())) usedDefaultStore++;
    if (!scopeAllows_(store.code)) { denied[store.code] = (denied[store.code] || 0) + 1; return; }
    const status = String(finPick_(r, FIN_ALIASES.status) || '').trim();
    // Pesanan batal/belum bayar TETAP disimpan dengan statusnya, agar pesanan yang dulu tercatat
    // "selesai" lalu dibatalkan ikut diperbarui. Laporan tidak menghitungnya sebagai penjualan.
    if (status && FIN_EXCLUDED_STATUS.test(status.toLowerCase())) excludedStatus++;
    if (!status) noStatus++;
    const order = String(finPick_(r, FIN_ALIASES.order) || '').trim();
    const sku = String(finPick_(r, FIN_ALIASES.sku) || '').trim();
    const product = String(finPick_(r, FIN_ALIASES.product) || '').trim();
    if (!order) { problems.push('Baris ' + line + ': nomor pesanan kosong'); return; }
    const qty = finNum_(finPick_(r, FIN_ALIASES.qty));
    const omzet = finNum_(finPick_(r, FIN_ALIASES.omzet));
    const income = finNum_(finPick_(r, FIN_ALIASES.income));
    const cost = finNum_(finPick_(r, FIN_ALIASES.cost));
    if (omzet === null && income === null) { problems.push('Baris ' + line + ': omzet & pendapatan kosong'); return; }
    if (cost === null) missingCost++;
    if (income === null) missingIncome++;
    const currency = String(finPick_(r, FIN_ALIASES.currency) || store.currency || 'IDR').trim().toUpperCase().replace(/^(RP|RUPIAH)$/, 'IDR');
    const base = store.code + '|' + order + '|' + (sku || product);
    seen[base] = (seen[base] || 0) + 1;
    const ref = base + '|' + seen[base];
    out.push([ref, date, store.code, order, sku, product, qty === null ? '' : qty, omzet === null ? '' : omzet,
      income === null ? '' : income, cost === null ? '' : cost, currency, file, importId, now, status]);
  });
  const unknownList = Object.keys(unknown);
  if (unknownList.length) {
    throw new Error('Toko belum terdaftar di Master Toko: ' + unknownList.slice(0, 10).map(n => '"' + n + '" (' + unknown[n] + ' baris)').join(', ') +
      '. Tambahkan nama/alias toko tersebut, lalu impor ulang. Tidak ada data yang disimpan.');
  }
  const deniedList = Object.keys(denied);
  if (deniedList.length) throw new Error('File berisi toko yang tidak ditugaskan ke akunmu: ' + deniedList.map(c => c + ' (' + denied[c] + ' baris)').join(', ') + '. Tidak ada data yang disimpan.');
  if (!out.length) throw new Error('Tidak ada baris valid. ' + problems.slice(0, 5).join('; '));
  const storeCodes = out.map(r => r[2]).filter((c, i, a) => a.indexOf(c) === i);
  const dates = out.map(r => r[1]).sort();
  if (payload.dryRun) {
    // PRATINJAU: hitung baru/diperbarui terhadap data tersimpan, tanpa menulis apa pun.
    const known = {};
    finRows_('FinSales').forEach(r => { known[String(r[0])] = String(r[14] || ''); });
    let added = 0, updated = 0, statusChanged = 0;
    out.forEach(r => { if (Object.prototype.hasOwnProperty.call(known, r[0])) { updated++; if (known[r[0]] !== r[14]) statusChanged++; } else added++; });
    return { dryRun: true, rows: out.length, added: added, updated: updated, statusChanged: statusChanged, skipped: problems.length,
      excludedStatus: excludedStatus, noStatus: noStatus, usedDefaultStore: usedDefaultStore, missingCost: missingCost, missingIncome: missingIncome,
      problems: problems.slice(0, 20), storeCodes: storeCodes, firstDate: dates[0], lastDate: dates[dates.length - 1],
      columns: detectColumns_(payload.rows, 'fin', payload.columnMap), headers: payload.headers || [],
      sample: out.slice(0, 5).map(r => ({ date: r[1], store: r[2], order: r[3], sku: r[4], qty: r[6], omzet: r[7], income: r[8], cost: r[9], status: r[14] })),
      message: 'Pratinjau: ' + added + ' baris baru, ' + updated + ' diperbarui' + (statusChanged ? ' (' + statusChanged + ' berubah status)' : '') + ', ' + problems.length + ' dilewati. ' +
        (excludedStatus ? excludedStatus + ' baris batal/belum bayar disimpan dengan statusnya dan tidak dihitung penjualan. ' : '') + 'Belum ada yang disimpan.' };
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Impor lain sedang berjalan. Coba lagi.');
  try {
    const sh = finSheet_('FinSales');
    const existing = finRows_('FinSales');
    const pos = {};
    existing.forEach((r, i) => { pos[String(r[0])] = i; });
    let updated = 0;
    const merged = existing.slice();
    const appended = [];
    out.forEach(row => {
      if (Object.prototype.hasOwnProperty.call(pos, row[0])) { merged[pos[row[0]]] = row; updated++; }
      else appended.push(row);
    });
    if (updated && merged.length) sh.getRange(2, 1, merged.length, FIN_SHEETS.FinSales.length).setValues(merged);
    if (appended.length) ensureRoom_(sh, appended.length, FIN_SHEETS.FinSales.length).getRange(sh.getLastRow() + 1, 1, appended.length, FIN_SHEETS.FinSales.length).setValues(appended);
    // Catatan proses impor (sumber, file, toko, jumlah) di ImportLog yang sama dengan impor lain.
    ensureImportSheets_().getSheetByName('ImportLog').appendRow([importId, now, 'FinSales', file, out.length, 'SUCCESS',
      (excludedStatus ? excludedStatus + ' baris batal/belum bayar (tidak dihitung). ' : '') + (problems.length ? problems.slice(0, 5).join('; ') : ''),
      storeCodes.join(','), appended.length, updated, problems.length, currentActorEmail_()]);
    return {
      success: true, importId: importId, added: appended.length, updated: updated, skipped: problems.length,
      excludedStatus: excludedStatus, noStatus: noStatus, usedDefaultStore: usedDefaultStore,
      missingCost: missingCost, missingIncome: missingIncome, problems: problems.slice(0, 20),
      message: appended.length + ' baris baru, ' + updated + ' baris diperbarui (impor ulang tidak dobel), ' + problems.length + ' baris dilewati.' +
        (excludedStatus ? ' ' + excludedStatus + ' baris batal/belum bayar disimpan dengan statusnya dan tidak dihitung sebagai penjualan.' : '') +
        (noStatus ? ' ' + noStatus + ' baris tanpa kolom status (dianggap terjual; periksa file).' : '') +
        (usedDefaultStore ? ' ' + usedDefaultStore + ' baris tanpa nama toko dimasukkan ke toko pilihan ' + fallback.code + '.' : '') +
        (missingCost ? ' ' + missingCost + ' baris modal kosong.' : '') + (missingIncome ? ' ' + missingIncome + ' baris pendapatan platform kosong.' : '')
    };
  } finally { lock.releaseLock(); }
}

/* ---------------- laporan ---------------- */
function finGetReport_(f) {
  f = f || {};
  const start = finDate_(f.start), end = finDate_(f.end);
  if (!start || !end) throw new Error('Isi tanggal mulai dan akhir.');
  if (start > end) throw new Error('Tanggal mulai tidak boleh melewati tanggal akhir.');
  const days = finDays_(start, end);
  if (days > 400) throw new Error('Rentang maksimal 400 hari.');
  const prevEnd = finAddDays_(start, -1), prevStart = finAddDays_(start, -days);
  const scope = allowedStoreList_();
  const stores = finStoresFromRows_(finRows_('FinStores')).filter(s => !scope || scope.indexOf(s.code) >= 0);
  const sales = finRows_('FinSales').filter(r => r[0] && (!scope || scope.indexOf(String(r[2])) >= 0)).map(r => ({
    date: finDate_(r[1]), store: String(r[2]), order: String(r[3]), sku: String(r[4]), product: String(r[5]),
    qty: finNum_(r[6]), omzet: finNum_(r[7]), income: finNum_(r[8]), cost: finNum_(r[9]), currency: String(r[10] || 'IDR'),
    status: String(r[14] || '')
  })).filter(x => !(x.status && FIN_EXCLUDED_STATUS.test(x.status.toLowerCase())));
  const costs = finListCosts_({});
  const rules = Object.assign({}, FIN_DEFAULT_RULES, f.rules || {});
  const report = finBuildReport_(stores, sales, costs, { start: start, end: end, prevStart: prevStart, prevEnd: prevEnd, rules: rules });
  report.scope = scope ? { allStores: false, stores: scope } : { allStores: true };
  if (scope) report.notes.unshift('Laporan dibatasi pada toko yang ditugaskan (' + (scope.join(', ') || 'belum ada') + '). Biaya cabang/pusat tidak ditampilkan, jadi laba bersih kantor tidak tersedia di akun ini.');
  return report;
}

/** Perhitungan murni (tanpa akses sheet) agar bisa diuji. */
function finBuildReport_(stores, sales, costs, opt) {
  const rules = opt.rules || FIN_DEFAULT_RULES;
  const storeMap = {};
  stores.forEach(s => { storeMap[s.code] = s; });
  const inRange = (d, a, b) => d >= a && d <= b;
  const empty = () => ({ omzet: 0, income: 0, cost: 0, contribution: 0, ads: 0, otherDirect: 0, rows: 0,
    missingCost: 0, missingCostOmzet: 0, missingIncome: 0, costedOmzet: 0, orders: {} });

  function aggregate(a, b) {
    const per = {}, foreign = {}, skus = {};
    sales.forEach(x => {
      if (!inRange(x.date, a, b)) return;
      const st = storeMap[x.store];
      if (!st) return;
      if (x.currency !== 'IDR') { foreign[x.currency] = (foreign[x.currency] || 0) + (x.omzet !== null ? x.omzet : (x.income || 0)); return; }
      const p = per[x.store] || (per[x.store] = empty());
      p.rows++;
      p.orders[x.order] = true;
      const om = x.omzet !== null ? x.omzet : x.income;
      p.omzet += om;
      if (x.income === null) p.missingIncome++;
      else p.income += x.income;
      if (x.cost === null) { p.missingCost++; p.missingCostOmzet += om; }
      else p.cost += x.cost;
      if (x.income !== null && x.cost !== null) { p.contribution += x.income - x.cost; p.costedOmzet += om; }
      const key = x.store + '|' + (x.sku || x.product);
      const k = skus[key] || (skus[key] = { store: x.store, sku: x.sku, product: x.product, qty: 0, omzet: 0, profit: 0, hasProfit: false, missingCost: false });
      k.qty += x.qty || 0; k.omzet += om;
      if (x.income !== null && x.cost !== null) { k.profit += x.income - x.cost; k.hasProfit = true; }
      if (x.cost === null) k.missingCost = true;
    });
    const branchCosts = {}, centralCosts = { total: 0, byCat: {} };
    costs.forEach(c => {
      if (!inRange(c.date, a, b) || c.amount === null) return;
      if (c.level === 'Toko' && storeMap[c.code]) {
        const p = per[c.code] || (per[c.code] = empty());
        if (c.category === 'Iklan') p.ads += c.amount; else p.otherDirect += c.amount;
      } else if (c.level === 'Cabang') {
        const bc = branchCosts[c.code] || (branchCosts[c.code] = { total: 0, byCat: {} });
        bc.total += c.amount; bc.byCat[c.category] = (bc.byCat[c.category] || 0) + c.amount;
      } else if (c.level === 'Pusat') {
        centralCosts.total += c.amount; centralCosts.byCat[c.category] = (centralCosts.byCat[c.category] || 0) + c.amount;
      }
    });
    return { per: per, foreign: foreign, skus: skus, branchCosts: branchCosts, centralCosts: centralCosts };
  }

  function finalize(p) {
    const r = {
      omzet: p.omzet, income: p.income, cost: p.cost, contribution: p.contribution, ads: p.ads, otherDirect: p.otherDirect,
      orders: Object.keys(p.orders).length, rows: p.rows, missingCost: p.missingCost, missingIncome: p.missingIncome,
      missingCostOmzet: p.missingCostOmzet
    };
    r.profitAfterAds = r.contribution - r.ads - r.otherDirect;
    // margin dihitung dari total, hanya omzet yang modalnya lengkap sebagai penyebut kontribusi
    r.complete = p.missingCost === 0 && p.missingIncome === 0;
    // Margin hanya dihitung bila modal & pendapatan lengkap; selain itu laba BELUM FINAL dan margin null.
    r.margin = r.omzet && r.complete ? r.profitAfterAds / r.omzet * 100 : null;
    r.adsRatio = r.omzet ? r.ads / r.omzet * 100 : null;
    return r;
  }
  function sum(list) {
    const t = { omzet: 0, income: 0, cost: 0, contribution: 0, ads: 0, otherDirect: 0, orders: 0, rows: 0, missingCost: 0, missingIncome: 0, missingCostOmzet: 0 };
    list.forEach(x => Object.keys(t).forEach(k => { t[k] += x[k] || 0; }));
    t.profitAfterAds = t.contribution - t.ads - t.otherDirect;
    t.complete = t.missingCost === 0 && t.missingIncome === 0;
    t.margin = t.omzet && t.complete ? t.profitAfterAds / t.omzet * 100 : null;
    t.adsRatio = t.omzet ? t.ads / t.omzet * 100 : null;
    return t;
  }
  function build(agg) {
    const storeRows = stores.map(s => {
      const r = finalize(agg.per[s.code] || empty());
      r.code = s.code; r.name = s.name; r.platform = s.platform; r.branch = s.branch; r.active = s.active;
      return r;
    }).filter(r => r.rows || r.ads || r.otherDirect);
    const branches = {};
    storeRows.forEach(r => { (branches[r.branch] = branches[r.branch] || []).push(r); });
    Object.keys(agg.branchCosts).forEach(b => { if (!branches[b]) branches[b] = []; });
    const branchRows = Object.keys(branches).sort().map(b => {
      const t = sum(branches[b]);
      const bc = agg.branchCosts[b] || { total: 0, byCat: {} };
      t.name = b; t.branchCosts = bc.total; t.branchCostsByCat = bc.byCat;
      t.netProfit = t.profitAfterAds - bc.total;
      t.netMargin = t.omzet && t.complete ? t.netProfit / t.omzet * 100 : null;
      t.channels = {};
      branches[b].forEach(r => { (t.channels[r.platform] = t.channels[r.platform] || []).push(r); });
      Object.keys(t.channels).forEach(c => { const s = sum(t.channels[c]); t.channels[c] = s; });
      return t;
    });
    const channels = {};
    storeRows.forEach(r => { (channels[r.platform] = channels[r.platform] || []).push(r); });
    const channelRows = Object.keys(channels).map(c => { const t = sum(channels[c]); t.name = c; return t; })
      .sort((a, b) => b.omzet - a.omzet);
    const total = sum(storeRows);
    total.branchCosts = branchRows.reduce((a, b) => a + b.branchCosts, 0);
    total.centralCosts = agg.centralCosts.total;
    total.centralCostsByCat = agg.centralCosts.byCat;
    total.netProfit = total.profitAfterAds - total.branchCosts - total.centralCosts;
    total.netMargin = total.omzet && total.complete ? total.netProfit / total.omzet * 100 : null;
    total.final = total.complete;
    return { total: total, branches: branchRows, channels: channelRows, stores: storeRows, foreign: agg.foreign, skus: agg.skus };
  }

  const cur = build(aggregate(opt.start, opt.end));
  const prev = build(aggregate(opt.prevStart, opt.prevEnd));
  const idx = list => { const m = {}; list.forEach(x => { m[x.code || x.name] = x; }); return m; };
  const pStores = idx(prev.stores), pBranches = idx(prev.branches), pChannels = idx(prev.channels);
  const cmp = (c, p) => {
    if (!p) return { omzetChangePct: null, prevMargin: null, marginChangePt: null };
    return {
      omzetChangePct: p.omzet ? (c.omzet - p.omzet) / Math.abs(p.omzet) * 100 : null,
      prevMargin: p.margin,
      marginChangePt: c.margin !== null && p.margin !== null ? c.margin - p.margin : null
    };
  };
  cur.total.compare = cmp(cur.total, prev.total.rows ? prev.total : null);
  cur.stores.forEach(s => { s.compare = cmp(s, pStores[s.code]); });
  cur.branches.forEach(b => { b.compare = cmp(b, pBranches[b.name]); });
  cur.channels.forEach(c => { c.compare = cmp(c, pChannels[c.name]); });

  // peringatan
  const alerts = [];
  const scan = (label, x) => {
    if (x.compare.omzetChangePct !== null && x.compare.omzetChangePct <= -rules.omzetDropPct) alerts.push({ type: 'omzet', text: 'Omzet ' + label + ' turun ' + Math.abs(x.compare.omzetChangePct).toFixed(0) + '%' });
    if (x.compare.marginChangePt !== null && x.compare.marginChangePt <= -rules.marginDropPt) alerts.push({ type: 'margin', text: 'Margin ' + label + ' turun ' + Math.abs(x.compare.marginChangePt).toFixed(1) + ' poin' });
    if (x.margin !== null && x.margin < 0) alerts.push({ type: 'negatif', text: 'Margin ' + label + ' negatif (' + x.margin.toFixed(1) + '%)' });
  };
  cur.channels.forEach(c => scan(c.name, c));
  cur.branches.forEach(b => scan('cabang ' + b.name, b));
  cur.stores.forEach(s => scan(s.name, s));
  const skuList = Object.keys(cur.skus).map(k => cur.skus[k]);
  const label = k => (storeMap[k.store] ? storeMap[k.store].code : k.store) + ' ' + (k.sku || k.product);
  const loss = skuList.filter(k => k.hasProfit && k.profit < 0 && !(k.omzet > 0 && -k.profit > k.omzet * rules.abnormalLossPct / 100))
    .sort((a, b) => a.profit - b.profit).map(k => ({ label: label(k), product: k.product, profit: k.profit, qty: k.qty, omzet: k.omzet }));
  const abnormal = skuList.filter(k => k.hasProfit && k.profit < 0 && k.omzet > 0 && -k.profit > k.omzet * rules.abnormalLossPct / 100)
    .sort((a, b) => a.profit - b.profit).map(k => ({ label: label(k), product: k.product, profit: k.profit, qty: k.qty, omzet: k.omzet }));
  const noCost = skuList.filter(k => k.missingCost).map(k => ({ label: label(k), product: k.product, qty: k.qty, omzet: k.omzet }));
  const storesWithoutAds = cur.stores.filter(s => s.rows && !s.ads && s.platform !== 'POS/Toko').map(s => s.name);

  return {
    period: { start: opt.start, end: opt.end, prevStart: opt.prevStart, prevEnd: opt.prevEnd },
    total: cur.total, branches: cur.branches, channels: cur.channels, stores: cur.stores,
    alerts: alerts, lossProducts: loss, abnormalLoss: abnormal, missingCostSkus: noCost,
    storesWithoutAds: storesWithoutAds, foreignCurrency: cur.foreign, rules: rules,
    notes: [
      'Laba kontribusi = pendapatan platform − modal (hanya baris yang keduanya tersedia).',
      'Laba setelah iklan = laba kontribusi − iklan toko − biaya langsung toko.',
      'Laba bersih = laba setelah iklan − biaya cabang − biaya pusat. Biaya cabang/pusat tidak dibagi ke toko.',
      'Baris dengan modal kosong tetap dihitung di omzet, tapi tidak masuk laba (ditandai). Selama masih ada, laba BELUM FINAL dan margin tidak ditampilkan.',
      'Pesanan berstatus batal/belum bayar tersimpan dengan statusnya tetapi tidak dihitung sebagai penjualan. Retur/refund belum direkonsiliasi.',
      'Mata uang selain IDR tidak dijumlahkan.'
    ]
  };
}

/** Uji perhitungan dengan data contoh (tanpa membaca/menulis sheet). Hapus setelah verifikasi. */
function ujiKeuangan_() {
  const stores = [
    { code: 'S1', name: 'Shopee 1', platform: 'Shopee', branch: 'Jatiwarna', currency: 'IDR', active: true, aliases: [] },
    { code: 'TT1', name: 'Tiktok Utama', platform: 'TikTok', branch: 'Jatiwarna', currency: 'IDR', active: true, aliases: [] },
    { code: 'KG', name: 'Offline KG', platform: 'POS/Toko', branch: 'Kelapa Gading', currency: 'IDR', active: true, aliases: [] }
  ];
  const sales = [
    // minggu ini 2026-11-02..08
    { date: '2026-11-02', store: 'S1', order: 'A1', sku: 'P1', product: 'Polybag', qty: 10, omzet: 100000, income: 90000, cost: 60000, currency: 'IDR' },
    { date: '2026-11-03', store: 'S1', order: 'A2', sku: 'P2', product: 'Paranet', qty: 1, omzet: 50000, income: 45000, cost: 70000, currency: 'IDR' },
    { date: '2026-11-04', store: 'TT1', order: 'B1', sku: 'P1', product: 'Polybag', qty: 5, omzet: 40000, income: 36000, cost: null, currency: 'IDR' },
    { date: '2026-11-05', store: 'KG', order: 'C1', sku: 'P3', product: 'Cocopeat', qty: 2, omzet: 30000, income: 30000, cost: 18000, currency: 'IDR' },
    { date: '2026-11-05', store: 'S1', order: 'X1', sku: 'P1', product: 'Polybag', qty: 1, omzet: 99, income: 90, cost: 50, currency: 'MYR' },
    // minggu lalu 2026-10-26..11-01
    { date: '2026-10-27', store: 'S1', order: 'Z1', sku: 'P1', product: 'Polybag', qty: 20, omzet: 200000, income: 180000, cost: 120000, currency: 'IDR' }
  ];
  const costs = [
    { date: '2026-11-02', level: 'Toko', code: 'S1', category: 'Iklan', amount: 10000 },
    { date: '2026-11-03', level: 'Cabang', code: 'Jatiwarna', category: 'Gaji', amount: 20000 },
    { date: '2026-11-04', level: 'Pusat', code: 'PUSAT', category: 'Internet', amount: 5000 }
  ];
  const r = finBuildReport_(stores, sales, costs, { start: '2026-11-02', end: '2026-11-08', prevStart: '2026-10-26', prevEnd: '2026-11-01', rules: FIN_DEFAULT_RULES });
  const expect = (label, got, want) => {
    const ok = want === null ? got === null : Math.abs(got - want) < 1e-6;
    console.log((ok ? 'LULUS ' : 'GAGAL ') + label + ' -> dapat ' + got + ', harap ' + want);
    return ok;
  };
  let ok = true;
  // Omzet IDR: 100000+50000+40000+30000 = 220000 (MYR dipisah)
  ok = expect('Total omzet', r.total.omzet, 220000) && ok;
  // Kontribusi: (90000-60000)+(45000-70000)+(30000-18000) = 30000-25000+12000 = 17000 (TT1 modal kosong tidak dihitung)
  ok = expect('Laba kontribusi', r.total.contribution, 17000) && ok;
  ok = expect('Iklan', r.total.ads, 10000) && ok;
  ok = expect('Laba setelah iklan', r.total.profitAfterAds, 7000) && ok;
  ok = expect('Laba bersih (− gaji cabang − internet pusat)', r.total.netProfit, -18000) && ok;
  const s1 = r.stores.filter(s => s.code === 'S1')[0];
  ok = expect('S1 omzet berubah % (150rb vs 200rb)', s1.compare.omzetChangePct, -25) && ok;
  ok = expect('Baris modal kosong', r.total.missingCost, 1) && ok;
  ok = expect('SKU rugi (P2)', r.lossProducts.length + r.abnormalLoss.length, 1) && ok;
  ok = expect('Mata uang asing dipisah (MYR)', r.foreignCurrency.MYR, 99) && ok;
  const empty = finBuildReport_(stores, [], [], { start: '2026-06-01', end: '2026-06-30', prevStart: '2026-05-02', prevEnd: '2026-05-31', rules: FIN_DEFAULT_RULES });
  ok = expect('Margin saat kosong = null', empty.total.margin, null) && ok;
  ok = expect('Parser 1.250.000', finNum_('Rp1.250.000'), 1250000) && ok;
  ok = expect('Parser 15.000', finNum_('15.000'), 15000) && ok;
  ok = expect('Parser kosong = null', finNum_(''), null) && ok;
  console.log('Tanggal 02/11/2026 10:22 -> ' + finDate_('02/11/2026 10:22') + ' (harap 2026-11-02)');
  console.log(ok ? 'SEMUA UJI LULUS' : 'ADA UJI GAGAL');
  return ok;
}

/* ---------------- teks laporan WhatsApp ---------------- */
function finReportText_(f) {
  const r = finGetReport_(f);
  const jt = v => v === null || v === undefined ? '—' : (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2).replace('.', ',') + ' jt' : Math.round(v / 1000) + ' rb');
  const pct = v => v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + '%';
  const mg = v => v === null || v === undefined ? '—' : v.toFixed(1).replace('.', ',') + '%';
  const L = [];
  L.push('📊 LAPORAN KEUANGAN', r.period.start + ' s/d ' + r.period.end + ' (vs ' + r.period.prevStart + ' s/d ' + r.period.prevEnd + ')', '');
  L.push('TOTAL SEMUA CABANG', 'Omzet: ' + jt(r.total.omzet) + ' (' + pct(r.total.compare.omzetChangePct) + ')', 'Iklan: ' + jt(r.total.ads),
    'Laba stlh iklan: ' + jt(r.total.profitAfterAds) + ' · margin ' + mg(r.total.margin) + ' (lalu ' + mg(r.total.compare.prevMargin) + ')',
    'Biaya cabang+pusat: ' + jt(r.total.branchCosts + r.total.centralCosts),
    (r.total.complete ? 'LABA BERSIH: ' : 'LABA BERSIH (BELUM FINAL): ') + jt(r.total.netProfit) + ' · margin ' + mg(r.total.netMargin), '');
  if (!r.total.complete) L.push('⚠️ Belum final: ' + r.total.missingCost + ' baris modal kosong, ' + r.total.missingIncome + ' baris pendapatan platform kosong.', '');
  L.push('🏪 Per cabang');
  r.branches.forEach(b => L.push(b.name + ': ' + jt(b.omzet) + ' (' + pct(b.compare.omzetChangePct) + ') · Iklan ' + jt(b.ads),
    '   Laba stlh iklan ' + jt(b.profitAfterAds) + ' · margin ' + mg(b.margin) + ' · Laba bersih ' + jt(b.netProfit)));
  L.push('', '📡 Per channel');
  r.channels.forEach(c => L.push(c.name + ': ' + jt(c.omzet) + ' (' + pct(c.compare.omzetChangePct) + ') · Iklan ' + jt(c.ads) + ' · margin ' + mg(c.margin)));
  L.push('', '🛒 Per toko');
  r.stores.forEach(s => L.push('• ' + s.name + ': ' + jt(s.omzet) + ' (' + pct(s.compare.omzetChangePct) + ') · Iklan ' + jt(s.ads) + ' · margin ' + mg(s.margin)));
  if (r.alerts.length) { L.push('', '⚠️ Perlu perhatian'); r.alerts.forEach(a => L.push('• ' + a.text)); }
  if (r.storesWithoutAds.length) L.push('', 'ℹ️ Belum ada data iklan: ' + r.storesWithoutAds.join(', '));
  if (r.lossProducts.length) { L.push('', '🔻 Produk rugi (sblm iklan)'); r.lossProducts.slice(0, 15).forEach(p => L.push('• ' + p.label + ': ' + jt(p.profit) + ' (' + p.qty + ' pcs, omzet ' + jt(p.omzet) + ')')); }
  if (r.abnormalLoss.length) { L.push('', '🔍 Rugi tidak wajar (>' + r.rules.abnormalLossPct + '% omzet)'); r.abnormalLoss.slice(0, 15).forEach(p => L.push('• ' + p.label + ': ' + jt(p.profit) + ' (' + p.qty + ' pcs, omzet ' + jt(p.omzet) + ')')); }
  if (r.missingCostSkus.length) { L.push('', '❓ Terjual tapi modal kosong (' + r.missingCostSkus.length + ' SKU)'); r.missingCostSkus.slice(0, 15).forEach(p => L.push('• ' + p.label + ' (' + p.qty + ' pcs, ' + jt(p.omzet) + ')')); }
  L.push('', 'Laba bersih sudah dikurangi biaya cabang & pusat yang tercatat. Baris modal kosong tidak masuk laba.');
  return { text: L.join('\n') };
}
