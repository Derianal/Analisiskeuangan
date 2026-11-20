/**
 * PERANGKAT KASIRKU (banyak outlet, banyak KasirKu)
 *
 * - KasirKu tetap aplikasi terpisah; sistem ini hanya menerima data transaksinya.
 * - Setiap salinan KasirKu mendapat TOKEN SENDIRI yang terikat ke satu outlet (Kode Toko).
 *   Data dari token itu hanya bisa masuk ke outlet tersebut.
 * - Token hanya ditampilkan SEKALI saat dibuat; yang disimpan hanya hash SHA-256-nya.
 * - Token lama (KASIRKU_BRIDGE_TOKEN + KASIRKU_STORE_CODE) tetap diterima selama masa peralihan.
 */
const KSK_HEADERS = ['ID', 'Label', 'Kode Toko', 'Token Hash', 'Status', 'Dibuat', 'Dibuat Oleh', 'Data Terakhir', 'Jumlah Event'];
function kskSheet_() {
  const ss = getDatabase_();
  let sh = ss.getSheetByName('KasirKu_Perangkat');
  if (!sh) sh = ss.insertSheet('KasirKu_Perangkat');
  if (!sh.getLastRow()) { sh.appendRow(KSK_HEADERS); sh.setFrozenRows(1); }   // sheet ada tapi kosong → tulis judul
  return sh;
}
function kskRows_() { const sh = kskSheet_(); return sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, KSK_HEADERS.length).getValues() : []; }
function kskHash_(token) { return teamHash_('kasirku:' + String(token)); }
/** Cari perangkat dari token. Hasil: {storeCode, deviceId, label, row} atau null. */
function kskResolveToken_(token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(t)) return null;
  const legacy = PropertiesService.getScriptProperties().getProperty(KASIRKU_BRIDGE_TOKEN_PROPERTY);
  if (legacy && t === legacy) return { storeCode: String(PropertiesService.getScriptProperties().getProperty('KASIRKU_STORE_CODE') || ''), deviceId: 'LAMA', label: 'Token lama', row: 0 };
  const h = kskHash_(t), rows = kskRows_();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][3]) === h) return String(rows[i][4]) === 'AKTIF' ? { storeCode: String(rows[i][2]), deviceId: String(rows[i][0]), label: String(rows[i][1]), row: i + 2 } : { revoked: true };
  }
  return null;
}
function kskTouch_(dev) {
  if (!dev || !dev.row) return;
  const sh = kskSheet_(), n = Number(sh.getRange(dev.row, 9).getValue()) || 0;
  sh.getRange(dev.row, 8, 1, 2).setValues([[new Date(), n + 1]]);
}
function kasirkuDevices_() {
  assertAllStoresScope_('Perangkat KasirKu');
  const p = PropertiesService.getScriptProperties();
  const list = kskRows_().map(function(r) {
    return { id: String(r[0]), label: String(r[1]), storeCode: String(r[2]), status: String(r[4]), createdAt: stockStamp_(r[5]), createdBy: String(r[6] || ''), lastSeen: stockStamp_(r[7]), events: Number(r[8]) || 0 };
  });
  return { devices: list, legacy: { active: !!p.getProperty(KASIRKU_BRIDGE_TOKEN_PROPERTY), storeCode: p.getProperty('KASIRKU_STORE_CODE') || '' },
    outlets: finStoresFromRows_(finRows_('FinStores')).filter(function(s) { return s.active; }).map(function(s) { return { code: s.code, name: s.name, platform: s.platform }; }) };
}
/** Owner: buat token baru untuk satu salinan KasirKu. Token dikembalikan SEKALI saja. */
function kasirkuAddDevice_(p) {
  p = p || {};
  assertAllStoresScope_('Menambah perangkat KasirKu');
  const store = requireStoreCode_(p.storeCode);
  const label = String(p.label || '').trim().slice(0, 60);
  if (!label) throw new Error('Beri nama perangkat, mis. "Kasir depan Jatiwarna".');
  const token = teamRandom_();
  const id = 'KSK-' + store.code + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
  withScriptLock_(function() { kskSheet_().appendRow([id, label, store.code, kskHash_(token), 'AKTIF', new Date(), currentActorEmail_(), '', 0]); });
  auditChange_('kasirku-device-add', 'KasirKu_Perangkat', id, null, { label: label, store: store.code });
  return { id: id, storeCode: store.code, token: token,
    message: 'Perangkat ' + id + ' dibuat untuk ' + store.code + '. Salin token sekarang; token tidak bisa ditampilkan lagi.',
    setup: 'Di editor Apps Script KasirKu outlet ini, jalankan sekali: setEcommerceAnalyticsConfig("URL_/exec_APLIKASI_KEUANGAN", "TOKEN") lalu setupKasirKuAnalyticsBridge().' };
}
function kasirkuRevokeDevice_(p) {
  p = p || {};
  assertAllStoresScope_('Mencabut perangkat KasirKu');
  const rows = kskRows_(), i = rows.findIndex(function(r) { return String(r[0]) === String(p.id); });
  if (i < 0) throw new Error('Perangkat tidak ditemukan.');
  withScriptLock_(function() { kskSheet_().getRange(i + 2, 5).setValue('DICABUT'); });
  auditChange_('kasirku-device-revoke', 'KasirKu_Perangkat', String(p.id), { status: String(rows[i][4]) }, { status: 'DICABUT' });
  return { ok: true, message: 'Token perangkat ' + p.id + ' dicabut. Data dari perangkat itu akan ditolak.' };
}
