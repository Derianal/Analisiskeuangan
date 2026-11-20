/**
 * TAHAP 6 — INTEGRASI TIKTOK SHOP OPEN API (banyak toko)
 *
 * Sumber acuan endpoint/field: SDK Node TikTok Shop hasil generate spesifikasi OpenAPI resmi
 * (model *202309 / *202501). Bagian yang belum bisa dipastikan ditandai "CEK DOKUMENTASI".
 *
 * Keamanan:
 * - TTS_APP_KEY, TTS_APP_SECRET, dan token akses/refresh disimpan di Script Properties (server).
 *   Sheet TTS_Tokens hanya menyimpan metadata (nama toko, cipher, masa berlaku, status) — TANPA token.
 * - Tidak ada key/secret/token yang dikirim ke browser, ditulis ke log, atau ikut ekspor.
 *
 * Aturan data:
 * - Nilai kosong dari API disimpan kosong (null), bukan 0.
 * - Ongkir/total bayar adalah nilai PESANAN → disimpan di TTS_Orders (1 baris per pesanan),
 *   item disimpan di TTS_OrderLines (1 baris per item). Keduanya tidak dijumlahkan bersama.
 * - Data iklan GMV Max TIDAK tersedia di Shop API; tetap memakai impor Excel GMV Max.
 * - Data API tidak menimpa atau menghapus data impor Excel.
 */
const TTS_AUTH_HOST = 'https://auth.tiktok-shops.com';
const TTS_API_HOST = 'https://open-api.tiktokglobalshop.com';
const TTS_PAGE_SIZE = 50;          // CEK DOKUMENTASI: batas maksimum page_size berbeda per endpoint (umumnya ≤100).
const TTS_TIME_BUDGET_MS = 270000; // berhenti aman sebelum batas 6 menit Apps Script.
const TTS_REFRESH_BEFORE_SEC = 24 * 3600;

const TTS_SHEETS = {
  TTS_Tokens: ['shop_id', 'shop_name', 'shop_code', 'shop_cipher', 'region', 'seller_type', 'seller_name', 'open_id',
    'access_token_expire_at', 'refresh_token_expire_at', 'status', 'store_code', 'last_sync_at', 'last_sync_status',
    'last_error', 'connected_by', 'updated_at'],
  TTS_Orders: ['key', 'shop_id', 'store_code', 'order_id', 'create_time', 'update_time', 'paid_time', 'status', 'currency',
    'original_total_product_price', 'seller_discount', 'platform_discount', 'sub_total', 'shipping_fee',
    'original_shipping_fee', 'shipping_fee_seller_discount', 'shipping_fee_platform_discount', 'tax', 'total_amount',
    'line_count', 'payment_method_name', 'is_cod', 'synced_at'],
  TTS_OrderLines: ['key', 'shop_id', 'store_code', 'order_id', 'line_item_id', 'create_time', 'order_status', 'display_status',
    'product_id', 'sku_id', 'seller_sku', 'product_name', 'sku_name', 'qty', 'original_price', 'sale_price',
    'seller_discount', 'platform_discount', 'currency', 'synced_at'],
  TTS_Products: ['key', 'shop_id', 'store_code', 'product_id', 'sku_id', 'seller_sku', 'title', 'status', 'currency',
    'sale_price', 'tax_exclusive_price', 'stock_total', 'create_time', 'update_time', 'synced_at'],
  TTS_Statements: ['key', 'shop_id', 'store_code', 'statement_id', 'statement_time', 'payment_status', 'payment_id', 'currency',
    'revenue_amount', 'fee_amount', 'shipping_cost_amount', 'adjustment_amount', 'net_sales_amount', 'settlement_amount', 'synced_at'],
  TTS_Finance: ['key', 'shop_id', 'store_code', 'statement_id', 'transaction_id', 'type', 'order_id', 'order_create_time',
    'currency', 'revenue_amount', 'fee_tax_amount', 'platform_commission_amount', 'transaction_fee_amount',
    'affiliate_commission_amount', 'shipping_cost_amount', 'adjustment_amount', 'settlement_amount', 'synced_at'],
  TTS_Returns: ['key', 'shop_id', 'store_code', 'return_id', 'order_id', 'create_time', 'update_time', 'return_type',
    'return_status', 'return_reason_text', 'currency', 'refund_subtotal', 'refund_shipping_fee', 'refund_total', 'synced_at'],
  TTS_Promotions: ['key', 'shop_id', 'store_code', 'activity_id', 'title', 'activity_type', 'status', 'product_level',
    'begin_time', 'end_time', 'create_time', 'update_time', 'synced_at']
};
// CEK DOKUMENTASI: daftar status pesanan 202309. Pesanan berstatus ini bukan penjualan.
const TTS_NON_SALE_STATUS = ['UNPAID', 'CANCELLED'];

/* ===================== 1. KONFIGURASI ===================== */
function ttsConfig_() {
  const p = PropertiesService.getScriptProperties();
  const key = p.getProperty('TTS_APP_KEY'), secret = p.getProperty('TTS_APP_SECRET');
  if (!key || !secret) throw new Error('TTS_APP_KEY dan TTS_APP_SECRET belum diisi di Script Properties.');
  return { appKey: key, appSecret: secret };
}
function ttsSheet_(name) {
  const ss = getDatabase_();
  let sh = ss.getSheetByName(name);
  const headers = TTS_SHEETS[name];
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.getRange(1, 1, 1, headers.length).setValues([headers]); sh.setFrozenRows(1); }
  else if (sh.getLastColumn() < headers.length) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sh;
}
/** Angka dari API (format mesin, mis. "12500.00"). Kosong → null. TIDAK memakai parser format Indonesia. */
function ttsNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function ttsTime_(sec) {
  const n = Number(sec);
  if (!n || !isFinite(n)) return '';
  return Utilities.formatDate(new Date(n * 1000), 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
}
function ttsNow_() { return Utilities.formatDate(new Date(), 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss"); }
function ttsCell_(v) { return v === null || v === undefined ? '' : v; }

/* ===================== Penyimpanan token (Script Properties, per otorisasi/open_id) ===================== */
function ttsTokenKey_(openId) { return 'TTS_AUTH_' + String(openId).replace(/[^A-Za-z0-9_-]/g, ''); }
function ttsGetAuth_(openId) {
  const raw = PropertiesService.getScriptProperties().getProperty(ttsTokenKey_(openId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function ttsSaveAuth_(openId, auth) {
  PropertiesService.getScriptProperties().setProperty(ttsTokenKey_(openId), JSON.stringify(auth));
}
/**
 * Respons token: access_token_expire_in / refresh_token_expire_in.
 * CEK DOKUMENTASI: dokumentasi menyebut nilai ini sebagai waktu kedaluwarsa (Unix timestamp detik).
 * Bila nilainya kecil (< 10^9), diperlakukan sebagai "detik dari sekarang" agar tetap aman.
 */
function ttsExpireAt_(v) {
  const n = Number(v);
  if (!n || !isFinite(n)) return null;
  return n > 1000000000 ? n : Math.floor(Date.now() / 1000) + n;
}

/* ===================== 4. SIGNING & REQUEST ===================== */
/**
 * Tanda tangan TikTok Shop (sesuai SDK resmi):
 * 1) ambil semua parameter query kecuali "sign" dan "access_token", urutkan menurut nama;
 * 2) gabungkan nama+nilai tanpa pemisah; 3) awali dengan path; 4) tambahkan body JSON (bila ada & bukan multipart);
 * 5) bungkus: secret + string + secret; 6) HMAC-SHA256 dengan kunci secret; 7) hex huruf kecil.
 */
function ttsSign_(path, query, bodyString, secret) {
  const keys = Object.keys(query || {}).filter(function(k) { return k !== 'sign' && k !== 'access_token'; }).sort();
  let base = path + keys.map(function(k) { return k + query[k]; }).join('');
  if (bodyString) base += bodyString;
  const wrapped = secret + base + secret;
  const bytes = Utilities.computeHmacSha256Signature(wrapped, secret, Utilities.Charset.UTF_8);
  return bytes.map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function ttsQueryString_(q) {
  return Object.keys(q).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
}
/** Pesan error yang bisa dipahami. Kode angka dari TikTok tetap disertakan untuk dicek di dokumentasi. */
function ttsExplainError_(code, message, httpStatus) {
  const m = String(message || '').toLowerCase();
  let hint = '';
  if (/sign/.test(m)) hint = 'Tanda tangan (sign) ditolak: cek TTS_APP_SECRET dan jam server.';
  else if (/token.*(expire|invalid)|(expire|invalid).*token|access_token/.test(m)) hint = 'Token akses tidak berlaku: jalankan refresh token atau hubungkan ulang toko.';
  else if (/scope|permission|not authorized|unauthorized|forbidden/.test(m)) hint = 'Izin (scope) aplikasi kurang atau toko belum memberi izin untuk data ini.';
  else if (/cipher/.test(m)) hint = 'shop_cipher salah: hubungkan ulang toko untuk memperbarui daftar toko.';
  else if (/limit|frequen|too many/.test(m) || httpStatus === 429) hint = 'Batas jumlah permintaan tercapai; coba lagi beberapa saat.';
  return 'TikTok API ' + (httpStatus ? 'HTTP ' + httpStatus + ', ' : '') + 'kode ' + code + ': ' + (message || 'tanpa pesan') + (hint ? ' — ' + hint : '');
}
/**
 * Request umum ke Open API. shop = {cipher, accessToken} (cipher boleh kosong untuk endpoint tingkat otorisasi).
 * Menambahkan app_key, timestamp, shop_cipher, sign; token di header x-tts-access-token.
 * Retry dengan jeda bertingkat untuk HTTP 429/5xx atau pesan batas permintaan.
 */
function ttsRequest(shop, method, path, query, body) {
  const cfg = ttsConfig_();
  const q = Object.assign({}, query || {});
  Object.keys(q).forEach(function(k) { if (q[k] === null || q[k] === undefined || q[k] === '') delete q[k]; });
  q.app_key = cfg.appKey;
  if (shop && shop.cipher) q.shop_cipher = shop.cipher;
  // POST wajib berbadan JSON walau kosong ('{}'), kalau tidak TikTok menolak dengan HTTP 415 (kode 36009022).
  const bodyString = body && Object.keys(body).length ? JSON.stringify(body) : (String(method).toUpperCase() === 'POST' ? '{}' : '');
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    q.timestamp = String(Math.floor(Date.now() / 1000));
    delete q.sign;
    q.sign = ttsSign_(path, q, bodyString, cfg.appSecret);
    const options = { method: method.toLowerCase(), muteHttpExceptions: true, headers: { 'x-tts-access-token': shop && shop.accessToken || '' } };
    if (bodyString) { options.contentType = 'application/json'; options.payload = bodyString; }
    let resp, status, json = null;
    try {
      resp = UrlFetchApp.fetch(TTS_API_HOST + path + '?' + ttsQueryString_(q), options);
      status = resp.getResponseCode();
      try { json = JSON.parse(resp.getContentText()); } catch (e) { json = null; }
    } catch (e) {
      lastError = new Error('Tidak dapat menghubungi TikTok API: ' + e.message);
      Utilities.sleep(1000 * Math.pow(2, attempt)); continue;
    }
    const code = json ? json.code : null;
    if (status === 200 && json && Number(code) === 0) return json.data || {};
    const msg = json ? json.message : ('Respons bukan JSON (HTTP ' + status + ')');
    const retryable = status === 429 || status >= 500 || /limit|frequen|too many|busy/i.test(String(msg || ''));
    lastError = new Error(ttsExplainError_(code, msg, status));
    lastError.ttsCode = code; lastError.httpStatus = status;
    if (!retryable) break;
    Utilities.sleep(1000 * Math.pow(2, attempt));
  }
  throw lastError;
}
/** Paginasi penuh via next_page_token. where: 'query' atau 'body' (lokasi page_token). */
function ttsPaginate_(shop, method, path, query, body, listKey, where, deadline) {
  const out = [];
  let token = '', pages = 0;
  do {
    const q = Object.assign({}, query), b = body ? Object.assign({}, body) : null;
    if (where === 'body') { b.page_size = TTS_PAGE_SIZE; if (token) b.page_token = token; }
    else { q.page_size = TTS_PAGE_SIZE; if (token) q.page_token = token; }
    const data = ttsRequest(shop, method, path, q, b);
    (data[listKey] || []).forEach(function(x) { out.push(x); });
    token = data.next_page_token || '';
    pages++;
    if (deadline && Date.now() > deadline) return { items: out, complete: !token, pages: pages };
  } while (token && pages < 500);
  return { items: out, complete: !token, pages: pages };
}

/* ===================== 2. OAUTH CALLBACK ===================== */
/** Link otorisasi untuk tombol "Hubungkan Toko". state dicatat 15 menit agar callback bisa diverifikasi. */
function ttsAuthUrl_() {
  assertAllStoresScope_('Menghubungkan toko TikTok');
  const p = PropertiesService.getScriptProperties();
  // CEK DOKUMENTASI: salin "Authorization link" dari Partner Center → App → detail aplikasi ke TTS_AUTH_URL.
  // Bila kosong, dibangun dari TTS_SERVICE_ID (format link layanan TikTok Shop; pastikan domain sesuai wilayah Indonesia).
  let base = p.getProperty('TTS_AUTH_URL');
  if (!base) {
    const sid = p.getProperty('TTS_SERVICE_ID');
    if (!sid) throw new Error('Isi TTS_AUTH_URL (link otorisasi dari Partner Center) atau TTS_SERVICE_ID di Script Properties.');
    base = 'https://services.tiktokshop.com/open/authorize?service_id=' + encodeURIComponent(sid);
  }
  const state = 'tts_' + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('tts:state:' + state, JSON.stringify({ by: currentActorEmail_() || '(editor)', at: Date.now() }), 900);
  return { url: base.replace(/([?&])state=[^&]*&?/, '$1') + (base.indexOf('?') >= 0 ? '&' : '?') + 'state=' + encodeURIComponent(state) };
}
/** Dipanggil dari doGet saat redirect TikTok kembali dengan ?code=...&state=tts_... */
function handleTikTokCallback(params) {
  params = params || {};
  const code = String(params.code || '');
  const state = String(params.state || '');
  try {
    if (!code) throw new Error('Kode otorisasi tidak ada. Ulangi dari tombol "Hubungkan Toko".');
    // state valid = dimulai dari aplikasi oleh Owner. Tanpa state yang valid (mis. dimulai dari sisi TikTok),
    // toko tetap dicatat tetapi berstatus MENUNGGU PERSETUJUAN dan tidak disinkron sampai Owner menyetujui.
    let initiator = null;
    if (state) {
      const cache = CacheService.getScriptCache(), raw = cache.get('tts:state:' + state);
      if (raw) { initiator = JSON.parse(raw).by; cache.remove('tts:state:' + state); }
    }
    const cfg = ttsConfig_();
    const tokenUrl = TTS_AUTH_HOST + '/api/v2/token/get?' + ttsQueryString_({ app_key: cfg.appKey, app_secret: cfg.appSecret, auth_code: code, grant_type: 'authorized_code' });
    const resp = UrlFetchApp.fetch(tokenUrl, { method: 'get', muteHttpExceptions: true });
    let json = null; try { json = JSON.parse(resp.getContentText()); } catch (e) {}
    if (resp.getResponseCode() !== 200 || !json || Number(json.code) !== 0 || !json.data || !json.data.access_token)
      throw new Error(ttsExplainError_(json && json.code, json && json.message || 'Tukar kode gagal', resp.getResponseCode()));
    const d = json.data;
    const openId = String(d.open_id || d.seller_name || Utilities.getUuid());
    const auth = { access_token: d.access_token, refresh_token: d.refresh_token,
      access_expire_at: ttsExpireAt_(d.access_token_expire_in), refresh_expire_at: ttsExpireAt_(d.refresh_token_expire_in),
      seller_name: d.seller_name || '', seller_base_region: d.seller_base_region || '', granted_scopes: d.granted_scopes || [] };
    ttsSaveAuth_(openId, auth);
    const shops = ttsRequest({ accessToken: auth.access_token }, 'GET', '/authorization/202309/shops', {}, null).shops || [];
    if (!shops.length) throw new Error('Otorisasi berhasil, tetapi tidak ada toko yang diberikan izin.');
    const names = withScriptLock_(function() {
      return shops.map(function(s) { ttsUpsertShop_(s, openId, auth, initiator); return s.name || s.id; });
    });
    return ttsCallbackPage_(true, 'Toko ' + names.join(', ') + ' berhasil terhubung.' +
      (initiator ? ' Buka menu Koneksi Toko untuk memilih toko di Master Toko, lalu Sinkron.' : ' Status: MENUNGGU PERSETUJUAN Owner di menu Koneksi Toko.'));
  } catch (e) {
    console.error('TikTok callback gagal: ' + e.message);
    return ttsCallbackPage_(false, e.message);
  }
}
function ttsUpsertShop_(s, openId, auth, initiator) {
  const sh = ttsSheet_('TTS_Tokens');
  const width = TTS_SHEETS.TTS_Tokens.length;
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
  const idx = rows.findIndex(function(r) { return String(r[0]) === String(s.id); });
  const old = idx >= 0 ? rows[idx] : null;
  // Toko otomatis dipetakan bila "ID Toko Platform" di Master Toko sama dengan shop_id.
  const linked = finStoresFromRows_(finRows_('FinStores')).find(function(st) { return st.platformShopId && st.platformShopId === String(s.id); });
  const status = initiator ? 'AKTIF' : (old && old[10] === 'AKTIF' ? 'AKTIF' : 'MENUNGGU PERSETUJUAN');
  const row = [String(s.id), s.name || '', s.code || '', s.cipher || '', s.region || '', s.seller_type || '', auth.seller_name, openId,
    auth.access_expire_at ? ttsTime_(auth.access_expire_at) : '', auth.refresh_expire_at ? ttsTime_(auth.refresh_expire_at) : '',
    status, old ? old[11] || (linked ? linked.code : '') : (linked ? linked.code : ''), old ? old[12] : '', old ? old[13] : '', '',
    initiator || (old ? old[15] : '(dari TikTok)'), ttsNow_()];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, width).setValues([row]); else sh.appendRow(row);
  auditChange_('tts-connect', 'TTS_Tokens', String(s.id), old ? { status: old[10], store: old[11] } : null, { status: status, store: row[11], name: row[1] });
}
function ttsCallbackPage_(ok, message) {
  const safe = String(message).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  return HtmlService.createHtmlOutput('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Koneksi TikTok Shop</title>' +
    '<div style="font:16px/1.6 system-ui;max-width:520px;margin:40px auto;padding:22px;border-radius:14px;border:1px solid ' + (ok ? '#a7dcb9;background:#eefaf2' : '#f2b8b8;background:#fdf0f0') + '">' +
    '<h2 style="margin-top:0">' + (ok ? '✅ Berhasil' : '⚠️ Belum berhasil') + '</h2><p>' + safe + '</p><p>Tab ini boleh ditutup. Kembali ke aplikasi lalu buka menu <b>Koneksi Toko</b>.</p></div>')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1').setTitle('Koneksi TikTok Shop');
}

/* ===================== 3. REFRESH TOKEN OTOMATIS ===================== */
/** Tampilkan waktu dari sel sheet dengan rapi (sel bisa berubah jadi objek Date oleh Google Sheets). */
function ttsCellTime_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, 'Asia/Jakarta', 'dd MMM yyyy HH:mm');
  return String(v || '').replace('T', ' ').slice(0, 16);
}
function ttsShops_() {
  const sh = ttsSheet_('TTS_Tokens');
  const width = TTS_SHEETS.TTS_Tokens.length;
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
  return rows.map(function(r, i) {
    return { row: i + 2, id: String(r[0]), name: String(r[1]), code: String(r[2]), cipher: String(r[3]), region: String(r[4]),
      sellerType: String(r[5]), sellerName: String(r[6]), openId: String(r[7]), accessExpireAt: ttsCellTime_(r[8]), refreshExpireAt: ttsCellTime_(r[9]),
      status: String(r[10]), storeCode: String(r[11] || ''), lastSyncAt: ttsCellTime_(r[12]), lastSyncStatus: String(r[13] || ''),
      lastError: String(r[14] || ''), connectedBy: String(r[15] || ''), updatedAt: String(r[16] || '') };
  }).filter(function(s) { return s.id; });
}
function ttsSetShopFields_(shopRow, fields) {
  const sh = ttsSheet_('TTS_Tokens');
  const headers = TTS_SHEETS.TTS_Tokens;
  Object.keys(fields).forEach(function(k) {
    const col = headers.indexOf(k);
    if (col >= 0) sh.getRange(shopRow, col + 1).setValue(fields[k]);
  });
}
/** Refresh token untuk setiap otorisasi yang access token-nya kedaluwarsa < 24 jam lagi. */
function refreshAllTikTokTokens(force) {
  const cfg = ttsConfig_();
  const shops = ttsShops_();
  const openIds = shops.map(function(s) { return s.openId; }).filter(function(x, i, a) { return x && a.indexOf(x) === i; });
  const now = Math.floor(Date.now() / 1000);
  const result = { refreshed: 0, skipped: 0, failed: [] };
  openIds.forEach(function(openId) {
    const auth = ttsGetAuth_(openId);
    const related = shops.filter(function(s) { return s.openId === openId; });
    if (!auth || !auth.refresh_token) { result.failed.push(openId + ': token tidak ada, hubungkan ulang'); related.forEach(function(s) { ttsSetShopFields_(s.row, { status: 'PERLU HUBUNGKAN ULANG', last_error: 'Token tidak ditemukan.' }); }); return; }
    if (!force && auth.access_expire_at && auth.access_expire_at - now > TTS_REFRESH_BEFORE_SEC) { result.skipped++; return; }
    if (auth.refresh_expire_at && auth.refresh_expire_at <= now) {
      result.failed.push(openId + ': refresh token kedaluwarsa');
      related.forEach(function(s) { ttsSetShopFields_(s.row, { status: 'PERLU HUBUNGKAN ULANG', last_error: 'Refresh token kedaluwarsa. Hubungkan ulang toko.' }); });
      return;
    }
    try {
      const url = TTS_AUTH_HOST + '/api/v2/token/refresh?' + ttsQueryString_({ app_key: cfg.appKey, app_secret: cfg.appSecret, refresh_token: auth.refresh_token, grant_type: 'refresh_token' });
      const resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
      let json = null; try { json = JSON.parse(resp.getContentText()); } catch (e) {}
      if (resp.getResponseCode() !== 200 || !json || Number(json.code) !== 0 || !json.data || !json.data.access_token)
        throw new Error(ttsExplainError_(json && json.code, json && json.message || 'Refresh gagal', resp.getResponseCode()));
      const d = json.data;
      const next = Object.assign({}, auth, { access_token: d.access_token, refresh_token: d.refresh_token || auth.refresh_token,
        access_expire_at: ttsExpireAt_(d.access_token_expire_in), refresh_expire_at: ttsExpireAt_(d.refresh_token_expire_in) || auth.refresh_expire_at });
      ttsSaveAuth_(openId, next);
      related.forEach(function(s) { ttsSetShopFields_(s.row, { access_token_expire_at: ttsTime_(next.access_expire_at), refresh_token_expire_at: ttsTime_(next.refresh_expire_at), last_error: '', updated_at: ttsNow_() }); });
      result.refreshed++;
    } catch (e) {
      result.failed.push(openId + ': ' + e.message);
      related.forEach(function(s) { ttsSetShopFields_(s.row, { last_error: e.message.slice(0, 400) }); });
      console.error('Refresh token TikTok gagal (' + openId + '): ' + e.message);
    }
  });
  return result;
}
/** Pasang trigger harian: refresh token (±02.00 WIB) dan sinkron 3 hari terakhir (±03.00 WIB). Aman dijalankan ulang. */
function setupTikTokTriggers() {
  ['ttsDailyRefresh_', 'ttsDailySync_'].forEach(function(fn) {
    ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === fn; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  });
  ScriptApp.newTrigger('ttsDailyRefresh_').timeBased().everyDays(1).atHour(2).inTimezone('Asia/Jakarta').create();
  ScriptApp.newTrigger('ttsDailySync_').timeBased().everyDays(1).atHour(3).inTimezone('Asia/Jakarta').create();
  return 'Trigger TikTok terpasang: refresh token harian ±02.00 WIB, sinkron harian ±03.00 WIB.';
}
function ttsDailyRefresh_() { return refreshAllTikTokTokens(false); }
/** Perbarui status pesanan yang berubah 3 hari terakhir (termasuk pesanan lama yang baru sampai/selesai). */
function ttsPullRecentUpdates_(seconds) {
  const now = Math.floor(Date.now() / 1000), range = { ge: now - (seconds || 3 * 86400), lt: now + 60 }, deadline = Date.now() + 60000, errors = [];
  ttsShops_().filter(function(s) { return s.status === 'AKTIF' && s.storeCode; }).forEach(function(s) {
    try { const auth = ttsGetAuth_(s.openId); if (auth) ttsPullOrders_(s, auth, range, deadline, 'update_time'); } catch (e) { errors.push(s.name + ': ' + e.message.slice(0, 120)); }
  });
  return errors;
}
function ttsDailySync_() {
  try { ttsPullRecentUpdates_(3 * 86400); } catch (e) {}
  const end = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const start = Utilities.formatDate(new Date(Date.now() - 3 * 86400000), 'Asia/Jakarta', 'yyyy-MM-dd');
  const r = syncTikTokShop(start, end);
  // Shopee ikut disinkron di trigger harian yang sama (bila sudah ada toko Shopee terhubung).
  try { if (typeof syncShopee === 'function' && getDatabase_().getSheetByName('SP_Shops')) r.shopee = syncShopee(start, end); } catch (e) { r.shopeeError = e.message; }
  return r;
}
/** Jalankan dari editor Apps Script untuk tes: sinkron 7 hari terakhir semua toko aktif. */
function tesSyncTikTok7Hari() {
  const end = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const start = Utilities.formatDate(new Date(Date.now() - 7 * 86400000), 'Asia/Jakarta', 'yyyy-MM-dd');
  const r = syncTikTokShop(start, end);
  console.log(JSON.stringify(r));
  return r;
}

/* ===================== 5. PENARIK DATA ===================== */
/** Upsert berdasarkan kolom pertama "key". Baris lain (termasuk data impor Excel di sheet lain) tidak disentuh. */
function ttsUpsert_(sheetName, rows) {
  if (!rows.length) return { added: 0, updated: 0 };
  // Tandai ringkasan laba rugi perlu dihitung ulang mulai tanggal transaksi tertua di batch ini.
  const dateCol = { TTS_Orders: 4, TTS_OrderLines: 5, TTS_Returns: 5, TTS_Finance: 7 }[sheetName];
  if (dateCol !== undefined && typeof plMarkDirty_ === 'function') {
    let min = '';
    rows.forEach(function(r) { const d = plDayKey_(r[dateCol]); if (d && (!min || d < min)) min = d; });
    plMarkDirty_(min || finAddDays_(plToday_(), -60)); // transaksi keuangan tanpa tanggal pesanan: hitung ulang 60 hari
  }
  // Kunci hanya saat menulis (bukan selama menunggu API) agar pengguna lain tidak tertahan lama.
  return withScriptLock_(function() { return ttsUpsertLocked_(sheetName, rows); }, 30000);
}
function ttsUpsertLocked_(sheetName, rows) {
  const sh = ttsSheet_(sheetName);
  const width = TTS_SHEETS[sheetName].length;
  const existing = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
  const pos = {};
  existing.forEach(function(r, i) { pos[String(r[0])] = i; });
  let updated = 0;
  const appended = [];
  rows.forEach(function(r) {
    const row = r.map(ttsCell_);
    if (Object.prototype.hasOwnProperty.call(pos, row[0])) { existing[pos[row[0]]] = row; updated++; }
    else { pos[row[0]] = existing.length + appended.length; appended.push(row); }
  });
  if (updated) sh.getRange(2, 1, existing.length, width).setValues(existing);
  if (appended.length) ensureRoom_(sh, appended.length, width).getRange(sh.getLastRow() + 1, 1, appended.length, width).setValues(appended);
  return { added: appended.length, updated: updated };
}
function ttsDayRange_(startDate, endDate) {
  [startDate, endDate].forEach(function(d) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw new Error('Tanggal harus YYYY-MM-DD.'); });
  if (startDate > endDate) throw new Error('Tanggal mulai melewati tanggal akhir.');
  // Batas hari dalam WIB (UTC+7) → Unix detik. Batas akhir eksklusif (hari berikutnya 00:00 WIB).
  const ge = Math.floor(Date.parse(startDate + 'T00:00:00+07:00') / 1000);
  const lt = Math.floor(Date.parse(endDate + 'T00:00:00+07:00') / 1000) + 86400;
  return { ge: ge, lt: lt };
}
function ttsPullOrders_(shop, auth, range, deadline, field) {
  // field 'update_time' → ambil pesanan yang STATUSNYA berubah di rentang ini (mis. dikirim → sampai → selesai). Default: waktu dibuat.
  const f = field === 'update_time' ? 'update_time' : 'create_time', body = {}; body[f + '_ge'] = range.ge; body[f + '_lt'] = range.lt;
  const res = ttsPaginate_({ cipher: shop.cipher, accessToken: auth.access_token }, 'POST', '/order/202309/orders/search',
    { sort_field: 'create_time', sort_order: 'ASC' }, body, 'orders', 'query', deadline);
  const now = ttsNow_(), orders = [], lines = [];
  res.items.forEach(function(o) {
    const p = o.payment || {};
    const items = o.line_items || [];
    orders.push([shop.id + '|' + o.id, shop.id, shop.storeCode, String(o.id), ttsTime_(o.create_time), ttsTime_(o.update_time), ttsTime_(o.paid_time),
      o.status || '', p.currency || '', ttsNum_(p.original_total_product_price), ttsNum_(p.seller_discount), ttsNum_(p.platform_discount),
      ttsNum_(p.sub_total), ttsNum_(p.shipping_fee), ttsNum_(p.original_shipping_fee), ttsNum_(p.shipping_fee_seller_discount),
      ttsNum_(p.shipping_fee_platform_discount), ttsNum_(p.tax), ttsNum_(p.total_amount), items.length, o.payment_method_name || '',
      o.is_cod === true, now]);
    items.forEach(function(li) {
      // Model line_items 202309 tidak memiliki kolom jumlah: satu baris item = 1 unit (CEK DOKUMENTASI).
      lines.push([shop.id + '|' + o.id + '|' + li.id, shop.id, shop.storeCode, String(o.id), String(li.id), ttsTime_(o.create_time), o.status || '',
        li.display_status || '', String(li.product_id || ''), String(li.sku_id || ''), li.seller_sku || '', li.product_name || '', li.sku_name || '',
        1, ttsNum_(li.original_price), ttsNum_(li.sale_price), ttsNum_(li.seller_discount), ttsNum_(li.platform_discount), li.currency || p.currency || '', now]);
    });
  });
  const a = ttsUpsert_('TTS_Orders', orders), b = ttsUpsert_('TTS_OrderLines', lines);
  return { orders: orders.length, lines: lines.length, added: a.added, updated: a.updated, complete: res.complete };
}
function ttsPullProducts_(shop, auth, deadline) {
  // Produk diambil penuh (bukan per tanggal) agar stok & harga terbaru. Filter status: CEK DOKUMENTASI.
  const res = ttsPaginate_({ cipher: shop.cipher, accessToken: auth.access_token }, 'POST', '/product/202309/products/search', {}, {}, 'products', 'query', deadline);
  const now = ttsNow_(), rows = [];
  res.items.forEach(function(pr) {
    (pr.skus || []).forEach(function(sku) {
      const price = sku.price || {};
      const inv = sku.inventory || [];
      const stock = inv.length ? inv.reduce(function(t, x) { const q = ttsNum_(x.quantity); return q === null ? t : (t || 0) + q; }, null) : null;
      rows.push([shop.id + '|' + pr.id + '|' + sku.id, shop.id, shop.storeCode, String(pr.id), String(sku.id), sku.seller_sku || '', pr.title || '',
        pr.status || '', price.currency || '', ttsNum_(price.sale_price), ttsNum_(price.tax_exclusive_price), stock,
        ttsTime_(pr.create_time), ttsTime_(pr.update_time), now]);
    });
  });
  const r = ttsUpsert_('TTS_Products', rows);
  return { skus: rows.length, added: r.added, updated: r.updated, complete: res.complete };
}
function ttsPullFinance_(shop, auth, range, deadline) {
  const tokenShop = { cipher: shop.cipher, accessToken: auth.access_token };
  // CEK DOKUMENTASI: Get Statements v202309 (beberapa integrator menandai deprecated; belum ada versi baru di SDK).
  const st = ttsPaginate_(tokenShop, 'GET', '/finance/202309/statements',
    { statement_time_ge: range.ge, statement_time_lt: range.lt, sort_field: 'statement_time', sort_order: 'ASC' }, null, 'statements', 'query', deadline);
  const now = ttsNow_(), statements = [], txRows = [];
  let txComplete = true;
  st.items.forEach(function(s) {
    statements.push([shop.id + '|' + s.id, shop.id, shop.storeCode, String(s.id), ttsTime_(s.statement_time), s.payment_status || '', String(s.payment_id || ''),
      s.currency || '', ttsNum_(s.revenue_amount), ttsNum_(s.fee_amount), ttsNum_(s.shipping_cost_amount), ttsNum_(s.adjustment_amount),
      ttsNum_(s.net_sales_amount), ttsNum_(s.settlement_amount), now]);
    if (Date.now() > deadline) { txComplete = false; return; }
    // Transaksi per statement (versi 202501). sort_field WAJIB; menurut SDK resmi hanya mendukung 'order_create_time'.
    const tx = ttsPaginate_(tokenShop, 'GET', '/finance/202501/statements/' + encodeURIComponent(s.id) + '/statement_transactions',
      { sort_field: 'order_create_time', sort_order: 'ASC' }, null, 'transactions', 'query', deadline);
    if (!tx.complete) txComplete = false;
    tx.items.forEach(function(t) {
      const fee = (t.fee_tax_breakdown && t.fee_tax_breakdown.fee) || {};
      txRows.push([shop.id + '|' + s.id + '|' + t.id, shop.id, shop.storeCode, String(s.id), String(t.id), t.type || '', String(t.order_id || ''),
        ttsTime_(t.order_create_time), s.currency || '', ttsNum_(t.revenue_amount), ttsNum_(t.fee_tax_amount),
        ttsNum_(fee.platform_commission_amount), ttsNum_(fee.transaction_fee_amount), ttsNum_(fee.affiliate_commission_amount),
        ttsNum_(t.shipping_cost_amount), ttsNum_(t.adjustment_amount), ttsNum_(t.settlement_amount), now]);
    });
  });
  const a = ttsUpsert_('TTS_Statements', statements), b = ttsUpsert_('TTS_Finance', txRows);
  return { statements: statements.length, transactions: txRows.length, added: a.added + b.added, updated: a.updated + b.updated, complete: st.complete && txComplete };
}
function ttsPullReturns_(shop, auth, range, deadline) {
  const res = ttsPaginate_({ cipher: shop.cipher, accessToken: auth.access_token }, 'POST', '/return_refund/202309/returns/search',
    { sort_field: 'create_time', sort_order: 'ASC' }, { create_time_ge: range.ge, create_time_lt: range.lt }, 'return_orders', 'query', deadline);
  const now = ttsNow_();
  const rows = res.items.map(function(r) {
    const ra = r.refund_amount || {};
    return [shop.id + '|' + r.return_id, shop.id, shop.storeCode, String(r.return_id), String(r.order_id || ''), ttsTime_(r.create_time), ttsTime_(r.update_time),
      r.return_type || '', r.return_status || '', r.return_reason_text || '', ra.currency || '', ttsNum_(ra.refund_subtotal), ttsNum_(ra.refund_shipping_fee),
      ttsNum_(ra.refund_total), now];
  });
  const r = ttsUpsert_('TTS_Returns', rows);
  return { returns: rows.length, added: r.added, updated: r.updated, complete: res.complete };
}
function ttsPullPromotions_(shop, auth, deadline) {
  // Search Activities: page_size/page_token berada di BODY (bukan query) menurut model SDK.
  const res = ttsPaginate_({ cipher: shop.cipher, accessToken: auth.access_token }, 'POST', '/promotion/202309/activities/search', {}, {}, 'activities', 'body', deadline);
  const now = ttsNow_();
  const rows = res.items.map(function(a) {
    return [shop.id + '|' + a.id, shop.id, shop.storeCode, String(a.id), a.title || '', a.activity_type || '', a.status || '', a.product_level || '',
      ttsTime_(a.begin_time), ttsTime_(a.end_time), ttsTime_(a.create_time), ttsTime_(a.update_time), now];
  });
  const r = ttsUpsert_('TTS_Promotions', rows);
  return { activities: rows.length, added: r.added, updated: r.updated, complete: res.complete };
}
/**
 * Sinkron per toko. startDate/endDate 'YYYY-MM-DD' (WIB). shopId opsional (kosong = semua toko AKTIF yang sudah dipetakan).
 * Bila waktu hampir habis, proses berhenti aman dan melaporkan toko yang belum selesai (jalankan lagi untuk melanjutkan).
 */
function syncTikTokShop(startDate, endDate, shopId) {
  const range = ttsDayRange_(startDate, endDate);
  const deadline = Date.now() + TTS_TIME_BUDGET_MS;
  const shops = ttsShops_().filter(function(s) { return !shopId || s.id === String(shopId); });
  if (shopId && !shops.length) throw new Error('Toko TikTok ' + shopId + ' tidak ditemukan di TTS_Tokens.');
  const report = [];
  refreshAllTikTokTokens(false);
  shops.forEach(function(s) {
    if (s.status !== 'AKTIF') { report.push({ shop: s.name, skipped: 'Status ' + s.status }); return; }
    if (!s.storeCode) { report.push({ shop: s.name, skipped: 'Belum dipetakan ke Master Toko' }); return; }
    if (!scopeAllows_(s.storeCode)) { report.push({ shop: s.name, skipped: 'Tidak ditugaskan ke akunmu' }); return; }
    if (Date.now() > deadline) { report.push({ shop: s.name, skipped: 'Waktu habis — jalankan sinkron lagi' }); return; }
    const auth = ttsGetAuth_(s.openId);
    if (!auth) { ttsSetShopFields_(s.row, { status: 'PERLU HUBUNGKAN ULANG', last_error: 'Token tidak ditemukan.' }); report.push({ shop: s.name, error: 'Token tidak ditemukan' }); return; }
    const part = { shop: s.name, storeCode: s.storeCode };
    const errors = [];
    [['orders', function() { return ttsPullOrders_(s, auth, range, deadline); }],
     ['products', function() { return ttsPullProducts_(s, auth, deadline); }],
     ['finance', function() { return ttsPullFinance_(s, auth, range, deadline); }],
     ['returns', function() { return ttsPullReturns_(s, auth, range, deadline); }],
     ['promotions', function() { return ttsPullPromotions_(s, auth, deadline); }]].forEach(function(step) {
      if (Date.now() > deadline) { part[step[0]] = { skipped: 'waktu habis' }; return; }
      try { part[step[0]] = step[1](); }
      catch (e) { errors.push(step[0] + ': ' + e.message); part[step[0]] = { error: e.message }; }
    });
    const incomplete = ['orders', 'products', 'finance', 'returns', 'promotions'].some(function(k) { return part[k] && (part[k].complete === false || part[k].skipped); });
    const statusText = errors.length ? 'SEBAGIAN GAGAL' : (incomplete ? 'BELUM LENGKAP' : 'BERHASIL');
    ttsSetShopFields_(s.row, { last_sync_at: ttsNow_(), last_sync_status: statusText + ' (' + startDate + ' s/d ' + endDate + ')', last_error: errors.join(' | ').slice(0, 900) });
    part.status = statusText; if (errors.length) part.errors = errors;
    report.push(part);
  });
  let stockNote = '';
  try { if (typeof stockApplySales_ === 'function') stockNote = stockApplySales_().message; } catch (e) { stockNote = 'Stok belum diperbarui: ' + e.message; }
  const msg = report.map(function(r) { return r.shop + ': ' + (r.skipped || r.error || r.status); }).join('; ') + (stockNote ? ' • ' + stockNote : '');
  return { stock: stockNote, startDate: startDate, endDate: endDate, shops: report, message: msg || 'Belum ada toko TikTok yang terhubung.' };
}

/* ===================== 6. UNTUK APLIKASI (dipanggil lewat teamRpc) ===================== */
/** Daftar toko untuk halaman Koneksi Toko. Tanpa token. */
let TTS_TRIGGER_AUTH_NEEDED_ = false;
/** Daftar trigger harian; bila izin ScriptApp belum diberikan, jangan gagalkan halaman. */
function ttsTriggerNames_() {
  try { TTS_TRIGGER_AUTH_NEEDED_ = false; return ScriptApp.getProjectTriggers().filter(function(t) { return /^tts/.test(t.getHandlerFunction()); }).map(function(t) { return t.getHandlerFunction(); }); }
  catch (e) { TTS_TRIGGER_AUTH_NEEDED_ = true; return []; }
}
function ttsGetConnections_() {
  assertAllStoresScope_('Koneksi Toko');
  let configured = true, configError = '';
  try { ttsConfig_(); } catch (e) { configured = false; configError = e.message; }
  const p = PropertiesService.getScriptProperties();
  return { configured: configured, configError: configError, authLinkReady: !!(p.getProperty('TTS_AUTH_URL') || p.getProperty('TTS_SERVICE_ID')),
    triggers: ttsTriggerNames_(), triggerAuthNeeded: TTS_TRIGGER_AUTH_NEEDED_,
    shops: ttsShops_().map(function(s) {
      return { id: s.id, name: s.name, code: s.code, region: s.region, sellerName: s.sellerName, status: s.status, storeCode: s.storeCode,
        accessExpireAt: s.accessExpireAt, refreshExpireAt: s.refreshExpireAt, lastSyncAt: s.lastSyncAt, lastSyncStatus: s.lastSyncStatus,
        lastError: s.lastError, connectedBy: s.connectedBy };
    }) };
}
/** Owner: petakan toko TikTok ke Master Toko dan/atau setujui toko yang masuk tanpa state. */
function ttsUpdateShop_(p) {
  assertAllStoresScope_('Mengubah koneksi toko');
  p = p || {};
  const s = ttsShops_().find(function(x) { return x.id === String(p.shopId); });
  if (!s) throw new Error('Toko TikTok tidak ditemukan.');
  const fields = {};
  if (p.storeCode !== undefined) {
    const code = String(p.storeCode || '').trim().toUpperCase();
    if (code) {
      const st = requireStoreCode_(code);
      if (!/tiktok/i.test(st.platform)) throw new Error('Toko ' + code + ' di Master Toko bukan platform TikTok.');
      const clash = ttsShops_().find(function(x) { return x.id !== s.id && x.storeCode === code; });
      if (clash) throw new Error('Kode toko ' + code + ' sudah dipakai toko TikTok ' + clash.name + '.');
    }
    fields.store_code = code;
  }
  if (p.remove === true) {
    if (s.status !== 'DIPUTUS') throw new Error('Hentikan sinkron toko ini dulu sebelum menghapus koneksinya.');
    withScriptLock_(function() {
      ttsSheet_('TTS_Tokens').deleteRow(s.row);
      const shared = ttsShops_().some(function(x) { return x.openId === s.openId; });
      if (!shared && s.openId) PropertiesService.getScriptProperties().deleteProperty(ttsTokenKey_(s.openId));
    });
    auditChange_('tts-remove', 'TTS_Tokens', s.id, { status: s.status, store: s.storeCode, name: s.name }, null);
    return { ok: true, message: 'Koneksi ' + s.name + ' dihapus. Pesanan yang sudah ditarik tetap tersimpan. Untuk menyambung lagi, klik Hubungkan Toko TikTok.' };
  }
  if (p.approve === true) fields.status = 'AKTIF';
  if (p.disconnect === true) fields.status = 'DIPUTUS';
  withScriptLock_(function() { ttsSetShopFields_(s.row, fields); });
  auditChange_('tts-update', 'TTS_Tokens', s.id, { status: s.status, store: s.storeCode }, fields);
  return { ok: true, message: 'Koneksi ' + s.name + ' diperbarui.' };
}
function ttsSyncNow_(p) {
  p = p || {};
  const end = p.endDate || Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
  const start = p.startDate || Utilities.formatDate(new Date(Date.now() - 7 * 86400000), 'Asia/Jakarta', 'yyyy-MM-dd');
  if (p.shopId) { const s = ttsShops_().find(function(x) { return x.id === String(p.shopId); }); if (s && s.storeCode) assertStoreAllowed_(s.storeCode); }
  return syncTikTokShop(start, end, p.shopId || '');
}
/**
 * Baris untuk Dashboard sumber "TikTok Shop API": 1 baris per pesanan.
 * Nilai pesanan = payment.sub_total (harga produk setelah diskon penjual & platform, tanpa ongkir).
 * Pesanan UNPAID/CANCELLED tidak dihitung. Dibatasi akses toko.
 */
function ttsDashboardRows_(opts) {
  opts = opts || {};
  const want = String(opts.storeCode || '').trim().toUpperCase();
  if (want) assertStoreAllowed_(want);
  const scope = allowedStoreList_();
  const sh = ttsSheet_('TTS_Orders');
  const width = TTS_SHEETS.TTS_Orders.length;
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
  let excluded = 0;
  const out = [];
  rows.forEach(function(r) {
    const code = String(r[2] || '').toUpperCase();
    if (want && code !== want) return;
    if (scope && scope.indexOf(code) < 0) return;
    if (TTS_NON_SALE_STATUS.indexOf(String(r[7])) >= 0) { excluded++; return; }
    out.push({ date: plDayKey_(r[4]), gmv: numOrNull_(r[12]), orders: 1, units: numOrNull_(r[19]), currency: String(r[8] || 'UNKNOWN'), storeCode: code });
  });
  return { source: 'tts', rows: out, excludedNonSale: excluded };
}
