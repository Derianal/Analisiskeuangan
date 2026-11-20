/**
 * Notifikasi pesanan baru ke Telegram.
 * - Token bot hanya di Script Properties (TELEGRAM_BOT_TOKEN); tidak pernah dikirim balik ke halaman atau ditulis ke log.
 * - Pemicu tiap 10 menit (notifyTick_): tarik pesanan TikTok 2 jam terakhir (pakai ttsPullOrders_, data ikut segar),
 *   kirim pesanan yang SUDAH DIBAYAR & siap dikirim yang belum pernah dinotifikasi (dicatat di sheet Notif_Log).
 * - Tidak mengubah apa pun di TikTok/Shopee.
 */
const NOTIFY_STATUSES = ['AWAITING_SHIPMENT', 'AWAITING_COLLECTION'];   // sudah dibayar, perlu diproses
const NOTIFY_LOG_HEADERS = ['key', 'store_code', 'order_id', 'status', 'sent_at', 'result'];

function tgToken_() { return PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || ''; }
function tgCall_(method, payload) {
  const token = tgToken_();
  if (!token) throw new Error('Token bot Telegram belum diisi.');
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true });
  let body = {}; try { body = JSON.parse(res.getContentText()); } catch (e) {}
  if (res.getResponseCode() !== 200 || !body.ok) {
    const d = String(body.description || ('HTTP ' + res.getResponseCode())).replace(token, '***');   // jangan bocorkan token
    throw new Error('Telegram menolak: ' + d + (/Unauthorized/i.test(d) ? ' — token bot salah.' : /chat not found/i.test(d) ? ' — bot belum diajak chat / belum masuk grup.' : ''));
  }
  return body.result;
}
function tgEsc_(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

/* ---------------- WhatsApp lewat Fonnte (sama seperti KasirKu) ---------------- */
function waToken_() { return (PropertiesService.getScriptProperties().getProperty('FONNTE_TOKEN') || '').trim(); }
/** 08xx / +62xx / 62xx → 62xx; ID grup WA (…@g.us) dibiarkan. Beberapa tujuan dipisah koma. */
function waTargets_(raw) {
  return String(raw || '').split(/[,;\n]+/).map(function(t) {
    t = t.trim(); if (!t) return '';
    if (/@g\.us$/.test(t)) return t;
    t = t.replace(/[^0-9]/g, ''); if (t.indexOf('0') === 0) t = '62' + t.slice(1);
    return /^62\d{8,13}$/.test(t) ? t : 'X';
  }).filter(String);
}
function waSend_(target, text) {
  const token = waToken_();
  if (!token) throw new Error('Token Fonnte belum diisi.');
  const res = UrlFetchApp.fetch('https://api.fonnte.com/send', { method: 'post', headers: { Authorization: token },
    payload: { target: target, countryCode: '0', message: text }, muteHttpExceptions: true });
  let body = {}; try { body = JSON.parse(res.getContentText()); } catch (e) {}
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300 || body.status !== true) {
    const d = String(body.reason || body.detail || ('HTTP ' + res.getResponseCode())).replace(token, '***');
    throw new Error('Fonnte menolak: ' + d + (/token/i.test(d) ? ' — periksa token device di fonnte.com.' : /disconnect|not connect/i.test(d) ? ' — WhatsApp di Fonnte terputus, sambungkan ulang (scan QR) di fonnte.com.' : ''));
  }
  return body;
}
/** Kirim ke saluran yang aktif: WhatsApp bila diatur, kalau tidak Telegram. */
function notifySend_(waText, tgHtml) {
  const p = PropertiesService.getScriptProperties();
  if (waToken_() && p.getProperty('WA_TARGET')) return waSend_(p.getProperty('WA_TARGET'), waText);
  if (tgToken_() && p.getProperty('TELEGRAM_CHAT_ID')) return tgCall_('sendMessage', { chat_id: p.getProperty('TELEGRAM_CHAT_ID'), parse_mode: 'HTML', text: tgHtml, disable_web_page_preview: true });
  throw new Error('Saluran notifikasi belum diatur.');
}
function notifyReady_() { const p = PropertiesService.getScriptProperties(); return !!((waToken_() && p.getProperty('WA_TARGET')) || (tgToken_() && p.getProperty('TELEGRAM_CHAT_ID'))); }
function notifySetWa_(p) {
  assertAllStoresScope_('Notifikasi WhatsApp');
  p = p || {};
  const props = PropertiesService.getScriptProperties(), token = String(p.token || '').trim();
  const targets = waTargets_(p.target);
  if (!targets.length) throw new Error('Isi nomor WA tujuan, mis. 0812xxxx (boleh beberapa, pisahkan koma).');
  if (targets.indexOf('X') >= 0) throw new Error('Ada nomor yang formatnya salah. Contoh benar: 081234567890 atau 6281234567890.');
  const oldToken = props.getProperty('FONNTE_TOKEN');
  if (token) { if (token.length < 10 || /\s/.test(token)) throw new Error('Token Fonnte tidak valid.'); props.setProperty('FONNTE_TOKEN', token); }
  if (!waToken_()) throw new Error('Tempel token Fonnte dulu.');
  try { waSend_(targets.join(','), '✅ Notifikasi pesanan PKS Keuangan tersambung ke nomor ini.'); }
  catch (e) { if (token) { if (oldToken) props.setProperty('FONNTE_TOKEN', oldToken); else props.deleteProperty('FONNTE_TOKEN'); } throw e; }
  props.setProperty('WA_TARGET', targets.join(','));
  auditChange_('notify-wa', 'ScriptProperties', 'WA_TARGET', null, { targets: targets.length });
  return { ok: true, message: 'Tersambung. Pesan percobaan dikirim ke ' + targets.length + ' tujuan — cek WhatsApp.' };
}

/* ---------------- Pengaturan (Owner) ---------------- */
function notifyConfig_() {
  assertAllStoresScope_('Notifikasi Telegram');
  const p = PropertiesService.getScriptProperties();
  let trigger = false, triggerErr = '';
  try { trigger = ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'notifyTick_'; }); } catch (e) { triggerErr = 'Izin pemicu (trigger) belum diberikan.'; }
  return { waTokenSet: !!p.getProperty('FONNTE_TOKEN'), waTarget: p.getProperty('WA_TARGET') || '', tokenSet: !!p.getProperty('TELEGRAM_BOT_TOKEN'), chatId: p.getProperty('TELEGRAM_CHAT_ID') || '', chatTitle: p.getProperty('TELEGRAM_CHAT_TITLE') || '',
    enabled: trigger, triggerErr: triggerErr, lastRun: p.getProperty('NOTIFY_LAST_RUN') || '', lastResult: p.getProperty('NOTIFY_LAST_RESULT') || '' };
}
function notifySetToken_(p) {
  assertAllStoresScope_('Notifikasi Telegram');
  const token = String((p && p.token) || '').trim();
  if (!/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(token)) throw new Error('Format token tidak sesuai. Salin token lengkap dari @BotFather (angka:huruf…).');
  PropertiesService.getScriptProperties().setProperty('TELEGRAM_BOT_TOKEN', token);
  let me; try { me = tgCall_('getMe', {}); } catch (e) { PropertiesService.getScriptProperties().deleteProperty('TELEGRAM_BOT_TOKEN'); throw e; }
  auditChange_('notify-token', 'ScriptProperties', 'TELEGRAM_BOT_TOKEN', null, { bot: me.username });
  return { ok: true, bot: me.username, message: 'Bot @' + me.username + ' tersambung. Sekarang kirim pesan /start ke bot itu (atau masukkan bot ke grup tim lalu kirim pesan di grup), lalu klik "Cari chat".' };
}
function notifyFindChats_() {
  assertAllStoresScope_('Notifikasi Telegram');
  const seen = {}, out = [];
  (tgCall_('getUpdates', { limit: 100, allowed_updates: ['message', 'my_chat_member'] }) || []).forEach(function(u) {
    const m = u.message || u.my_chat_member || {}, c = m.chat; if (!c || seen[c.id]) return; seen[c.id] = true;
    out.push({ id: String(c.id), type: c.type, title: c.title || [c.first_name, c.last_name].filter(String).join(' ') || c.username || String(c.id) });
  });
  return { chats: out, message: out.length ? out.length + ' chat ditemukan.' : 'Belum ada chat. Kirim /start ke bot (atau pesan di grup yang berisi bot), tunggu 5 detik, lalu klik lagi.' };
}
function notifySetChat_(p) {
  assertAllStoresScope_('Notifikasi Telegram');
  const id = String((p && p.chatId) || '').trim();
  if (!/^-?\d{3,20}$/.test(id)) throw new Error('ID chat tidak valid.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('TELEGRAM_CHAT_ID', id); props.setProperty('TELEGRAM_CHAT_TITLE', String(p.title || '').slice(0, 80));
  tgCall_('sendMessage', { chat_id: id, text: '✅ Notifikasi PKS Keuangan tersambung ke chat ini.' });
  return { ok: true, message: 'Chat disimpan dan pesan percobaan terkirim.' };
}
function notifyTest_() {
  assertAllStoresScope_('Notifikasi Telegram');
  if (!notifyReady_()) throw new Error('Atur nomor WhatsApp tujuan dulu.');
  notifySend_('🛒 *Contoh notifikasi pesanan baru*\nTT-PANGAN • #123456789\n2 item • Rp 45.000\n• Cengkeh — 50 gram\n• Biji Pala — 100 gram',
    '🛒 <b>Contoh notifikasi pesanan baru</b>\nTT-PANGAN • #123456789\n2 item • Rp 45.000\n• Cengkeh — 50 gram\n• Biji Pala — 100 gram');
  return { ok: true, message: 'Pesan contoh terkirim. Cek WhatsApp/Telegram.' };
}
function notifyEnable_(p) {
  assertAllStoresScope_('Notifikasi Telegram');
  const on = !!(p && p.on), props = PropertiesService.getScriptProperties();
  if (on && !notifyReady_()) throw new Error('Atur token Fonnte & nomor WhatsApp tujuan dulu.');
  try {
    ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'notifyTick_'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
    if (on) { ScriptApp.newTrigger('notifyTick_').timeBased().everyMinutes(10).create(); props.setProperty('NOTIFY_SINCE', String(Math.floor(Date.now() / 1000))); }
  } catch (e) {
    throw new Error('Izin pemicu belum diberikan. Owner perlu menjalankan fungsi notifySetupFromEditor sekali dari editor Apps Script (Run → Izinkan).');
  }
  return { ok: true, message: on ? 'Notifikasi aktif: pesanan baru dicek setiap ±10 menit.' : 'Notifikasi dimatikan.' };
}
/** Jalankan SEKALI dari editor Apps Script bila tombol Aktifkan gagal karena izin. */
function notifySetupFromEditor() {
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'notifyTick_'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('notifyTick_').timeBased().everyMinutes(10).create();
  PropertiesService.getScriptProperties().setProperty('NOTIFY_SINCE', String(Math.floor(Date.now() / 1000)));
  return 'Notifikasi pesanan aktif (tiap 10 menit).';
}

/* ---------------- Pemicu tiap 10 menit ---------------- */
function notifyLogSheet_() {
  const ss = getDatabase_(); let sh = ss.getSheetByName('Notif_Log');
  if (!sh) sh = ss.insertSheet('Notif_Log');
  if (!sh.getLastRow()) { sh.getRange(1, 1, 1, NOTIFY_LOG_HEADERS.length).setValues([NOTIFY_LOG_HEADERS]); sh.setFrozenRows(1); }   // sheet ada tapi kosong → tulis judul
  return sh;
}
function notifyTick_() {
  const props = PropertiesService.getScriptProperties();
  // Status pesanan selalu diperbarui (dikirim → sampai → selesai), walaupun WA/Telegram belum diatur.
  if (!notifyReady_()) {
    const errs = ttsPullRecentUpdates_(2 * 3600);
    props.setProperty('NOTIFY_LAST_RUN', Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm'));
    props.setProperty('NOTIFY_LAST_RESULT', 'status pesanan diperbarui (notifikasi WA/Telegram belum diatur)' + (errs.length ? ' • ' + errs[0] : ''));
    return 'Status diperbarui';
  }
  const lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return 'Sibuk';
  let sent = 0, errors = [];
  try {
    const now = Math.floor(Date.now() / 1000), since = Number(props.getProperty('NOTIFY_SINCE') || now - 3600);
    const range = { ge: Math.max(since, now - 2 * 3600), lt: now + 60 }, deadline = Date.now() + 120000;
    ttsShops_().filter(function(s) { return s.status === 'AKTIF' && s.storeCode; }).forEach(function(s) {
      try { const auth = ttsGetAuth_(s.openId); if (auth) ttsPullOrders_(s, auth, range, deadline, 'update_time'); } catch (e) { errors.push(s.name + ': ' + e.message); }
    });
    // Pesanan dibayar yang belum pernah dinotifikasi
    const log = notifyLogSheet_(), done = {};
    if (log.getLastRow() > 1) log.getRange(2, 1, log.getLastRow() - 1, 1).getValues().forEach(function(r) { done[String(r[0])] = true; });
    const sinceIso = Utilities.formatDate(new Date(range.ge * 1000), 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
    const lines = {};
    plSheetRows_('TTS_OrderLines', 20).forEach(function(r) { (lines[String(r[2]) + '|' + String(r[3])] = lines[String(r[2]) + '|' + String(r[3])] || []).push({ p: String(r[11] || ''), v: String(r[12] || '') }); });
    const add = [];
    plSheetRows_('TTS_Orders', 23).forEach(function(r) {
      const key = 'tts|' + r[0], status = String(r[7] || '');
      if (done[key] || NOTIFY_STATUSES.indexOf(status) < 0 || stockStamp_(r[4]) < sinceIso) return;
      if (sent >= 20) return;   // batas per putaran; sisanya putaran berikutnya
      const items = lines[String(r[2]) + '|' + String(r[3])] || [], total = numOrNull_(r[18]) !== null ? numOrNull_(r[18]) : numOrNull_(r[12]);
      const group = {}; items.forEach(function(i) { const k = i.p.slice(0, 60) + (i.v ? ' — ' + i.v : ''); group[k] = (group[k] || 0) + 1; });
      const cod = r[21] === true || String(r[21]) === 'true', head = '#' + r[3] + ' • ' + items.length + ' item' + (total !== null ? ' • Rp ' + Math.round(total).toLocaleString('id-ID') : '');
      const list = Object.keys(group).slice(0, 10), more = Object.keys(group).length > 10 ? '\n…' : '';
      const html = '🛒 <b>Pesanan baru — ' + tgEsc_(r[2]) + '</b>\n' + tgEsc_(head) + '\n' + list.map(function(k) { return '• ' + tgEsc_(k) + (group[k] > 1 ? ' ×' + group[k] : ''); }).join('\n') + more + (cod ? '\n💵 COD' : '');
      const wa = '🛒 *Pesanan baru — ' + r[2] + '*\n' + head + '\n' + list.map(function(k) { return '• ' + k + (group[k] > 1 ? ' ×' + group[k] : ''); }).join('\n') + more + (cod ? '\n💵 COD' : '');
      let res = 'TERKIRIM';
      try { notifySend_(wa, html); sent++; }
      catch (e) { res = 'GAGAL: ' + e.message.slice(0, 200); errors.push(e.message); }
      add.push([key, String(r[2]), String(r[3]), status, new Date(), res]);
    });
    if (add.length) ensureRoom_(log, add.length, NOTIFY_LOG_HEADERS.length).getRange(log.getLastRow() + 1, 1, add.length, NOTIFY_LOG_HEADERS.length).setValues(add);
  } finally { lock.releaseLock(); }
  const summary = sent + ' notifikasi terkirim' + (errors.length ? ' • ' + errors.length + ' error: ' + errors[0].slice(0, 160) : '');
  props.setProperty('NOTIFY_LAST_RUN', Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm'));
  props.setProperty('NOTIFY_LAST_RESULT', summary);
  return summary;
}
