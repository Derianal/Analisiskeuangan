/**
 * TAHAP 2 — AKSES PER TOKO & PEMETAAN DATA LAMA
 *
 * Peran:
 *  owner   : seluruh kantor + pengaturan.
 *  finance : (Keuangan) seluruh toko, biaya/laporan; tidak mengelola tim.
 *  admin   : (Admin toko) hanya toko yang ditugaskan; impor & biaya tingkat toko.
 *  member  : (Staf) toko yang ditugaskan; checklist, aktivitas, AI. Tidak impor.
 *  viewer  : (Pembaca) hanya melihat toko yang ditugaskan.
 *
 * Batas toko disimpan di Script Properties TEAM_STORE_SCOPE_JSON: {"email":["S1","TT1"]}.
 * Default untuk admin/member/viewer: TIDAK ada toko (tolak sampai pemilik menugaskan).
 * Penegakan dilakukan di fungsi baca/tulis data (server), bukan hanya menyembunyikan menu.
 */
const TEAM_ROLES_ = ['owner', 'finance', 'admin', 'member', 'viewer'];
const TEAM_ROLE_LABELS_ = { owner: 'Owner', finance: 'Keuangan', admin: 'Admin toko', member: 'Staf', viewer: 'Pembaca' };
const TEAM_ALL_STORE_ROLES_ = ['owner', 'finance'];

function teamStoreScopes_() {
  try {
    const raw = JSON.parse(PropertiesService.getScriptProperties().getProperty('TEAM_STORE_SCOPE_JSON') || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (e) { return {}; }
}
/** Cakupan toko untuk pengguna aktif. Tanpa konteks tim (mis. dijalankan pemilik dari editor) = semua. */
function currentScope_() {
  const user = (typeof TEAM_REQUEST_CONTEXT_ !== 'undefined' && TEAM_REQUEST_CONTEXT_) ? TEAM_REQUEST_CONTEXT_ : null;
  if (!user) return { all: true, stores: [], role: 'system' };
  if (TEAM_ALL_STORE_ROLES_.indexOf(user.role) >= 0) return { all: true, stores: [], role: user.role, email: user.email };
  const list = teamStoreScopes_()[user.email];
  const stores = Array.isArray(list) ? list.map(function(s) { return String(s).trim().toUpperCase(); }).filter(Boolean) : [];
  return { all: false, stores: stores, role: user.role, email: user.email };
}
/** 'UNASSIGNED' (data lama tanpa toko) hanya untuk owner/keuangan. */
function scopeAllows_(code) {
  const sc = currentScope_();
  const c = String(code || '').trim().toUpperCase();
  if (sc.all) return true;
  if (!c || c === 'UNASSIGNED') return false;
  return sc.stores.indexOf(c) >= 0;
}
function assertStoreAllowed_(code) {
  if (!scopeAllows_(code)) {
    const c = String(code || '').trim().toUpperCase();
    throw new Error(c === 'UNASSIGNED' || !c
      ? 'Data lama tanpa toko hanya bisa dibuka Owner atau Keuangan.'
      : 'Akunmu tidak ditugaskan ke toko ' + c + '. Minta pemilik menambahkan toko ini di Kelola tim.');
  }
}
/** Daftar kode toko yang boleh dibaca, atau null bila semua. */
function allowedStoreList_() {
  const sc = currentScope_();
  return sc.all ? null : sc.stores.slice();
}
/** Biaya tingkat cabang/pusat dan pengaturan kantor hanya untuk cakupan semua toko. */
function assertAllStoresScope_(what) {
  if (!currentScope_().all) throw new Error((what || 'Tindakan ini') + ' hanya untuk Owner atau Keuangan.');
}

/* ---------------- Tim: peran & toko ---------------- */
function teamScopeList_() {
  const scopes = teamStoreScopes_(), members = teamMembers_();
  return Object.keys(members).map(function(email) {
    const role = members[email];
    return { email: email, role: role, roleLabel: TEAM_ROLE_LABELS_[role] || role, perms: permOf_(email, role), customPerms: permCustom_(email),
      allStores: TEAM_ALL_STORE_ROLES_.indexOf(role) >= 0,
      stores: Array.isArray(scopes[email]) ? scopes[email] : [] };
  });
}
function teamSetScope_(actor, email, stores) {
  const members = teamMembers_();
  if (!members[email]) throw new Error('Anggota belum aktif.');
  if (TEAM_ALL_STORE_ROLES_.indexOf(members[email]) >= 0) throw new Error('Owner dan Keuangan otomatis melihat semua toko.');
  const known = finStoresFromRows_(finRows_('FinStores')).map(function(s) { return s.code; });
  const clean = (Array.isArray(stores) ? stores : []).map(function(s) { return String(s).trim().toUpperCase(); })
    .filter(function(s, i, a) { return s && a.indexOf(s) === i; });
  clean.forEach(function(s) { if (known.indexOf(s) < 0) throw new Error('Toko ' + s + ' tidak ada di Master Toko.'); });
  const scopes = teamStoreScopes_();
  const before = scopes[email] || [];
  scopes[email] = clean;
  PropertiesService.getScriptProperties().setProperty('TEAM_STORE_SCOPE_JSON', JSON.stringify(scopes));
  teamAudit_(actor, 'team-scope', 'CHANGED', { entity: 'TeamScope', id: email, before: before, after: clean });
  return { ok: true };
}

/* ---------------- Pemetaan data lama ke toko ---------------- */
const MIGRATION_HEADERS_ = ['Migration ID', 'Time WIB', 'Actor', 'Source', 'Store Code', 'Rows', 'Status', 'Part', 'Parts', 'Keys JSON', 'Note'];
function migrationSource_(source) {
  const map = {
    transactions: { sheet: 'Transactions', storeCol: 17, width: 18,
      key: function(r) { return String(r[0]); }, date: function(r) { return normalizeImportDate_(r[2]); },
      label: function(r) { return String(r[3] || '(tanpa sumber)'); }, value: function(r) { return numOrNull_(r[5]); } },
    shop: { sheet: 'ShopAnalytics', storeCol: 17, width: 18,
      key: function(r) { return String(r[0]) + '|' + normalizeImportDate_(r[3]); }, date: function(r) { return normalizeImportDate_(r[3]); },
      label: function(r) { return String(r[2] || '(tanpa file)'); }, value: function(r) { return numOrNull_(r[4]); } },
    gmvmax: { sheet: 'GMVMax', storeCol: 11, width: 12,
      key: function(r) { return String(r[0]) + '|' + normalizeImportDate_(r[3]) + '|' + String(r[6] || ''); }, date: function(r) { return normalizeImportDate_(r[3]); },
      label: function(r) { return String(r[2] || '(tanpa file)'); }, value: function(r) { return numOrNull_(r[4]); } }
  };
  const m = map[source];
  if (!m) throw new Error('Sumber pemetaan tidak dikenal.');
  return m;
}
function migrationSheet_() {
  const ss = getDatabase_();
  let sh = ss.getSheetByName('Migrations');
  if (!sh) sh = ss.insertSheet('Migrations');
  if (!sh.getLastRow()) { sh.appendRow(MIGRATION_HEADERS_); sh.setFrozenRows(1); }   // sheet ada tapi kosong → tulis judul
  return sh;
}
function ensureStoreColumn_(sheetName, headers) {
  const sh = getDatabase_().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet ' + sheetName + ' tidak ditemukan.');
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  else if (sh.getLastColumn() < headers.length) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sh;
}
/**
 * p = {source, storeCode, mode:'preview'|'apply'|'undo', label?, expectedRows?, migrationId?}
 * preview : hitung baris tanpa toko (bisa disaring per sumber/aplikasi/file = label).
 * apply   : wajib expectedRows sama dengan hasil preview (mencegah salah data); tercatat dan bisa dibatalkan.
 * undo    : kembalikan baris migrasi itu menjadi tanpa toko (hanya baris yang masih bertoko sama).
 */
function migrateLegacy_(p) {
  p = p || {};
  assertAllStoresScope_('Pemetaan data lama');
  const src = migrationSource_(p.source);
  const headers = p.source === 'transactions' ? SHEET_HEADERS.Transactions : SHEET_HEADERS[src.sheet];
  return withScriptLock_(function() {
    const sh = ensureStoreColumn_(src.sheet, headers);
    const last = sh.getLastRow();
    const rows = last > 1 ? sh.getRange(2, 1, last - 1, src.width).getValues() : [];
    if (p.mode === 'undo') return migrationUndo_(p, src, sh, rows);
    const wantLabel = String(p.label || '');
    const idx = [], byLabel = {};
    let first = '', lastDate = '', total = null;
    rows.forEach(function(r, i) {
      if (String(r[src.storeCol] || '').trim()) return;
      const lab = src.label(r);
      byLabel[lab] = (byLabel[lab] || 0) + 1;
      if (wantLabel && lab !== wantLabel) return;
      idx.push(i);
      const d = src.date(r);
      if (d && (!first || d < first)) first = d;
      if (d && (!lastDate || d > lastDate)) lastDate = d;
      const v = src.value(r);
      if (v !== null) total = (total || 0) + v;
    });
    const preview = { source: p.source, label: wantLabel, rows: idx.length, firstDate: first, lastDate: lastDate, valueTotal: total,
      groups: Object.keys(byLabel).map(function(k) { return { label: k, rows: byLabel[k] }; }) };
    if (p.mode !== 'apply') return preview;

    const store = requireStoreCode_(p.storeCode);
    if (!idx.length) throw new Error('Tidak ada baris tanpa toko yang cocok.');
    if (Number(p.expectedRows) !== idx.length) throw new Error('Jumlah baris berubah sejak pratinjau (' + p.expectedRows + ' → ' + idx.length + '). Ulangi pratinjau.');
    const keys = [];
    idx.forEach(function(i) { rows[i][src.storeCol] = store.code; keys.push(src.key(rows[i])); });
    // Simpan catatan migrasi DULU (agar bisa dibatalkan), baru ubah data.
    const id = Utilities.getUuid(), json = JSON.stringify(keys), parts = [];
    for (let i = 0; i < json.length; i += 40000) parts.push(json.slice(i, i + 40000));
    const actor = currentActorEmail_(), stamp = Utilities.formatDate(new Date(), 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
    const log = migrationSheet_();
    ensureRoom_(log, parts.length, MIGRATION_HEADERS_.length).getRange(log.getLastRow() + 1, 1, parts.length, MIGRATION_HEADERS_.length).setValues(parts.map(function(part, n) {
      return [id, stamp, actor, p.source, store.code, keys.length, 'APPLIED', n + 1, parts.length, part, wantLabel ? 'Filter: ' + wantLabel : 'Semua baris tanpa toko'];
    }));
    sh.getRange(2, 1, rows.length, src.width).setValues(rows);
    if (p.source === 'transactions') plMarkDirty_('');
    teamAudit_(TEAM_REQUEST_CONTEXT_ || { email: actor || '(sistem)', role: 'system' }, 'migrate-apply', 'CHANGED',
      { entity: src.sheet, id: id, before: { store: '', rows: keys.length }, after: { store: store.code, rows: keys.length, label: wantLabel } });
    return { migrationId: id, rows: keys.length, storeCode: store.code,
      message: keys.length + ' baris ' + p.source + ' dipetakan ke toko ' + store.code + '. ID migrasi ' + id.slice(0, 8) + ' (bisa dibatalkan).' };
  });
}
function migrationUndo_(p, src, sh, rows) {
  const id = String(p.migrationId || '');
  const log = migrationSheet_();
  const all = log.getLastRow() > 1 ? log.getRange(2, 1, log.getLastRow() - 1, MIGRATION_HEADERS_.length).getValues() : [];
  const parts = all.map(function(r, i) { return { r: r, row: i + 2 }; }).filter(function(x) { return String(x.r[0]) === id; })
    .sort(function(a, b) { return Number(a.r[7]) - Number(b.r[7]); });
  if (!parts.length) throw new Error('ID migrasi tidak ditemukan.');
  if (String(parts[0].r[3]) !== p.source) throw new Error('Sumber migrasi tidak cocok.');
  if (parts.some(function(x) { return String(x.r[6]) !== 'APPLIED'; })) throw new Error('Migrasi ini sudah dibatalkan.');
  if (parts.length !== Number(parts[0].r[8])) throw new Error('Catatan migrasi tidak lengkap. Tidak diubah.');
  const store = String(parts[0].r[4]);
  const keys = {};
  JSON.parse(parts.map(function(x) { return String(x.r[9]); }).join('')).forEach(function(k) { keys[k] = true; });
  let reverted = 0, changedSince = 0;
  rows.forEach(function(r) {
    if (!keys[src.key(r)]) return;
    if (String(r[src.storeCol]) === store) { r[src.storeCol] = ''; reverted++; } else changedSince++;
  });
  if (reverted) { sh.getRange(2, 1, rows.length, src.width).setValues(rows); if (p.source === 'transactions') plMarkDirty_(''); }
  parts.forEach(function(x) { log.getRange(x.row, 7).setValue('UNDONE'); });
  teamAudit_(TEAM_REQUEST_CONTEXT_ || { email: '(sistem)', role: 'system' }, 'migrate-undo', 'CHANGED',
    { entity: src.sheet, id: id, before: { store: store }, after: { store: '', rows: reverted } });
  return { migrationId: id, reverted: reverted, changedSince: changedSince,
    message: reverted + ' baris dikembalikan menjadi tanpa toko.' + (changedSince ? ' ' + changedSince + ' baris sudah berubah toko sejak migrasi dan tidak disentuh.' : '') };
}
function listMigrations_() {
  assertAllStoresScope_('Riwayat pemetaan');
  const log = migrationSheet_();
  const rows = log.getLastRow() > 1 ? log.getRange(2, 1, log.getLastRow() - 1, MIGRATION_HEADERS_.length).getValues() : [];
  return rows.filter(function(r) { return Number(r[7]) === 1; }).map(function(r) {
    return { id: String(r[0]), time: String(r[1]), actor: String(r[2]), source: String(r[3]), storeCode: String(r[4]), rows: Number(r[5]), status: String(r[6]), note: String(r[10]) };
  }).reverse();
}

/* ---------------- Toko untuk transaksi KasirKu baru ---------------- */
function getKasirKuStore_() {
  return { storeCode: PropertiesService.getScriptProperties().getProperty('KASIRKU_STORE_CODE') || '' };
}
function setKasirKuStore_(code) {
  assertAllStoresScope_('Pengaturan toko KasirKu');
  const c = String(code || '').trim().toUpperCase();
  const before = getKasirKuStore_().storeCode;
  if (c) requireStoreCode_(c);
  PropertiesService.getScriptProperties().setProperty('KASIRKU_STORE_CODE', c);
  auditChange_('kasirku-store', 'Settings', 'KASIRKU_STORE_CODE', before, c);
  return { storeCode: c, message: c ? 'Transaksi KasirKu BARU akan dicatat ke toko ' + c + '. Data lama tidak berubah (pakai Pemetaan data lama).' : 'Transaksi KasirKu baru akan masuk sebagai data tanpa toko.' };
}
