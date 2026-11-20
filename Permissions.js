/**
 * Izin per anggota (centang per fitur). Peran = template awal; pemilik bisa menambah/mengurangi izin tiap orang.
 * Disimpan di Script Property TEAM_PERMS_JSON {email: [kunci izin]}. Anggota tanpa pengaturan khusus memakai template perannya.
 * Server tetap menjadi penentu: setiap panggilan teamRpc dicek terhadap izin ini (bukan hanya tombol yang disembunyikan).
 * Tindakan khusus pemilik (kelola tim, sambung/putus toko, notifikasi, master toko, arsip/backup, dsb.) tidak bisa didelegasikan.
 */
const PERM_CATALOG_ = [
  { key: 'keuangan', label: 'Lihat Pusat Keuangan, laba rugi & laporan', methods: ['getDashboardData', 'getRecentTransactions', 'getImportedAnalytics', 'getAdsPerformanceData', 'listProducts', 'getAdvertiserInsights', 'getShopFlexibleAnalytics', 'getSelectedDashboardData', 'finGetReport', 'plReport', 'plReportText', 'finListStores', 'finListCosts', 'finReportText', 'plGetData', 'plListCosts', 'plListSku', 'listImportLog', 'getImportFields'] },
  { key: 'biaya', label: 'Catat biaya toko & transaksi', methods: ['plSaveCost', 'finSaveCost', 'finDeleteCost', 'addTransaction', 'finImportSales'] },
  { key: 'gudang', label: 'SKU gudang: ubah HPP & stok', methods: ['skuGudangList', 'skuGudangSave', 'stockGet', 'stockSave', 'stockApply', 'plSaveSku', 'plSkuBulk'] },
  { key: 'pemetaan', label: 'Pemetaan SKU', methods: ['skuMapList', 'skuMapSave', 'skuMapFetchNames'] },
  { key: 'produk', label: 'Lihat Data Produk (harga, stok, margin)', methods: ['prodList'] },
  { key: 'produk_ubah', label: 'Ubah harga / nonaktifkan / HAPUS produk di TikTok', risky: true, methods: ['prodAction', 'skuEditPreview', 'skuEditApply'] },
  { key: 'pesanan', label: 'Lihat pesanan', methods: ['ordersList', 'ordersRefresh'] },
  { key: 'kirim', label: 'Atur pengiriman & cetak resi', risky: true, methods: ['ordShipInfo', 'ordShip', 'ordLabel'] },
  { key: 'ai', label: 'Analis AI', methods: ['askAnalyticsAI', 'recordWorkChat'] },
  { key: 'koneksi', label: 'Lihat koneksi toko & jalankan sinkron data', methods: ['ttsGetConnections', 'ttsSyncNow', 'spGetConnections', 'spSyncNow', 'kasirkuDevices', 'plRebuild'] },
  { key: 'impor', label: 'Impor data Excel (Shop Analytics, GMV Max) & produk', methods: ['importShopFlexibleRows', 'importGmvMaxWithHistory', 'saveProduct'] },
  { key: 'tugas', label: 'Target, checklist & aktivitas harian', methods: ['getWorkDay', 'getWorkHistory', 'getWorkCampaigns', 'listWorkArchives', 'readWorkArchive', 'readWorkChat', 'saveWorkTask', 'seedDailyWorkTasks', 'recordWorkActivity', 'saveWorkCampaign'] }
];
const PERM_ALWAYS_ = ['getMyAccess'];
/** Template per peran (mendekati hak lama tiap peran). */
const PERM_PRESETS_ = {
  viewer: ['keuangan', 'produk', 'pesanan', 'tugas'],
  member: ['keuangan', 'produk', 'pesanan', 'ai', 'tugas'],
  admin: ['keuangan', 'produk', 'pesanan', 'ai', 'tugas', 'biaya', 'gudang', 'impor', 'kirim'],
  finance: ['keuangan', 'produk', 'pesanan', 'ai', 'tugas', 'biaya', 'gudang', 'pemetaan', 'koneksi', 'impor']
};

function permStore_() {
  try { const o = JSON.parse(PropertiesService.getScriptProperties().getProperty('TEAM_PERMS_JSON') || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
  catch (e) { return {}; }
}
/** Izin efektif seorang anggota. Owner = semua. */
function permOf_(email, role) {
  if (role === 'owner') return PERM_CATALOG_.map(function(p) { return p.key; });
  const custom = permStore_()[String(email || '').toLowerCase()];
  const keys = Array.isArray(custom) ? custom : (PERM_PRESETS_[role] || []);
  const known = PERM_CATALOG_.map(function(p) { return p.key; });
  return keys.filter(function(k) { return known.indexOf(k) >= 0; });
}
/** Daftar fungsi server yang boleh dipanggil anggota (selain owner). */
function permMethods_(email, role) {
  const keys = permOf_(email, role), out = PERM_ALWAYS_.slice();
  PERM_CATALOG_.forEach(function(p) { if (keys.indexOf(p.key) >= 0) p.methods.forEach(function(m) { if (out.indexOf(m) < 0) out.push(m); }); });
  return out;
}
function permCustom_(email) { return Array.isArray(permStore_()[String(email || '').toLowerCase()]); }
/** Simpan izin (pemilik). perms: [kunci]. reset:true → kembali ke template peran. */
function permSet_(actor, email, perms, reset) {
  email = String(email || '').trim().toLowerCase();
  const members = teamMembers_();
  if (!members[email]) throw new Error('Anggota belum aktif.');
  if (members[email] === 'owner') throw new Error('Owner selalu punya semua akses.');
  const known = PERM_CATALOG_.map(function(p) { return p.key; });
  const clean = (Array.isArray(perms) ? perms : []).map(String).filter(function(k, i, a) { return known.indexOf(k) >= 0 && a.indexOf(k) === i; });
  const all = permStore_(), before = permOf_(email, members[email]);
  if (reset) delete all[email]; else all[email] = clean;
  PropertiesService.getScriptProperties().setProperty('TEAM_PERMS_JSON', JSON.stringify(all));
  try { auditChange_('team-perms', 'Izin', email, before, reset ? 'template ' + members[email] : clean); } catch (e) { /* audit opsional */ }
  return { ok: true, message: 'Akses ' + email + ' disimpan (' + (reset ? 'template peran' : clean.length + ' izin') + ').' };
}
function permCatalogPublic_() {
  return { catalog: PERM_CATALOG_.map(function(p) { return { key: p.key, label: p.label, risky: !!p.risky }; }), presets: PERM_PRESETS_ };
}

/**
 * Jalankan SEKALI dari editor Apps Script: akun reviewer Shopee (Pembaca) → HANYA BACA.
 * Izin: Pusat Keuangan, Data Produk, Pesanan. Toko: TT-PANGAN. Kata sandi TIDAK diatur di sini (atur lewat Kelola tim).
 * Setelah aplikasi disetujui Shopee: cabut akses akun ini lewat Kelola tim.
 */
function shopeeReviewerSetupFromEditor() {
  const email = 'reviewer@contoh.com', members = teamMembers_();
  if (!members[email]) throw new Error('Akun ' + email + ' belum ada. Tambahkan dulu di Kelola tim (peran Pembaca + kata sandi), lalu jalankan fungsi ini lagi.');
  if (members[email] !== 'viewer') throw new Error('Peran akun ini ' + members[email] + ', bukan Pembaca. Ubah dulu ke Pembaca di Kelola tim.');
  const actor = { email: 'editor', role: 'owner' };
  permSet_(actor, email, ['keuangan', 'produk', 'pesanan'], false);
  teamSetScope_(actor, email, ['TT-PANGAN']);
  const msg = 'Reviewer Shopee diatur HANYA BACA: Pusat Keuangan, Data Produk, Pesanan • toko TT-PANGAN.';
  Logger.log(msg);
  return msg;
}
