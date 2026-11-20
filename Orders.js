/**
 * Halaman Pesanan: daftar pesanan TikTok & Shopee (Live) per status, untuk tim gudang/admin.
 * Tahap 1 hanya MEMBACA (tidak mengubah status di marketplace).
 * ordersRefresh_ menarik pesanan terbaru dari TikTok paling sering 1x per 90 detik untuk semua pengguna (hemat kuota).
 */
const ORDER_GROUPS = {
  belumbayar: { label: 'Belum dibayar', tts: ['UNPAID', 'ON_HOLD'], sp: ['UNPAID'] },
  kirim: { label: 'Perlu dikirim', tts: ['AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING'], sp: ['READY_TO_SHIP', 'RETRY_SHIP'] },
  ambil: { label: 'Menunggu kurir', tts: ['AWAITING_COLLECTION'], sp: ['PROCESSED'] },
  dikirim: { label: 'Dalam pengiriman', tts: ['IN_TRANSIT'], sp: ['SHIPPED'] },
  sampai: { label: 'Sudah sampai', tts: ['DELIVERED'], sp: ['TO_CONFIRM_RECEIVE'] },
  selesai: { label: 'Selesai', tts: ['COMPLETED'], sp: ['COMPLETED'] },
  batal: { label: 'Batal / retur', tts: ['CANCELLED'], sp: ['CANCELLED', 'IN_CANCEL', 'TO_RETURN'] }
};
function orderGroupOf_(platform, status) {
  const k = Object.keys(ORDER_GROUPS).find(function(g) { return ORDER_GROUPS[g][platform].indexOf(status) >= 0; });
  return k || 'lainnya';
}

/** Daftar pesanan. p: {group, storeCode, q, days} */
function ordersList_(p) {
  p = p || {};
  const scope = allowedStoreList_(), allowed = function(c) { return !scope || scope.indexOf(String(c).toUpperCase()) >= 0; };
  const want = String(p.storeCode || '').toUpperCase(), q = String(p.q || '').trim().toLowerCase();
  const days = Math.max(1, Math.min(60, Number(p.days) || 14));
  const since = Utilities.formatDate(new Date(Date.now() - days * 86400000), 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
  const group = ORDER_GROUPS[p.group] ? p.group : 'kirim';
  const db = getDatabase_(), all = [], counts = {};
  Object.keys(ORDER_GROUPS).forEach(function(g) { counts[g] = 0; });
  // TikTok
  if (db.getSheetByName('TTS_Orders')) {
    const items = {};
    plSheetRows_('TTS_OrderLines', 20).forEach(function(r) {
      const k = String(r[2]).toUpperCase() + '|' + r[3], name = String(r[11] || '').slice(0, 70) + (r[12] ? ' — ' + r[12] : '');
      const m = items[k] || (items[k] = {}); m[name] = (m[name] || 0) + 1;
    });
    plSheetRows_('TTS_Orders', 23).forEach(function(r) {
      const code = String(r[2] || '').toUpperCase(), created = stockStamp_(r[4]);
      if (!code || !allowed(code) || created < since || (want && code !== want)) return;
      const g = orderGroupOf_('tts', String(r[7])); if (counts[g] !== undefined) counts[g]++;
      const its = items[code + '|' + r[3]] || {};
      all.push({ platform: 'TikTok', store: code, id: String(r[3]), created: created, paid: stockStamp_(r[6]), status: String(r[7]), group: g,
        total: numOrNull_(r[18]) !== null ? numOrNull_(r[18]) : numOrNull_(r[12]), cod: r[21] === true || String(r[21]) === 'true',
        items: Object.keys(its).map(function(n) { return { name: n, qty: its[n] }; }) });
    });
  }
  // Shopee (hanya LIVE)
  if (db.getSheetByName('SP_Orders')) {
    const spMap = {}; spShops_().forEach(function(s) { if (s.env === 'live' && s.storeCode) spMap[s.id] = s.storeCode.toUpperCase(); });
    const items = {};
    if (db.getSheetByName('SP_OrderLines')) plSheetRows_('SP_OrderLines', 18).forEach(function(r) {
      if (String(r[0]).indexOf('live|') !== 0) return;
      const k = r[1] + '|' + r[3], name = String(r[11] || '').slice(0, 70) + (r[12] ? ' — ' + r[12] : '');
      const m = items[k] || (items[k] = {}); m[name] = (m[name] || 0) + (numOrNull_(r[13]) || 1);
    });
    plSheetRows_('SP_Orders', 14).forEach(function(r) {
      if (String(r[12]) !== 'live') return;
      const code = spMap[String(r[1])] || '', created = stockStamp_(r[4]);
      if (!code || !allowed(code) || created < since || (want && code !== want)) return;
      const g = orderGroupOf_('sp', String(r[7])); if (counts[g] !== undefined) counts[g]++;
      const its = items[r[1] + '|' + r[3]] || {};
      all.push({ platform: 'Shopee', store: code, id: String(r[3]), created: created, paid: stockStamp_(r[6]), status: String(r[7]), group: g,
        total: numOrNull_(r[9]), cod: /cod/i.test(String(r[11] || '')), items: Object.keys(its).map(function(n) { return { name: n, qty: its[n] }; }) });
    });
  }
  if (p.group === 'all') {   // semua status sekaligus → tab & pencarian diproses di browser (instan)
    const allRows = all.sort(function(a, b) { return b.created.localeCompare(a.created); }).slice(0, 2000);
    const pp = PropertiesService.getScriptProperties();
    return { group: 'all', days: days, counts: counts, groups: Object.keys(ORDER_GROUPS).map(function(g) { return { key: g, label: ORDER_GROUPS[g].label }; }),
      rows: allRows, lastPull: pp.getProperty('ORDERS_LAST_PULL_AT') || '', toShip: all.filter(function(o) { return o.group === 'kirim'; }).map(function(o) { return o.platform + '|' + o.id; }) };
  }
  const rows = all.filter(function(o) {
    if (o.group !== group) return false;
    return !q || (o.id + ' ' + o.store + ' ' + o.items.map(function(i) { return i.name; }).join(' ')).toLowerCase().indexOf(q) >= 0;
  }).sort(function(a, b) { return group === 'kirim' ? (a.paid || a.created).localeCompare(b.paid || b.created) : b.created.localeCompare(a.created); }).slice(0, 300);
  const props = PropertiesService.getScriptProperties();
  return { group: group, days: days, counts: counts, groups: Object.keys(ORDER_GROUPS).map(function(g) { return { key: g, label: ORDER_GROUPS[g].label }; }),
    rows: rows, lastPull: props.getProperty('ORDERS_LAST_PULL_AT') || '', toShip: all.filter(function(o) { return o.group === 'kirim'; }).map(function(o) { return o.platform + '|' + o.id; }) };
}

/** Tarik pesanan TikTok 3 hari terakhir (status ikut segar). Dibatasi 1x/90 detik untuk semua pengguna. */
function ordersRefresh_(p) {
  const props = PropertiesService.getScriptProperties(), last = Number(props.getProperty('ORDERS_LAST_PULL') || 0);
  let pulled = false, errors = [];
  if (Date.now() - last > 90000) {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(3000)) {
      try {
        props.setProperty('ORDERS_LAST_PULL', String(Date.now()));
        errors = ttsPullRecentUpdates_(3 * 86400);   // pesanan baru + perubahan status (dikirim → sampai → selesai)
        props.setProperty('ORDERS_LAST_PULL_AT', Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd/MM HH:mm'));
        pulled = true;
      } finally { lock.releaseLock(); }
    }
  }
  const r = ordersList_(p || {});
  r.pulled = pulled; r.errors = errors;
  return r;
}
