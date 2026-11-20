/**
 * Tahap 2 halaman Pesanan (TikTok): Atur pengiriman (Ship Package) & Cetak resi (Shipping Document).
 * Endpoint & nama field dicocokkan dengan SDK resmi TikTok Shop 202309:
 *   GET  /order/202309/orders?ids=…                                   → packages[].id, shipping_type, delivery_option_name
 *   GET  /fulfillment/202309/packages/{package_id}/handover_time_slots → can_pickup, can_drop_off, pickup_slots[{start_time,end_time,avaliable}], drop_off_point_url
 *   POST /fulfillment/202309/packages/{package_id}/ship               → body {handover_method: PICKUP|DROP_OFF, pickup_slot:{start_time,end_time}}
 *   GET  /fulfillment/202309/packages/{package_id}/shipping_documents → query document_type, document_size (A6|A5) → {doc_url (berlaku 24 jam), tracking_number}
 * "Atur pengiriman" MENGUBAH status pesanan di TikTok → wajib konfirmasi KIRIM dan dicatat di Fulfill_Log.
 */
const FULFILL_LOG_HEADERS_ = ['Waktu', 'Oleh', 'Toko', 'Order ID', 'Package ID', 'Aksi', 'Hasil', 'Pesan'];

function fulfillLog_(row) {
  try {
    const ss = getDatabase_(), sh = ss.getSheetByName('Fulfill_Log') || ss.insertSheet('Fulfill_Log');
    if (!sh.getLastRow()) sh.appendRow(FULFILL_LOG_HEADERS_);
    sh.appendRow(row);
  } catch (e) { /* log gagal tidak membatalkan aksi yang sudah terkirim */ }
}

/** Cari toko & token dari data pesanan yang sudah tersinkron. Mengecek hak akses toko pengguna. */
function fulfillCtx_(orderId) {
  const id = String(orderId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('Nomor pesanan tidak valid.');
  const row = plSheetRows_('TTS_Orders', 23).find(function(r) { return String(r[3]) === id; });
  if (!row) throw new Error('Pesanan #' + id + ' belum ada di data. Klik "Muat terbaru" dulu.');
  const code = String(row[2] || '').toUpperCase(), scope = allowedStoreList_();
  if (scope && scope.indexOf(code) < 0) throw new Error('Anda tidak punya akses ke toko ' + code + '.');
  const shop = ttsShops_().find(function(s) { return s.id === String(row[1]); });
  const auth = shop && ttsGetAuth_(shop.openId);
  if (!shop || !auth) throw new Error('Toko ' + code + ' belum terhubung / tokennya hilang. Hubungkan ulang di Koneksi Toko.');
  return { id: id, code: code, status: String(row[7]), shop: shop, tok: { cipher: shop.cipher, accessToken: auth.access_token } };
}

function fulfillTime_(sec) { return sec ? Utilities.formatDate(new Date(Number(sec) * 1000), 'Asia/Jakarta', 'dd/MM HH:mm') : ''; }

function fulfillScopeHint_(e) {
  const m = String(e && e.message || e);
  return /scope|permission|unauthori|access denied|not authorized/i.test(m)
    ? m + ' — Pastikan izin Fulfillment sudah aktif di Partner Center, lalu klik "Hubungkan Toko TikTok" ulang untuk toko ini.' : m;
}

/** Detail pesanan dari TikTok (paket, jenis pengiriman). Hanya membaca. */
function fulfillOrderDetail_(c) {
  const d = ttsRequest(c.tok, 'GET', '/order/202309/orders', { ids: c.id }, null);
  const o = (d.orders || [])[0];
  if (!o) throw new Error('Pesanan #' + c.id + ' tidak ditemukan di TikTok.');
  return { status: o.status || '', shippingType: o.shipping_type || '', delivery: o.delivery_option_name || '',
    packages: (o.packages || []).map(function(p) { return String(p.id); }).filter(String) };
}

/** Info untuk dialog "Atur pengiriman": paket, pilihan pickup/drop-off, slot jemput. Hanya membaca. */
function ordShipInfo_(p) {
  const c = fulfillCtx_(p && p.orderId);
  try {
    const d = fulfillOrderDetail_(c);
    const out = { orderId: c.id, store: c.code, status: d.status, shippingType: d.shippingType, delivery: d.delivery, packages: d.packages,
      canPickup: false, canDropOff: false, slots: [], dropOffUrl: '' };
    if (d.shippingType && d.shippingType !== 'TIKTOK') { out.note = 'Pesanan ini memakai pengiriman sendiri (bukan logistik TikTok) — atur & cetak resi dari Seller Center.'; return out; }
    if (!d.packages.length) { out.note = 'TikTok belum membuat paket untuk pesanan ini. Coba lagi beberapa menit lagi.'; return out; }
    const t = ttsRequest(c.tok, 'GET', '/fulfillment/202309/packages/' + encodeURIComponent(d.packages[0]) + '/handover_time_slots', {}, null);
    out.canPickup = t.can_pickup === true; out.canDropOff = t.can_drop_off === true; out.dropOffUrl = t.drop_off_point_url || '';
    out.slots = (t.pickup_slots || []).filter(function(s) { return s.avaliable !== false; })   // 'avaliable' = ejaan asli TikTok
      .map(function(s) { return { start: Number(s.start_time), end: Number(s.end_time), label: fulfillTime_(s.start_time) + '–' + fulfillTime_(s.end_time).slice(-5) }; });
    return out;
  } catch (e) { throw new Error(fulfillScopeHint_(e)); }
}

/** Atur pengiriman (MENGUBAH status di TikTok). p: {orderId, method:'PICKUP'|'DROP_OFF', slotStart, slotEnd, confirm:'KIRIM'} */
function ordShip_(p) {
  p = p || {};
  if (String(p.confirm || '') !== 'KIRIM') throw new Error('Konfirmasi dibutuhkan sebelum mengatur pengiriman.');
  const method = String(p.method || '').toUpperCase();
  if (method !== 'PICKUP' && method !== 'DROP_OFF') throw new Error('Pilih Pickup (dijemput kurir) atau Drop-off (antar sendiri).');
  const c = fulfillCtx_(p.orderId), actor = currentActorEmail_();
  const out = { orderId: c.id, results: [] };
  let d;
  try { d = fulfillOrderDetail_(c); } catch (e) { throw new Error(fulfillScopeHint_(e)); }
  if (['AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING'].indexOf(d.status) < 0) throw new Error('Status pesanan di TikTok sekarang ' + d.status + ' — tidak perlu diatur lagi.');
  if (d.shippingType && d.shippingType !== 'TIKTOK') throw new Error('Pesanan ini memakai pengiriman sendiri — atur dari Seller Center.');
  if (!d.packages.length) throw new Error('TikTok belum membuat paket untuk pesanan ini.');
  const body = { handover_method: method };
  if (method === 'PICKUP' && Number(p.slotStart) && Number(p.slotEnd)) body.pickup_slot = { start_time: Number(p.slotStart), end_time: Number(p.slotEnd) };
  d.packages.forEach(function(pkg) {
    let result = 'GAGAL', msg = '';
    try {
      ttsRequest(c.tok, 'POST', '/fulfillment/202309/packages/' + encodeURIComponent(pkg) + '/ship', {}, body);
      result = 'BERHASIL'; msg = method === 'PICKUP' ? 'Dijadwalkan dijemput kurir' + (body.pickup_slot ? ' ' + fulfillTime_(body.pickup_slot.start_time) : '') : 'Drop-off ke agen';
    } catch (e) { msg = fulfillScopeHint_(e); }
    out.results.push({ packageId: pkg, result: result, message: msg });
    fulfillLog_([new Date(), actor, c.code, c.id, pkg, 'ATUR_KIRIM ' + method, result, String(msg).slice(0, 500)]);
  });
  PropertiesService.getScriptProperties().setProperty('ORDERS_LAST_PULL', '0');   // tarikan berikutnya langsung ambil status baru
  out.ok = out.results.some(function(r) { return r.result === 'BERHASIL'; });
  return out;
}

/** Link PDF resi (berlaku 24 jam dari TikTok). p: {orderIds:[…] maks 20, type, size}. Tidak mengubah status. */
function ordLabel_(p) {
  p = p || {};
  const type = ['SHIPPING_LABEL', 'SHIPPING_LABEL_AND_PACKING_SLIP', 'PACKING_SLIP'].indexOf(p.type) >= 0 ? p.type : 'SHIPPING_LABEL';
  const size = p.size === 'A5' ? 'A5' : 'A6';
  const ids = (Array.isArray(p.orderIds) ? p.orderIds : [p.orderId]).map(String).filter(String).slice(0, 20);
  if (!ids.length) throw new Error('Pilih pesanan yang mau dicetak resinya.');
  const deadline = Date.now() + 240000, out = [];
  ids.forEach(function(id) {
    if (Date.now() > deadline) { out.push({ orderId: id, ok: false, message: 'Waktu habis — cetak sisanya lagi.' }); return; }
    try {
      const c = fulfillCtx_(id), d = fulfillOrderDetail_(c);
      if (!d.packages.length) throw new Error('Paket belum dibuat TikTok.');
      d.packages.forEach(function(pkg) {
        try {
          const r = ttsRequest(c.tok, 'GET', '/fulfillment/202309/packages/' + encodeURIComponent(pkg) + '/shipping_documents', { document_type: type, document_size: size }, null);
          if (!r.doc_url) throw new Error('TikTok belum memberi file resi. Pastikan pesanan sudah "Atur pengiriman".');
          out.push({ orderId: id, store: c.code, packageId: pkg, ok: true, url: r.doc_url, tracking: r.tracking_number || '' });
        } catch (e) { out.push({ orderId: id, store: c.code, packageId: pkg, ok: false, message: fulfillScopeHint_(e) }); }
      });
    } catch (e) { out.push({ orderId: id, ok: false, message: fulfillScopeHint_(e) }); }
  });
  return { type: type, size: size, docs: out };
}
