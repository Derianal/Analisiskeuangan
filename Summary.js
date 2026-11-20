/**
 * RINGKASAN HARIAN PER TOKO (PL_Harian) & ARSIP TAHUNAN
 *
 * Ringkasan: komponen penjualan harian per toko disimpan di PL_Harian, sehingga Pusat Keuangan tidak
 * perlu membaca semua baris pesanan setiap kali dibuka. Setiap perubahan data menandai "kotor mulai tanggal X"
 * (PL_DIRTY_FROM); saat dibaca, hanya rentang X..hari ini yang dihitung ulang.
 *
 * Arsip: baris mentah lebih tua dari N bulan dipindah ke spreadsheet arsip per tahun. Ringkasan untuk
 * tanggal-tanggal itu tetap tersimpan, sehingga laporan lama tetap utuh. Ringkasan tidak pernah dihitung
 * ulang sebelum batas arsip (PL_ARCHIVE_CUTOFF), agar data yang sudah diarsip tidak hilang dari laporan.
 */
const PL_SUM_FIELDS = ['orders', 'gross', 'ret', 'hpp', 'hppMissing', 'fee', 'feePending', 'ship', 'ads', 'ops', 'tax'];
const PL_SUM_HEADERS = ['Key', 'Kode Toko', 'Tanggal', 'Pesanan', 'Omzet', 'Retur', 'HPP', 'Omzet Tanpa HPP', 'Potongan Platform', 'Omzet Belum Settle', 'Ongkir', 'Iklan Transaksi', 'Ops Transaksi', 'Pajak Dipotong Marketplace', 'Dihitung'];
const PL_MAX_REBUILD_DAYS = 400;

function plSumSheet_() {
  const ss = getDatabase_();
  let sh = ss.getSheetByName('PL_Harian');
  if (!sh) sh = ss.insertSheet('PL_Harian');
  if (!sh.getLastRow()) { sh.appendRow(PL_SUM_HEADERS); sh.setFrozenRows(1); }   // sheet ada tapi kosong → tulis judul
  return sh;
}
function plSummaryRows_(start, end) {
  const sh = plSumSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, PL_SUM_HEADERS.length).getValues().filter(function(r) {
    const d = finDate_(r[2]); return d >= start && d <= end;
  });
}
/** Tandai ringkasan perlu dihitung ulang mulai tanggal (YYYY-MM-DD). Kosong = rentang maksimum. */
function plMarkDirty_(date) {
  const p = PropertiesService.getScriptProperties();
  const d = finDate_(date) || '2000-01-01';
  const cur = p.getProperty('PL_DIRTY_FROM');
  if (!cur || d < cur) p.setProperty('PL_DIRTY_FROM', d);
}
/** Hitung ulang ringkasan bila ada tanda kotor. Hasil: {rebuilt, from, to, unassigned}. */
function plEnsureFresh_(force) {
  const p = PropertiesService.getScriptProperties();
  const today = plToday_();
  let from = p.getProperty('PL_DIRTY_FROM');
  const builtOnce = p.getProperty('PL_BUILT') === '1';
  if (!from && builtOnce && !force) return { rebuilt: false, unassigned: Number(p.getProperty('PL_UNASSIGNED')) || 0 };
  const minFrom = finAddDays_(today, -(PL_MAX_REBUILD_DAYS - 1));
  const cutoff = p.getProperty('PL_ARCHIVE_CUTOFF') || '';
  if (!from || from < minFrom || force) from = minFrom;
  if (cutoff && from < cutoff) from = cutoff; // jangan menimpa ringkasan untuk data yang sudah diarsip
  return withScriptLock_(function() {
    const r = plRebuildRange_(from, today);
    p.setProperty('PL_BUILT', '1'); p.deleteProperty ? p.deleteProperty('PL_DIRTY_FROM') : p.setProperty('PL_DIRTY_FROM', '');
    p.setProperty('PL_UNASSIGNED', String(r.unassigned));
    return { rebuilt: true, from: from, to: today, rows: r.rows, unassigned: r.unassigned };
  });
}
/** Hitung ulang ringkasan untuk rentang [from, to] saja; baris di luar rentang dipertahankan. */
function plRebuildRange_(from, to) {
  const n = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
  const dates = plDates_(to, n);
  const res = plComputeSales_(dates);
  const sh = plSumSheet_(), W = PL_SUM_HEADERS.length;
  const keep = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, W).getValues().filter(function(r) { const d = finDate_(r[2]); return d < from || d > to; }) : [];
  const now = new Date(), fresh = [];
  Object.keys(res.daily).forEach(function(code) {
    res.daily[code].forEach(function(d, i) {
      if (!PL_SUM_FIELDS.some(function(f) { return d[f]; })) return; // hari tanpa aktivitas tidak perlu baris
      fresh.push([code + '|' + dates[i], code, dates[i]].concat(PL_SUM_FIELDS.map(function(f) { return Math.round(d[f] * 100) / 100; })).concat([now]));
    });
  });
  const all = keep.concat(fresh);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, W).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, W).setValues(all);
  return { rows: fresh.length, unassigned: res.unassigned };
}
/** Owner/Keuangan: hitung ulang ringkasan secara penuh (mis. setelah perubahan besar). */
function plRebuildSummary_() {
  assertAllStoresScope_('Hitung ulang ringkasan');
  const r = plEnsureFresh_(true);
  return { ok: true, message: 'Ringkasan dihitung ulang ' + r.from + ' s/d ' + r.to + ' (' + r.rows + ' baris toko-hari).' };
}

/* ---------------- Arsip tahunan ---------------- */
const ARCHIVE_TABLES = [
  { sheet: 'TTS_Orders', width: 23, dateCol: 4 }, { sheet: 'TTS_OrderLines', width: 20, dateCol: 5 },
  { sheet: 'TTS_Finance', width: 18, dateCol: 7 }, { sheet: 'TTS_Returns', width: 15, dateCol: 5 },
  { sheet: 'Transactions', width: 18, dateCol: 2 },
  { sheet: 'SP_Orders', width: 14, dateCol: 4 }, { sheet: 'SP_OrderLines', width: 18, dateCol: 5 },
  // log (tidak dipakai laporan) — ikut diarsip supaya tidak menumpuk
  { sheet: 'TeamAudit', width: 9, dateCol: 0 }, { sheet: 'Notif_Log', width: 6, dateCol: 4 }, { sheet: 'Fulfill_Log', width: 8, dateCol: 0 },
  { sheet: 'Produk_Log', width: 9, dateCol: 0 }, { sheet: 'SKU_Edit_Log', width: 9, dateCol: 0 }
];
function archiveCutoffFor_(months) {
  const m = Math.max(13, Math.min(60, Number(months) || 13));
  return finAddDays_(plToday_(), -Math.round(m * 30.44));
}
/**
 * Owner: pratinjau atau jalankan arsip. p = {months (≥13), mode:'preview'|'apply', expectedRows}
 * Urutan aman: ringkasan diperbarui dulu → salin ke spreadsheet arsip per tahun → cek jumlah salinan →
 * baru hapus dari sheet utama → catat batas arsip & audit.
 */
function archiveOldData_(p) {
  p = p || {};
  if (currentScope_().role !== 'owner' && currentScope_().role !== 'system') throw new Error('Arsip data hanya untuk Owner.');
  const cutoff = archiveCutoffFor_(p.months);
  const plan = ARCHIVE_TABLES.map(function(t) {
    const sh = getDatabase_().getSheetByName(t.sheet);
    const rows = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, t.width).getValues() : [];
    const old = [];
    rows.forEach(function(r, i) { const d = finDate_(String(r[t.dateCol] instanceof Date ? Utilities.formatDate(r[t.dateCol], 'Asia/Jakarta', 'yyyy-MM-dd') : r[t.dateCol]).slice(0, 10)); if (d && d < cutoff) old.push(i); });
    return { t: t, sh: sh, rows: rows, old: old };
  });
  const total = plan.reduce(function(a, x) { return a + x.old.length; }, 0);
  const summary = plan.map(function(x) { return { sheet: x.t.sheet, rows: x.old.length, total: x.rows.length }; });
  if (p.mode !== 'apply') return { cutoff: cutoff, rows: total, tables: summary, message: total + ' baris lebih tua dari ' + cutoff + ' siap diarsip.' };
  if (Number(p.expectedRows) !== total) throw new Error('Jumlah baris berubah sejak pratinjau. Ulangi pratinjau.');
  if (!total) return { ok: true, rows: 0, message: 'Tidak ada data yang perlu diarsip.' };
  plEnsureFresh_();
  return withScriptLock_(function() {
    // Ringkasan untuk SEMUA tanggal yang akan diarsip dihitung dulu dari data mentah (bisa lebih tua dari 400 hari),
    // supaya laporan lama tetap utuh setelah data mentahnya dipindah.
    let minDate = '';
    plan.forEach(function(x) { x.old.forEach(function(i) { const v = x.rows[i][x.t.dateCol]; const d = finDate_(String(v instanceof Date ? Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd') : v).slice(0, 10)); if (d && (!minDate || d < minDate)) minDate = d; }); });
    const prevCutoff = PropertiesService.getScriptProperties().getProperty('PL_ARCHIVE_CUTOFF') || '';
    if (minDate && (!prevCutoff || minDate >= prevCutoff)) plRebuildRange_(minDate, finAddDays_(cutoff, -1));
    const props = PropertiesService.getScriptProperties(), byYear = {};
    plan.forEach(function(x) { x.old.forEach(function(i) { const y = finDate_(String(x.rows[i][x.t.dateCol] instanceof Date ? Utilities.formatDate(x.rows[i][x.t.dateCol], 'Asia/Jakarta', 'yyyy-MM-dd') : x.rows[i][x.t.dateCol]).slice(0, 10)).slice(0, 4); ((byYear[y] = byYear[y] || {})[x.t.sheet] = byYear[y][x.t.sheet] || []).push(x.rows[i]); }); });
    const files = [];
    Object.keys(byYear).forEach(function(y) {
      let id = props.getProperty('ARCHIVE_SS_' + y), ss = null;
      if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
      if (!ss) { ss = SpreadsheetApp.create('Arsip E-Commerce ' + y); props.setProperty('ARCHIVE_SS_' + y, ss.getId());
        try { if (typeof capArchiveFolder_ === 'function') DriveApp.getFileById(ss.getId()).moveTo(capArchiveFolder_()); } catch (e) { /* tetap di Drive utama bila gagal dipindah */ } }
      Object.keys(byYear[y]).forEach(function(name) {
        const rows = byYear[y][name], t = ARCHIVE_TABLES.find(function(z) { return z.sheet === name; });
        let sh = ss.getSheetByName(name);
        if (!sh) { sh = ss.insertSheet(name); const src = getDatabase_().getSheetByName(name); sh.getRange(1, 1, 1, t.width).setValues(src.getRange(1, 1, 1, t.width).getValues()); }
        const before = Math.max(0, sh.getLastRow() - 1);
        ensureRoom_(sh, rows.length, t.width).getRange(sh.getLastRow() + 1, 1, rows.length, t.width).setValues(rows);
        if (sh.getLastRow() - 1 - before !== rows.length) throw new Error('Salinan arsip ' + name + ' ' + y + ' tidak lengkap. Tidak ada data yang dihapus.');
      });
      files.push({ year: y, url: ss.getUrl() });
    });
    // Semua salinan terverifikasi → hapus dari sheet utama (tulis ulang baris yang dipertahankan).
    plan.forEach(function(x) {
      if (!x.old.length) return;
      const oldSet = {}; x.old.forEach(function(i) { oldSet[i] = true; });
      const keep = x.rows.filter(function(r, i) { return !oldSet[i]; });
      x.sh.getRange(2, 1, x.rows.length, x.t.width).clearContent();
      if (keep.length) x.sh.getRange(2, 1, keep.length, x.t.width).setValues(keep);
      // baris yang sudah kosong dibuang supaya kuota sel (10 juta) benar-benar berkurang
      try { const spare = x.sh.getMaxRows() - (keep.length + 1) - 200; if (spare > 0) x.sh.deleteRows(keep.length + 202, spare); } catch (e) { /* abaikan */ }
    });
    const prevCut = props.getProperty('PL_ARCHIVE_CUTOFF') || '';
    if (!prevCut || cutoff > prevCut) props.setProperty('PL_ARCHIVE_CUTOFF', cutoff);
    auditChange_('archive', 'Arsip', cutoff, { rows: total }, { files: files, tables: summary });
    return { ok: true, rows: total, files: files, cutoff: cutoff, message: total + ' baris sebelum ' + cutoff + ' dipindah ke arsip. Laporan lama tetap utuh dari ringkasan harian.' };
  });
}
