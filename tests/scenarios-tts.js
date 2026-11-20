console.log('\n=== TAHAP 6: TikTok Shop API (server tiruan) ===');
const nodeCrypto = require('crypto');
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
__env.props.TTS_APP_KEY = '6lru51tcmrdi1';
__env.props.TTS_APP_SECRET = 'rahasia-uji-123';
__env.props.TTS_AUTH_URL = 'https://services.tiktokshop.com/open/authorize?service_id=999';

// Rumus tanda tangan independen (ditulis ulang dari SDK resmi) untuk memverifikasi permintaan.
function refSign(path, qs, body, secret) {
  const base = path + Object.keys(qs).filter(k => k !== 'sign' && k !== 'access_token').sort().map(k => k + qs[k]).join('') + (body || '');
  return nodeCrypto.createHmac('sha256', secret).update(secret + base + secret).digest('hex');
}
const now = Math.floor(Date.now() / 1000);
const fake = { calls: [], tokenFor: { AT1: 'OPEN1', AT2: 'OPEN1' }, fail429Once: true, refreshCount: 0 };
function respond(code, obj) { return { getResponseCode: () => code, getContentText: () => JSON.stringify(obj) }; }
__env.fetchHandler = (url, opt) => {
  const u = new URL(url), qs = Object.fromEntries(u.searchParams.entries()), path = u.pathname;
  fake.calls.push({ path, qs, body: opt.payload || '' });
  if (u.host === 'auth.tiktok-shops.com') {
    if (qs.app_secret !== 'rahasia-uji-123') return respond(200, { code: 36004004, message: 'invalid app_secret' });
    if (path === '/api/v2/token/get') return qs.auth_code === 'GOOD' && qs.grant_type === 'authorized_code'
      ? respond(200, { code: 0, message: 'success', data: { access_token: 'AT1', access_token_expire_in: now + 7 * 86400, refresh_token: 'RT1', refresh_token_expire_in: now + 30 * 86400, open_id: 'OPEN1', seller_name: 'Petani Kota TT', seller_base_region: 'ID' } })
      : respond(200, { code: 36004009, message: 'auth code is invalid or expired' });
    if (path === '/api/v2/token/refresh') { fake.refreshCount++; return qs.grant_type === 'refresh_token' && qs.refresh_token === 'RT1'
      ? respond(200, { code: 0, data: { access_token: 'AT2', access_token_expire_in: now + 7 * 86400, refresh_token: 'RT1', refresh_token_expire_in: now + 30 * 86400 } })
      : respond(200, { code: 36004010, message: 'refresh token invalid' }); }
  }
  // Open API: verifikasi tanda tangan, token, dan cipher
  if (qs.sign !== refSign(path, qs, opt.payload || '', 'rahasia-uji-123')) return respond(200, { code: 106001, message: 'Invalid sign' });
  if (!fake.tokenFor[opt.headers['x-tts-access-token']]) return respond(200, { code: 105002, message: 'access_token is expired' });
  if (path === '/authorization/202309/shops') return respond(200, { code: 0, data: { shops: [{ id: '7001', name: 'TikTok Petani Kota', code: 'IDLC1', cipher: 'CIPH1', region: 'ID', seller_type: 'LOCAL' }] } });
  if (qs.shop_cipher !== 'CIPH1') return respond(200, { code: 106011, message: 'shop_cipher invalid' });
  const body = opt.payload ? JSON.parse(opt.payload) : {};
  if (path === '/order/202309/orders/search') {
    if (!qs.page_token) return respond(200, { code: 0, data: { next_page_token: 'P2', total_count: 3, orders: [
      { id: 'O1', status: 'COMPLETED', create_time: body.create_time_ge + 3600, update_time: body.create_time_ge + 7200,
        payment: { currency: 'IDR', original_total_product_price: '60000', seller_discount: '5000', platform_discount: '5000', sub_total: '50000', shipping_fee: '9000', total_amount: '59000' },
        line_items: [{ id: 'L1', sku_id: 'K1', seller_sku: 'PB-35', product_name: 'Polybag 35x35', sale_price: '25000', original_price: '30000' }, { id: 'L2', sku_id: 'K1', seller_sku: 'PB-35', product_name: 'Polybag 35x35', sale_price: '25000', original_price: '30000' }] }] } });
    return respond(200, { code: 0, data: { next_page_token: '', total_count: 3, orders: [
      { id: 'O2', status: 'CANCELLED', create_time: body.create_time_ge + 4000, payment: { currency: 'IDR', sub_total: '40000', total_amount: '40000' }, line_items: [{ id: 'L3', seller_sku: 'PN-1', product_name: 'Paranet', sale_price: '40000' }] },
      { id: 'O3', status: 'AWAITING_SHIPMENT', create_time: body.create_time_ge + 5000, payment: { currency: 'IDR', sub_total: '20000' }, line_items: [{ id: 'L4', seller_sku: 'MT-1', product_name: 'Media tanam', sale_price: '20000' }] }] } });
  }
  if (path === '/product/202309/products/search') {
    if (fake.fail429Once) { fake.fail429Once = false; return respond(429, { code: 0, message: 'Too many requests' }); }
    return respond(200, { code: 0, data: { products: [{ id: 'PR1', title: 'Polybag 35x35', status: 'ACTIVATE', skus: [{ id: 'K1', seller_sku: 'PB-35', price: { currency: 'IDR', sale_price: '25000' }, inventory: [{ quantity: 10, warehouse_id: 'W1' }, { quantity: 5, warehouse_id: 'W2' }] }, { id: 'K2', seller_sku: 'PB-40', price: { currency: 'IDR', sale_price: '30000' }, inventory: [] }] }] } });
  }
  if (path === '/finance/202309/statements') return respond(200, { code: 0, data: { statements: [{ id: 'ST1', statement_time: now - 86400, currency: 'IDR', revenue_amount: '50000', fee_amount: '-4000', settlement_amount: '46000', payment_status: 'PAID' }] } });
  if (path === '/finance/202501/statements/ST1/statement_transactions') return respond(200, { code: 0, data: { transactions: [{ id: 'TX1', type: 'ORDER', order_id: 'O1', revenue_amount: '50000', fee_tax_amount: '-4000', settlement_amount: '46000', fee_tax_breakdown: { fee: { platform_commission_amount: '-3000', transaction_fee_amount: '-1000' } } }] } });
  if (path === '/return_refund/202309/returns/search') return respond(200, { code: 0, data: { return_orders: [{ return_id: 'R1', order_id: 'O1', return_type: 'REFUND', return_status: 'RETURN_OR_REFUND_REQUEST_PENDING', refund_amount: { currency: 'IDR', refund_total: '25000' } }] } });
  if (path === '/promotion/202309/activities/search') {
    if (qs.page_token || qs.page_size) return respond(200, { code: 40001, message: 'page params must be in body' });
    return body.page_token ? respond(200, { code: 0, data: { activities: [{ id: 'A2', title: 'Flash 12.12', status: 'NOT_START' }] } })
      : respond(200, { code: 0, data: { next_page_token: 'AP2', activities: [{ id: 'A1', title: 'Diskon 11.11', activity_type: 'FIXED_PRICE', status: 'ONGOING' }] } });
  }
  return respond(404, { code: 404, message: 'not found ' + path });
};
const sheetText = () => Object.keys(S).map(n => JSON.stringify(S[n].data)).join('\n');

console.log('\n25. Tanda tangan');
const sigQ = { app_key: '6lru51tcmrdi1', timestamp: '1700000000', shop_cipher: 'C', page_size: '50', access_token: 'X', sign: 'Y' };
ok('ttsSign_ sama dengan rumus SDK (urut, tanpa sign & access_token, path+body, bungkus secret)',
  ttsSign_('/order/202309/orders/search', sigQ, '{"a":1}', 'rahasia-uji-123') === refSign('/order/202309/orders/search', sigQ, '{"a":1}', 'rahasia-uji-123'));

console.log('\n26. Callback otorisasi & routing doGet');
const link = ttsAuthUrl_();
const stA = new URL(link.url).searchParams.get('state');
ok('link otorisasi memuat service_id & state tts_', /service_id=999/.test(link.url) && /^tts_/.test(stA), link.url);
ok('doGet tanpa parameter → aplikasi', doGet({ parameter: {} }).file === 'index');
const bad = doGet({ parameter: { code: 'BAD', state: stA } });
ok('kode salah → halaman error yang jelas', /Belum berhasil/.test(bad.content) && /auth code is invalid/.test(bad.content));
const st2 = new URL(ttsAuthUrl_().url).searchParams.get('state');
const good = doGet({ parameter: { code: 'GOOD', state: st2 } });
ok('kode benar → "Toko ... berhasil terhubung"', /TikTok Petani Kota berhasil terhubung/.test(good.content), good.content.replace(/<[^>]+>/g, ' ').slice(0, 160));
let shopsNow = ttsGetConnections_().shops;
ok('toko tersimpan AKTIF, cipher tercatat, belum dipetakan', shopsNow.length === 1 && shopsNow[0].status === 'AKTIF' && rowsOf('TTS_Tokens')[0][3] === 'CIPH1' && shopsNow[0].storeCode === '');
ok('token TIDAK ada di sheet mana pun (hanya di Script Properties)', !/AT1|RT1|rahasia-uji/.test(sheetText()) && /AT1/.test(__env.props.TTS_AUTH_OPEN1));
ok('respons ke browser tanpa token', !/AT1|RT1/.test(JSON.stringify(ttsGetConnections_())));
doGet({ parameter: { code: 'GOOD', state: st2 } });
ok('hubungkan ulang toko yang sama tidak menggandakan baris', rowsOf('TTS_Tokens').length === 1);
const teamState = 'a'.repeat(64);
let routedToTeam = false; const origTeam = teamGoogleCallback_; teamGoogleCallback_ = () => { routedToTeam = true; return { content: 'team' }; };
doGet({ parameter: { code: 'G-OAUTH', state: teamState } });
teamGoogleCallback_ = origTeam;
ok('callback login tim (state 64 hex) tetap ke login tim, bukan TikTok', routedToTeam);

console.log('\n27. Pemetaan ke Master Toko');
throws('tidak bisa dipetakan ke toko Shopee', () => ttsUpdateShop_({ shopId: '7001', storeCode: 'S1' }), /bukan platform TikTok/);
ttsUpdateShop_({ shopId: '7001', storeCode: 'TT1' });
ok('dipetakan ke TT1', ttsGetConnections_().shops[0].storeCode === 'TT1');

console.log('\n28. Sinkron: pagination, retry 429, upsert, data kosong');
const excelShopRows = rowsOf('ShopAnalytics').length, excelFinRows = rowsOf('FinSales').length;
const r1 = syncTikTokShop('2026-11-10', '2026-11-16');
ok('sinkron BERHASIL', r1.shops[0].status === 'BERHASIL', r1.message);
ok('halaman ke-2 pesanan diambil (3 pesanan, 4 item)', rowsOf('TTS_Orders').length === 3 && rowsOf('TTS_OrderLines').length === 4);
ok('retry setelah 429 berhasil (produk 2 SKU)', rowsOf('TTS_Products').length === 2 && fake.calls.filter(c => c.path === '/product/202309/products/search').length === 2);
ok('stok = jumlah semua gudang (15); tanpa data gudang → kosong', rowsOf('TTS_Products').find(r => r[4] === 'K1')[11] === 15 && rowsOf('TTS_Products').find(r => r[4] === 'K2')[11] === '');
const o3 = rowsOf('TTS_Orders').find(r => r[3] === 'O3');
ok('ongkir/total tidak ada di API → kosong, bukan 0', o3[13] === '' && o3[18] === '', [o3[13], o3[18]]);
ok('ongkir hanya di level pesanan (O1 = 9.000, sekali)', rowsOf('TTS_Orders').find(r => r[3] === 'O1')[13] === 9000);
ok('keuangan: statement + transaksi per pesanan', rowsOf('TTS_Statements').length === 1 && rowsOf('TTS_Finance')[0][6] === 'O1' && rowsOf('TTS_Finance')[0][11] === -3000);
ok('retur & promosi (page_token di body, 2 halaman)', rowsOf('TTS_Returns').length === 1 && rowsOf('TTS_Promotions').length === 2);
const sizes = ['TTS_Orders', 'TTS_OrderLines', 'TTS_Products', 'TTS_Statements', 'TTS_Finance', 'TTS_Returns', 'TTS_Promotions'].map(n => rowsOf(n).length);
syncTikTokShop('2026-11-10', '2026-11-16');
ok('sinkron ulang tidak menggandakan baris mana pun', JSON.stringify(sizes) === JSON.stringify(['TTS_Orders', 'TTS_OrderLines', 'TTS_Products', 'TTS_Statements', 'TTS_Finance', 'TTS_Returns', 'TTS_Promotions'].map(n => rowsOf(n).length)), sizes);
ok('data impor Excel tidak tersentuh', rowsOf('ShopAnalytics').length === excelShopRows && rowsOf('FinSales').length === excelFinRows);
ok('waktu sinkron & status tercatat', /BERHASIL/.test(ttsGetConnections_().shops[0].lastSyncStatus) && !!ttsGetConnections_().shops[0].lastSyncAt);
ok('rentang tanggal dikirim sebagai WIB (10 Nov 00:00 WIB)', fake.calls.find(c => c.path === '/order/202309/orders/search').body.indexOf(String(Date.parse('2026-11-10T00:00:00+07:00') / 1000)) > 0);

console.log('\n29. Dashboard sumber TikTok Shop API');
const dd = getSelectedDashboardData_({ dashboardSource: 'tts', storeCode: 'TT1' });
const gT = dd.groups.find(x => x.currency === 'IDR');
ok('nilai pesanan = sub_total pesanan bukan batal (50.000 + 20.000)', gT && gT.revenue === 70000 && gT.orders === 2, gT);
ok('catatan menyebut 1 pesanan dikecualikan & definisi', /1 pesanan dikecualikan/.test(dd.note) && /tanpa ongkir/.test(dd.note));

console.log('\n30. Refresh token');
ok('belum perlu refresh (>24 jam) → dilewati', refreshAllTikTokTokens(false).skipped === 1 && fake.refreshCount === 0);
const a0 = JSON.parse(__env.props.TTS_AUTH_OPEN1); a0.access_expire_at = now + 3600; __env.props.TTS_AUTH_OPEN1 = JSON.stringify(a0);
const rr = refreshAllTikTokTokens(false);
ok('kedaluwarsa < 24 jam → diperbarui (grant_type=refresh_token)', rr.refreshed === 1 && JSON.parse(__env.props.TTS_AUTH_OPEN1).access_token === 'AT2');
fake.tokenFor = { AT2: 'OPEN1' };
ok('sinkron memakai token baru', syncTikTokShop('2026-11-16', '2026-11-16').shops[0].status === 'BERHASIL');
ok('setupTikTokTriggers memasang 2 trigger, aman dijalankan ulang', (setupTikTokTriggers(), setupTikTokTriggers(), ScriptApp.getProjectTriggers().length === 2));

console.log('\n31. Toko tanpa state & batas akses');
fake.tokenFor = { AT1: 'OPEN1', AT2: 'OPEN1' };
const ss2 = new URL(ttsAuthUrl_().url).searchParams.get('state');
CacheService.getScriptCache().remove('tts:state:' + ss2);
S.TTS_Tokens.data.splice(1); // simulasi toko baru: hapus baris lalu otorisasi tanpa state valid
doGet({ parameter: { code: 'GOOD' } });
ok('otorisasi dari sisi TikTok (tanpa state) → MENUNGGU PERSETUJUAN', ttsGetConnections_().shops[0].status === 'MENUNGGU PERSETUJUAN');
ttsUpdateShop_({ shopId: '7001', storeCode: 'TT1' });
ok('belum disetujui → tidak disinkron', /MENUNGGU/.test(syncTikTokShop('2026-11-16', '2026-11-16').shops[0].skipped));
ttsUpdateShop_({ shopId: '7001', approve: true });
ok('setelah disetujui Owner → AKTIF', ttsGetConnections_().shops[0].status === 'AKTIF');
as('admin', 'adm@gmail.com'); __env.props.TEAM_STORE_SCOPE_JSON = JSON.stringify({ 'adm@gmail.com': ['S1'] });
throws('admin S1 ditolak dashboard TikTok toko TT1', () => getSelectedDashboardData_({ dashboardSource: 'tts', storeCode: 'TT1' }), /tidak ditugaskan/);
ok('admin S1 "semua toko" tidak melihat pesanan TT1', getSelectedDashboardData_({ dashboardSource: 'tts' }).groups.length === 0);
throws('admin ditolak membuka Koneksi Toko', () => ttsGetConnections_(), /Owner atau Keuangan/);
TEAM_REQUEST_CONTEXT_ = null;
__env.props.TEAM_MEMBERS_JSON = JSON.stringify({ 'owner@gmail.com': 'owner', 'adm@gmail.com': 'admin', 'uang@gmail.com': 'finance' }); // batas tim maks. 5 orang
const vw2 = sessionFor('baca2@gmail.com', 'viewer');
throws('Pembaca ditolak sinkron lewat teamRpc', () => teamRpc(vw2, 'ttsSyncNow', [{}]), /tidak diizinkan/);
throws('Keuangan ditolak membuat link otorisasi', () => teamRpc(fin, 'ttsGetAuthUrl', []), /tidak diizinkan/);
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };

console.log('\n32. Pesan error mudah dipahami');
fake.tokenFor = {};
const rx = syncTikTokShop('2026-11-16', '2026-11-16');
ok('token tidak berlaku → penjelasan "Token akses tidak berlaku"', /Token akses tidak berlaku/.test(JSON.stringify(rx)), rx.shops[0].errors && rx.shops[0].errors[0]);
__env.props.TTS_APP_SECRET = 'salah';
throws('secret salah → penjelasan sign', () => ttsRequest({ cipher: 'CIPH1', accessToken: 'AT2' }, 'GET', '/finance/202309/statements', {}, null), /sign\) ditolak/);
__env.props.TTS_APP_SECRET = 'rahasia-uji-123';


