/**
 * Kapasitas, backup & arsip otomatis ke Google Drive pemilik.
 *  - Monitor: sel terpakai di spreadsheet utama (batas Google 10 juta sel per file) + kuota Google Drive.
 *  - Backup mingguan: salinan utuh spreadsheet ke folder "Backup E-Commerce" (8 terakhir disimpan; yang lebih lama
 *    dipindah ke Sampah Drive — masih bisa dipulihkan 30 hari).
 *  - Arsip bulanan: memakai archiveOldData_ (salin → cek jumlah → baru hapus). Data > 13 bulan dipindah ke
 *    spreadsheet "Arsip E-Commerce <tahun>". Baris kosong berlebih dipangkas supaya kuota sel tidak habis percuma.
 * Butuh izin Google Drive (DriveApp): pemilik menjalankan capacitySetupFromEditor sekali dari editor Apps Script.
 */
const CAP_LIMIT_ = 10000000;
const CAP_BACKUP_KEEP_ = 8;

function capFmtGb_(b) { return b == null ? null : Math.round(b / 1073741824 * 100) / 100; }

function capacityStatus_() {
  const ss = getDatabase_(), props = PropertiesService.getScriptProperties();
  let folderUrl = '';
  try { if (props.getProperty('CAP_ORGANIZED') !== '1') capOrganize_(); const rf = capFolderById_('CAP_ROOT_FOLDER'); folderUrl = rf ? rf.getUrl() : ''; } catch (e) { /* izin Drive belum ada */ }
  const sheets = ss.getSheets().map(function(sh) {
    const r = sh.getMaxRows(), c = sh.getMaxColumns();
    return { name: sh.getName(), cells: r * c, rows: Math.max(0, sh.getLastRow() - 1), maxRows: r, cols: c };
  }).sort(function(a, b) { return b.cells - a.cells; });
  const used = sheets.reduce(function(a, s) { return a + s.cells; }, 0);
  let drive = null;
  try { drive = { usedGb: capFmtGb_(DriveApp.getStorageUsed()), limitGb: capFmtGb_(DriveApp.getStorageLimit()) };
    drive.pct = drive.limitGb ? Math.round(drive.usedGb / drive.limitGb * 1000) / 10 : null; }
  catch (e) { drive = { error: 'Izin Google Drive belum diberikan — jalankan capacitySetupFromEditor sekali di editor Apps Script.' }; }
  const pct = Math.round(used / CAP_LIMIT_ * 1000) / 10;
  let triggers = null;
  try { triggers = ScriptApp.getProjectTriggers().map(function(t) { return t.getHandlerFunction(); }).filter(function(n) { return /^cap/.test(n); }); } catch (e) { triggers = null; }
  return { folderUrl: folderUrl, cells: used, limit: CAP_LIMIT_, pct: pct, level: pct >= 80 ? 'merah' : pct >= 60 ? 'kuning' : 'aman', sheets: sheets.slice(0, 12), drive: drive,
    lastBackup: props.getProperty('CAP_LAST_BACKUP') || '', lastBackupUrl: props.getProperty('CAP_LAST_BACKUP_URL') || '',
    lastArchive: props.getProperty('CAP_LAST_ARCHIVE') || '', auto: triggers ? { backup: triggers.indexOf('capBackupTick_') >= 0, archive: triggers.indexOf('capArchiveTick_') >= 0 } : null };
}

/** Pangkas baris/kolom kosong di ujung sheet (tidak menyentuh data). Sisakan 200 baris cadangan. */
function capTrim_() {
  let freed = 0;
  getDatabase_().getSheets().forEach(function(sh) {
    try {
      const last = Math.max(1, sh.getLastRow()), maxR = sh.getMaxRows(), keep = last + 200;
      if (maxR > keep + 300) { freed += (maxR - keep) * sh.getMaxColumns(); sh.deleteRows(keep + 1, maxR - keep); }
      const lastC = Math.max(1, sh.getLastColumn()), maxC = sh.getMaxColumns();
      if (maxC > lastC + 2) { freed += (maxC - lastC - 2) * sh.getMaxRows(); sh.deleteColumns(lastC + 3, maxC - lastC - 2); }
    } catch (e) { /* sheet terkunci/terlindungi → lewati */ }
  });
  return freed;
}

/* ---- Folder induk di Google Drive: "E-Commerce Analytics" berisi database, kode aplikasi, Backup/, Arsip/ ---- */
function capFolderById_(key) {
  const id = PropertiesService.getScriptProperties().getProperty(key);
  if (!id) return null;
  try { const f = DriveApp.getFolderById(id); return f.isTrashed() ? null : f; } catch (e) { return null; }
}
function capRootFolder_() {
  let f = capFolderById_('CAP_ROOT_FOLDER');
  if (!f) { f = DriveApp.createFolder('E-Commerce Analytics'); PropertiesService.getScriptProperties().setProperty('CAP_ROOT_FOLDER', f.getId()); }
  return f;
}
function capSubFolder_(key, name) {
  const root = capRootFolder_();
  let f = capFolderById_(key);
  if (f) { try { f.moveTo(root); } catch (e) { /* sudah di dalam / tidak bisa dipindah */ } return f; }
  f = root.createFolder(name); PropertiesService.getScriptProperties().setProperty(key, f.getId());
  return f;
}
function capBackupFolder_() { return capSubFolder_('CAP_BACKUP_FOLDER', 'Backup'); }
function capArchiveFolder_() { return capSubFolder_('CAP_ARCHIVE_FOLDER', 'Arsip'); }
/** Kumpulkan semua file aplikasi ke folder induk. Aman diulang (ID file tidak berubah, aplikasi tetap jalan). */
function capOrganize_() {
  const props = PropertiesService.getScriptProperties(), root = capRootFolder_(), moved = [];
  const move = function(id, folder, label) { if (!id) return; try { DriveApp.getFileById(id).moveTo(folder); moved.push(label); } catch (e) { /* tidak ada akses/terhapus → lewati */ } };
  move(getDatabase_().getId(), root, 'database');
  try { move(ScriptApp.getScriptId(), root, 'kode aplikasi'); } catch (e) { /* abaikan */ }
  capBackupFolder_();
  const arc = capArchiveFolder_();
  props.getKeys().filter(function(k) { return /^ARCHIVE_SS_\d{4}$/.test(k); }).forEach(function(k) { move(props.getProperty(k), arc, 'arsip ' + k.slice(-4)); });
  props.setProperty('CAP_ORGANIZED', '1');
  return { ok: true, url: root.getUrl(), moved: moved, message: 'Semua file dikumpulkan di folder "E-Commerce Analytics" (' + moved.join(', ') + ').' };
}

/** Salinan utuh spreadsheet utama ke folder backup; simpan 8 terakhir. */
function capBackupNow_() {
  try { capOrganize_(); } catch (e) { /* lanjut backup walau gagal merapikan */ }
  const ss = getDatabase_(), folder = capBackupFolder_(), props = PropertiesService.getScriptProperties();
  const stamp = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH.mm');
  const copy = DriveApp.getFileById(ss.getId()).makeCopy('Backup ' + ss.getName() + ' ' + stamp, folder);
  const files = []; const it = folder.getFiles(); while (it.hasNext()) { const f = it.next(); if (/^Backup /.test(f.getName())) files.push(f); }
  files.sort(function(a, b) { return b.getDateCreated() - a.getDateCreated(); });
  let removed = 0; files.slice(CAP_BACKUP_KEEP_).forEach(function(f) { f.setTrashed(true); removed++; });   // ke Sampah (bisa dipulihkan 30 hari)
  props.setProperty('CAP_LAST_BACKUP', stamp); props.setProperty('CAP_LAST_BACKUP_URL', copy.getUrl());
  try { auditChange_('backup', 'Backup', copy.getId(), null, { name: copy.getName(), removedOld: removed }); } catch (e) { /* audit opsional */ }
  return { ok: true, name: copy.getName(), url: copy.getUrl(), removed: removed, message: 'Backup dibuat: ' + copy.getName() + (removed ? ' • ' + removed + ' backup lama dipindah ke Sampah Drive.' : '') };
}

/** Arsip otomatis (data > 13 bulan) + pangkas baris kosong. Aman: archiveOldData_ menyalin & mencocokkan dulu. */
function capArchiveNow_() {
  const props = PropertiesService.getScriptProperties();
  const pv = archiveOldData_({ months: 13, mode: 'preview' });
  let msg = pv.rows ? '' : 'Tidak ada data > 13 bulan. ';
  if (pv.rows) { const r = archiveOldData_({ months: 13, mode: 'apply', expectedRows: pv.rows }); msg = r.message + ' '; }
  const freed = capTrim_();
  msg += freed ? Math.round(freed / 1000) + ' ribu sel kosong dibebaskan.' : 'Tidak ada sel kosong berlebih.';
  props.setProperty('CAP_LAST_ARCHIVE', Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH.mm') + ' — ' + msg.slice(0, 300));
  return { ok: true, message: msg };
}

function capBackupTick_() { try { capBackupNow_(); } catch (e) { PropertiesService.getScriptProperties().setProperty('CAP_LAST_BACKUP', 'GAGAL ' + new Date().toISOString().slice(0, 16) + ': ' + e.message); } }
function capArchiveTick_() { try { capArchiveNow_(); } catch (e) { PropertiesService.getScriptProperties().setProperty('CAP_LAST_ARCHIVE', 'GAGAL ' + new Date().toISOString().slice(0, 16) + ': ' + e.message); } }

/** Pasang/lepas jadwal otomatis: backup tiap Minggu 01.00, arsip tiap tanggal 1 pukul 02.00 (WIB). */
function capacitySetup_(p) {
  p = p || {};
  const on = p.enable !== false;
  ScriptApp.getProjectTriggers().forEach(function(t) { if (['capBackupTick_', 'capArchiveTick_'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  if (on) {
    ScriptApp.newTrigger('capBackupTick_').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(1).inTimezone('Asia/Jakarta').create();
    ScriptApp.newTrigger('capArchiveTick_').timeBased().onMonthDay(1).atHour(2).inTimezone('Asia/Jakarta').create();
  }
  return { ok: true, enabled: on, message: on ? 'Jadwal aktif: backup tiap Minggu 01.00, arsip tiap tanggal 1 pukul 02.00 WIB.' : 'Jadwal backup & arsip otomatis dimatikan.' };
}
/** p: {action:'status'|'backup'|'archive'|'setup', enable} — khusus pemilik. */
function capacityAction_(p) {
  p = p || {};
  if (currentScope_().role !== 'owner' && currentScope_().role !== 'system') throw new Error('Khusus Owner.');
  if (p.action === 'backup') return capBackupNow_();
  if (p.action === 'archive') return capArchiveNow_();
  if (p.action === 'setup') return capacitySetup_(p);
  return capacityStatus_();
}

/** Jalankan SEKALI dari editor Apps Script: memberi izin Google Drive, memasang jadwal, dan membuat backup pertama. */
function capacitySetupFromEditor() {
  const s = capacitySetup_({ enable: true });
  const b = capBackupNow_();
  Logger.log(s.message + '\n' + b.message + '\n' + b.url);
  return s.message + ' ' + b.message;
}
