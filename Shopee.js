/**
 * INTEGRASI SHOPEE OPEN PLATFORM v2 (mode UJI / LIVE, banyak toko)
 *
 * Acuan endpoint/field: SDK komunitas @congminh1254/shopee-sdk (skema dari dokumentasi Shopee v2).
 * Bagian yang belum dipastikan ditandai "CEK DOKUMENTASI".
 *
 * Mode:
 *  - UJI  (sandbox): kunci SHOPEE_TEST_PARTNER_ID / SHOPEE_TEST_PARTNER_KEY, server openplatform.sandbox.test-stable.shopee.sg.
 *  - LIVE           : kunci SHOPEE_LIVE_PARTNER_ID / SHOPEE_LIVE_PARTNER_KEY, server partner.shopeemobile.com.
 *  Toko & token setiap mode disimpan terpisah, jadi data uji tidak tercampur data asli.
 *
 * Keamanan: Partner Key & token hanya di Script Properties. Sheet SP_Shops berisi metadata tanpa token.
 * Data: pesanan (SP_Orders), item (SP_OrderLines), rincian dana/escrow (SP_Escrow) — upsert tanpa dobel.
 */
const SP_ENV = {
  test: { api: 'https://openplatform.sandbox.test-stable.shopee.sg/api/v2', auth: 'https://open.sandbox.test-stable.shopee.com/auth', idKey: 'SHOPEE_TEST_PARTNER_ID', keyKey: 'SHOPEE_TEST_PARTNER_KEY', label: 'UJI (sandbox)' },
  live: { api: 'https://partner.shopeemobile.com/api/v2', auth: 'https://open.shopee.com/auth', idKey: 'SHOPEE_LIVE_PARTNER_ID', keyKey: 'SHOPEE_LIVE_PARTNER_KEY', label: 'LIVE' }
};
const SP_SHEETS = {
  SP_Shops: ['shop_id', 'shop_name', 'region', 'env', 'status', 'store_code', 'access_expire_at', 'refresh_expire_at', 'last_sync_at', 'last_sync_status', 'last_error', 'connected_by', 'updated_at'],
  SP_Orders: ['key', 'shop_id', 'store_code', 'order_sn', 'create_time', 'update_time', 'pay_time', 'status', 'currency', 'total_amount', 'line_count', 'payment_method', 'env', 'synced_at'],
  SP_OrderLines: ['key', 'shop_id', 'store_code', 'order_sn', 'line_key', 'create_time', 'order_status', 'item_id', 'model_id', 'item_sku', 'model_sku', 'item_name', 'model_name', 'qty', 'original_price', 'discounted_price', 'line_total', 'synced_at'],
  SP_Escrow: ['key', 'shop_id', 'store_code', 'order_sn', 'order_selling_price', 'escrow_amount', 'commission_fee', 'service_fee', 'seller_transaction_fee', 'order_ams_commission_fee', 'campaign_fee',
    'final_shipping_fee', 'actual_shipping_fee', 'buyer_paid_shipping_fee', 'shopee_shipping_rebate', 'withholding_tax', 'seller_return_refund', 'voucher_from_seller', 'seller_discount', 'synced_at']
};
// CEK DOKUMENTASI: status pesanan Shopee yang bukan penjualan.
const SP_NON_SALE_STATUS = ['UNPAID', 'CANCELLED'];

function spEnv_(env) { const e = SP_ENV[env === 'live' ? 'live' : 'test']; return e; }
function spCreds_(env) {
  const e = spEnv_(env), p = PropertiesService.getScriptProperties();
  const id = p.getProperty(e.idKey), key = p.getProperty(e.keyKey);
  if (!id || !key) throw new Error('Kunci Shopee mode ' + e.label + ' belum diisi: ' + e.idKey + ' dan ' + e.keyKey + ' di Script Properties.');
  if (!/^\d+$/.test(String(id))) throw new Error(e.idKey + ' harus berupa angka (Partner ID).');
  return { partnerId: Number(id), key: key, api: e.api, auth: e.auth, label: e.label };
}
function spSheet_(name) {
  const ss = getDatabase_(); let sh = ss.getSheetByName(name); const h = SP_SHEETS[name];
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.getRange(1, 1, 1, h.length).setValues([h]); sh.setFrozenRows(1); }
  else if (sh.getLastColumn() < h.length) sh.getRange(1, 1, 1, h.length).setValues([h]);
  return sh;
}
/** Tanda tangan Shopee v2: HMAC-SHA256(partner_key, partner_id + path + timestamp [+ access_token + shop_id]), hex. */
function spSign_(key, parts) {
  return Utilities.computeHmacSha256Signature(parts.join(''), key, Utilities.Charset.UTF_8)
    .map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function spExplain_(err, msg, status) {
  const m = String((err || '') + ' ' + (msg || '')).toLowerCase(); let hint = '';
  if (/sign/.test(m)) hint = 'Tanda tangan ditolak: cek Partner ID/Key sesuai mode (Uji vs Live).';
  else if (/token|auth/.test(m)) hint = 'Token tidak berlaku: hubungkan ulang toko atau tunggu pembaruan otomatis.';
  else if (/permission|scope|access/.test(m)) hint = 'Aplikasi belum punya izin untuk API ini di Shopee Open Platform.';
  else if (/limit|frequen|too many/.test(m) || status === 429) hint = 'Batas permintaan tercapai; coba lagi sebentar.';
  return 'Shopee API ' + (status ? 'HTTP ' + status + ', ' : '') + (err || 'error') + ': ' + (msg || 'tanpa pesan') + (hint ? ' — ' + hint : '');
}
/** Panggilan umum. shop = {env, shopId, accessToken} (kosong untuk endpoint publik/auth). */
function spRequest_(env, method, path, query, body, shop) {
  const c = spCreds_(env), fullPath = '/api/v2' + path;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ts = Math.floor(Date.now() / 1000);
    const parts = [String(c.partnerId), fullPath, String(ts)];
    const q = Object.assign({}, query || {}, { partner_id: c.partnerId, timestamp: ts });
    if (shop && shop.accessToken) { parts.push(shop.accessToken, String(shop.shopId)); q.access_token = shop.accessToken; q.shop_id = shop.shopId; }
    q.sign = spSign_(c.key, parts);
    const qs = Object.keys(q).filter(function(k) { return q[k] !== undefined && q[k] !== null && q[k] !== ''; }).map(function(k) {
      return Array.isArray(q[k]) ? q[k].map(function(v) { return encodeURIComponent(k) + '=' + encodeURIComponent(v); }).join('&') : encodeURIComponent(k) + '=' + encodeURIComponent(q[k]);
    }).join('&');
    const opt = { method: method.toLowerCase(), muteHttpExceptions: true, contentType: 'application/json' };
    if (body) opt.payload = JSON.stringify(body);
    let status, json = null;
    try { const r = UrlFetchApp.fetch(c.api + path + '?' + qs, opt); status = r.getResponseCode(); try { json = JSON.parse(r.getContentText()); } catch (e) {} }
    catch (e) { lastErr = new Error('Tidak dapat menghubungi Shopee: ' + e.message); Utilities.sleep(1000 * Math.pow(2, attempt)); continue; }
    if (status === 200 && json && !json.error) return json;
    lastErr = new Error(spExplain_(json && json.error, json && json.message, status));
    if (!(status === 429 || status >= 500 || /limit|busy/i.test(String(json && json.message)))) break;
    Utilities.sleep(1000 * Math.pow(2, attempt));
  }
  throw lastErr;
}

/* ---------------- Token (Script Properties, per mode & toko) ---------------- */
function spTokKey_(env, shopId) { return 'SP_AUTH_' + (env === 'live' ? 'LIVE' : 'TEST') + '_' + String(shopId).replace(/\D/g, ''); }
function spGetAuth_(env, shopId) { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(spTokKey_(env, shopId)) || 'null'); } catch (e) { return null; } }
function spSaveAuth_(env, shopId, a) { PropertiesService.getScriptProperties().setProperty(spTokKey_(env, shopId), JSON.stringify(a)); }
function spTokenFrom_(json, old) {
  // expire_in = detik (berdasarkan SDK). CEK DOKUMENTASI: masa berlaku refresh token (umumnya 30 hari).
  const now = Math.floor(Date.now() / 1000);
  return { access_token: json.access_token, refresh_token: json.refresh_token || (old && old.refresh_token),
    access_expire_at: now + (Number(json.expire_in) || 14400), refresh_expire_at: json.refresh_token ? now + 30 * 86400 : (old && old.refresh_expire_at) };
}

/* ---------------- Otorisasi ---------------- */
function spAuthUrl_(p) {
  assertAllStoresScope_('Menghubungkan toko Shopee');
  const env = p && p.env === 'live' ? 'live' : 'test', c = spCreds_(env);
  const redirect = PropertiesService.getScriptProperties().getProperty('TEAM_APP_URL') || ScriptApp.getService().getUrl();
  if (!redirect) throw new Error('URL aplikasi (/exec) belum diketahui. Isi TEAM_APP_URL di Script Properties.');
  const state = 'shp_' + env + '_' + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sp:state:' + state, JSON.stringify({ by: currentActorEmail_() || '(editor)', env: env }), 900);
  // CEK DOKUMENTASI: alur otorisasi baru (open.shopee.com/auth). Bila akunmu memakai alur lama, isi SHOPEE_AUTH_CLASSIC=1.
  if (PropertiesService.getScriptProperties().getProperty('SHOPEE_AUTH_CLASSIC') === '1') {
    const ts = Math.floor(Date.now() / 1000), path = '/api/v2/shop/auth_partner';
    const red = redirect + (redirect.indexOf('?') >= 0 ? '&' : '?') + 'state=' + encodeURIComponent(state);
    return { env: env, url: c.api + '/shop/auth_partner?partner_id=' + c.partnerId + '&timestamp=' + ts + '&sign=' + spSign_(c.key, [String(c.partnerId), path, String(ts)]) + '&redirect=' + encodeURIComponent(red) };
  }
  return { env: env, url: c.auth + '?partner_id=' + c.partnerId + '&auth_type=seller&response_type=code&redirect_uri=' + encodeURIComponent(redirect) + '&state=' + encodeURIComponent(state) };
}
/** Dipanggil dari doGet saat Shopee kembali dengan ?code=&shop_id=[&state=shp_...]. */
function handleShopeeCallback(params) {
  params = params || {};
  try {
    const code = String(params.code || ''), shopId = String(params.shop_id || '');
    if (!code || !/^\d+$/.test(shopId)) throw new Error('Kode otorisasi atau shop_id tidak ada. Ulangi dari tombol "Hubungkan toko Shopee".');
    const state = String(params.state || '');
    let initiator = null, env = /^shp_live_/.test(state) ? 'live' : 'test';
    if (state) { const cache = CacheService.getScriptCache(), raw = cache.get('sp:state:' + state); if (raw) { const x = JSON.parse(raw); initiator = x.by; env = x.env; cache.remove('sp:state:' + state); } }
    else env = PropertiesService.getScriptProperties().getProperty('SHOPEE_DEFAULT_ENV') === 'live' ? 'live' : 'test';
    const c = spCreds_(env);
    const tok = spRequest_(env, 'POST', '/auth/token/get', {}, { code: code, shop_id: Number(shopId), partner_id: c.partnerId }, null);
    if (!tok.access_token) throw new Error('Shopee tidak mengembalikan token.');
    const auth = spTokenFrom_(tok, null);
    spSaveAuth_(env, shopId, auth);
    let info = {}; try { info = spRequest_(env, 'GET', '/shop/get_shop_info', {}, null, { shopId: shopId, accessToken: auth.access_token }); } catch (e) { info = {}; }
    const name = withScriptLock_(function() { return spUpsertShop_(shopId, info.shop_name || ('Shopee ' + shopId), info.region || '', env, auth, initiator); });
    return ttsCallbackPage_(true, 'Toko Shopee ' + name + ' (' + c.label + ') berhasil terhubung.' + (initiator ? ' Buka Koneksi Toko untuk memetakan ke Master Toko, lalu Sinkron.' : ' Status: MENUNGGU PERSETUJUAN Owner di Koneksi Toko.'));
  } catch (e) { console.error('Shopee callback gagal: ' + e.message); return ttsCallbackPage_(false, e.message); }
}
function spUpsertShop_(shopId, name, region, env, auth, initiator) {
  const sh = spSheet_('SP_Shops'), W = SP_SHEETS.SP_Shops.length;
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, W).getValues() : [];
  const idx = rows.findIndex(function(r) { return String(r[0]) === String(shopId) && String(r[3]) === env; });
  const old = idx >= 0 ? rows[idx] : null;
  const status = initiator ? 'AKTIF' : (old && old[4] === 'AKTIF' ? 'AKTIF' : 'MENUNGGU PERSETUJUAN');
  const row = [String(shopId), name, region, env, status, old ? old[5] : '', ttsTime_(auth.access_expire_at), ttsTime_(auth.refresh_expire_at), old ? old[8] : '', old ? old[9] : '', '', initiator || (old ? old[11] : '(dari Shopee)'), ttsNow_()];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, W).setValues([row]); else sh.appendRow(row);
  auditChange_('shopee-connect', 'SP_Shops', env + ':' + shopId, old ? { status: old[4] } : null, { status: status, env: env, name: name });
  return name;
}
function spShops_() {
  const sh = spSheet_('SP_Shops'), W = SP_SHEETS.SP_Shops.length;
  return (sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, W).getValues() : []).map(function(r, i) {
    return { row: i + 2, id: String(r[0]), name: String(r[1]), region: String(r[2]), env: String(r[3]), status: String(r[4]), storeCode: String(r[5] || ''),
      accessExpireAt: ttsCellTime_(r[6]), refreshExpireAt: ttsCellTime_(r[7]), lastSyncAt: ttsCellTime_(r[8]), lastSyncStatus: String(r[9] || ''), lastError: String(r[10] || ''), connectedBy: String(r[11] || '') };
  }).filter(function(s) { return s.id; });
}
function spSetShop_(row, fields) { const sh = spSheet_('SP_Shops'), h = SP_SHEETS.SP_Shops; Object.keys(fields).forEach(function(k) { const c = h.indexOf(k); if (c >= 0) sh.getRange(row, c + 1).setValue(fields[k]); }); }
/** Perbarui token yang hampir habis (< 30 menit). */
function spEnsureToken_(s) {
  let a = spGetAuth_(s.env, s.id);
  if (!a) throw new Error('Token tidak ditemukan; hubungkan ulang toko.');
  const now = Math.floor(Date.now() / 1000);
  if (a.access_expire_at - now > 1800) return a;
  if (a.refresh_expire_at && a.refresh_expire_at <= now) throw new Error('Refresh token kedaluwarsa; hubungkan ulang toko.');
  const c = spCreds_(s.env);
  const tok = spRequest_(s.env, 'POST', '/auth/access_token/get', {}, { refresh_token: a.refresh_token, shop_id: Number(s.id), partner_id: c.partnerId }, null);
  a = spTokenFrom_(tok, a); spSaveAuth_(s.env, s.id, a);
  spSetShop_(s.row, { access_expire_at: ttsTime_(a.access_expire_at), refresh_expire_at: ttsTime_(a.refresh_expire_at) });
  return a;
}

/* ---------------- Tarik data ---------------- */
function spUpsert_(name, rows) {
  if (!rows.length) return { added: 0, updated: 0 };
  return withScriptLock_(function() {
    const sh = spSheet_(name), W = SP_SHEETS[name].length;
    const ex = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, W).getValues() : [];
    const pos = {}; ex.forEach(function(r, i) { pos[String(r[0])] = i; });
    let upd = 0; const add = [];
    rows.forEach(function(r) { const row = r.map(ttsCell_); if (Object.prototype.hasOwnProperty.call(pos, row[0])) { ex[pos[row[0]]] = row; upd++; } else { pos[row[0]] = ex.length + add.length; add.push(row); } });
    if (upd) sh.getRange(2, 1, ex.length, W).setValues(ex);
    if (add.length) ensureRoom_(sh, add.length, W).getRange(sh.getLastRow() + 1, 1, add.length, W).setValues(add);
    return { added: add.length, updated: upd };
  }, 30000);
}
function spPullShop_(s, range, deadline) {
  const a = spEnsureToken_(s), shop = { shopId: s.id, accessToken: a.access_token };
  const sns = [];
  // Rentang maksimal 15 hari per permintaan (menurut skema SDK) → dipecah per 15 hari.
  for (let from = range.ge; from < range.lt; from += 15 * 86400) {
    const to = Math.min(range.lt, from + 15 * 86400) - 1; let cursor = '', guard = 0;
    do {
      const r = spRequest_(s.env, 'GET', '/order/get_order_list', { time_range_field: 'create_time', time_from: from, time_to: to, page_size: 100, cursor: cursor }, null, shop).response || {};
      (r.order_list || []).forEach(function(o) { sns.push(String(o.order_sn)); });
      cursor = r.more ? r.next_cursor : ''; guard++;
      if (Date.now() > deadline) return { complete: false, orders: 0 };
    } while (cursor && guard < 200);
  }
  const now = ttsNow_(), orders = [], lines = [], escrows = [];
  for (let i = 0; i < sns.length; i += 50) {
    const batch = sns.slice(i, i + 50);
    const r = spRequest_(s.env, 'GET', '/order/get_order_detail', { order_sn_list: batch.join(','), response_optional_fields: 'item_list,total_amount,pay_time,payment_method' }, null, shop).response || {};
    (r.order_list || []).forEach(function(o) {
      const items = o.item_list || [];
      orders.push([s.env + '|' + s.id + '|' + o.order_sn, s.id, s.storeCode, String(o.order_sn), ttsTime_(o.create_time), ttsTime_(o.update_time), ttsTime_(o.pay_time), o.order_status || '', o.currency || '',
        ttsNum_(o.total_amount), items.length, o.payment_method || '', s.env, now]);
      items.forEach(function(it, k) {
        const qty = ttsNum_(it.model_quantity_purchased), price = ttsNum_(it.model_discounted_price);
        const lk = String(it.item_id) + '-' + String(it.model_id || 0) + '-' + k;
        lines.push([s.env + '|' + s.id + '|' + o.order_sn + '|' + lk, s.id, s.storeCode, String(o.order_sn), lk, ttsTime_(o.create_time), o.order_status || '', String(it.item_id || ''), String(it.model_id || ''),
          it.item_sku || '', it.model_sku || '', it.item_name || '', it.model_name || '', qty, ttsNum_(it.model_original_price), price, qty !== null && price !== null ? qty * price : null, now]);
      });
      // Rincian dana hanya final untuk pesanan selesai.
      if (o.order_status === 'COMPLETED' && Date.now() < deadline) {
        try {
          const e = (spRequest_(s.env, 'GET', '/payment/get_escrow_detail', { order_sn: o.order_sn }, null, shop).response || {}).order_income || {};
          escrows.push([s.env + '|' + s.id + '|' + o.order_sn, s.id, s.storeCode, String(o.order_sn)].concat(SP_SHEETS.SP_Escrow.slice(4, -1).map(function(f) { return ttsNum_(e[f]); })).concat([now]));
        } catch (err) { /* rincian dana belum tersedia → potongan ditandai belum settle */ }
      }
    });
    if (Date.now() > deadline) break;
  }
  if (typeof plMarkDirty_ === 'function') plMarkDirty_(Utilities.formatDate(new Date(range.ge * 1000), 'Asia/Jakarta', 'yyyy-MM-dd'));
  spUpsert_('SP_Orders', orders); spUpsert_('SP_OrderLines', lines); spUpsert_('SP_Escrow', escrows);
  return { complete: Date.now() <= deadline, orders: orders.length, lines: lines.length, escrow: escrows.length };
}
/** Sinkron toko Shopee (mode apa pun) yang AKTIF & sudah dipetakan. */
function syncShopee(startDate, endDate, shopKey) {
  const range = ttsDayRange_(startDate, endDate), deadline = Date.now() + TTS_TIME_BUDGET_MS;
  const report = [];
  spShops_().filter(function(s) { return !shopKey || (s.env + ':' + s.id) === shopKey; }).forEach(function(s) {
    const name = s.name + ' [' + spEnv_(s.env).label + ']';
    if (s.status !== 'AKTIF') { report.push({ shop: name, skipped: 'Status ' + s.status }); return; }
    if (!s.storeCode) { report.push({ shop: name, skipped: 'Belum dipetakan ke Master Toko' }); return; }
    if (!scopeAllows_(s.storeCode)) { report.push({ shop: name, skipped: 'Tidak ditugaskan ke akunmu' }); return; }
    if (Date.now() > deadline) { report.push({ shop: name, skipped: 'Waktu habis — jalankan sinkron lagi' }); return; }
    try { const r = spPullShop_(s, range, deadline); const st = r.complete ? 'BERHASIL' : 'BELUM LENGKAP';
      spSetShop_(s.row, { last_sync_at: ttsNow_(), last_sync_status: st + ' (' + startDate + ' s/d ' + endDate + ')', last_error: '' }); report.push({ shop: name, status: st, orders: r }); }
    catch (e) { spSetShop_(s.row, { last_sync_at: ttsNow_(), last_sync_status: 'GAGAL', last_error: e.message.slice(0, 900) }); report.push({ shop: name, error: e.message }); }
  });
  let stockNote = ''; try { if (typeof stockApplySales_ === 'function') stockNote = stockApplySales_().message; } catch (e) { stockNote = 'Stok belum diperbarui: ' + e.message; }
  return { shops: report, stock: stockNote, message: report.map(function(r) { return r.shop + ': ' + (r.skipped || r.error || r.status); }).join('; ') || 'Belum ada toko Shopee yang terhubung.' };
}

/* ---------------- Untuk aplikasi (teamRpc) ---------------- */
function spGetConnections_() {
  assertAllStoresScope_('Koneksi Toko Shopee');
  const p = PropertiesService.getScriptProperties();
  const ready = function(env) { const e = spEnv_(env); return !!(p.getProperty(e.idKey) && p.getProperty(e.keyKey)); };
  return { testReady: ready('test'), liveReady: ready('live'), shops: spShops_().map(function(s) { const x = Object.assign({}, s); delete x.row; x.envLabel = spEnv_(s.env).label; return x; }) };
}
function spUpdateShop_(p) {
  assertAllStoresScope_('Mengubah koneksi Shopee'); p = p || {};
  const s = spShops_().find(function(x) { return x.id === String(p.shopId) && x.env === (p.env === 'live' ? 'live' : 'test'); });
  if (!s) throw new Error('Toko Shopee tidak ditemukan.');
  const f = {};
  if (p.storeCode !== undefined) {
    const code = String(p.storeCode || '').trim().toUpperCase();
    if (code) { const st = requireStoreCode_(code); if (!/shopee/i.test(st.platform)) throw new Error('Toko ' + code + ' di Master Toko bukan platform Shopee.');
      if (s.env === 'live' && spShops_().some(function(x) { return x.env === 'live' && x !== s && x.storeCode === code && x.id !== s.id; })) throw new Error('Kode ' + code + ' sudah dipakai toko Shopee lain.'); }
    f.store_code = code;
  }
  if (p.remove === true) {
    if (s.status !== 'DIPUTUS') throw new Error('Hentikan sinkron toko ini dulu sebelum menghapus koneksinya.');
    withScriptLock_(function() { spSheet_('SP_Shops').deleteRow(s.row); PropertiesService.getScriptProperties().deleteProperty(spTokKey_(s.env, s.id)); });
    auditChange_('shopee-remove', 'SP_Shops', s.env + ':' + s.id, { status: s.status, store: s.storeCode, name: s.name }, null);
    return { ok: true, message: 'Koneksi ' + s.name + ' dihapus. Pesanan yang sudah ditarik tetap tersimpan.' };
  }
  if (p.approve === true) f.status = 'AKTIF';
  if (p.disconnect === true) f.status = 'DIPUTUS';
  withScriptLock_(function() { spSetShop_(s.row, f); });
  auditChange_('shopee-update', 'SP_Shops', s.env + ':' + s.id, { status: s.status, store: s.storeCode }, f);
  if (f.store_code !== undefined && typeof plMarkDirty_ === 'function') plMarkDirty_('');
  return { ok: true, message: 'Koneksi ' + s.name + ' diperbarui.' };
}
function spSyncNow_(p) {
  p = p || {};
  const end = p.endDate || plToday_(), start = p.startDate || finAddDays_(end, -7);
  return syncShopee(start, end, p.shopKey || '');
}
