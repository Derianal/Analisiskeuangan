console.log('\n=== SHOPEE (server tiruan, mode UJI & LIVE) ===');
const cr = require('crypto');
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
Object.assign(__env.props, { SHOPEE_TEST_PARTNER_ID: '1001', SHOPEE_TEST_PARTNER_KEY: 'kunci-shp-uji', SHOPEE_LIVE_PARTNER_ID: '2002', SHOPEE_LIVE_PARTNER_KEY: 'kunci-shp-live', TEAM_APP_URL: 'https://script.google.com/macros/s/ABC/exec' });
finSaveStore_({ code: 'SPX', name: 'Shopee Uji', platform: 'Shopee', branch: 'Pusat' });
const KEYS = { 1001: 'kunci-shp-uji', 2002: 'kunci-shp-live' };
const sp = { calls: [], refreshes: 0, tokens: {} };
const resp = (code, o) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(o) });
const prevHandler = __env.fetchHandler;
__env.fetchHandler = (url, opt) => {
  const u = new URL(url);
  if (!/shopeemobile|shopee\.sg/.test(u.host)) return prevHandler(url, opt);
  const q = Object.fromEntries(u.searchParams.entries()), path = u.pathname, pid = q.partner_id, key = KEYS[pid];
  sp.calls.push({ host: u.host, path, q, body: opt.payload ? JSON.parse(opt.payload) : null });
  const expectHost = pid === '1001' ? 'openplatform.sandbox.test-stable.shopee.sg' : 'partner.shopeemobile.com';
  if (u.host !== expectHost) return resp(200, { error: 'error_param', message: 'kunci dan server tidak cocok' });
  const base = pid + path + q.timestamp + (q.access_token ? q.access_token + q.shop_id : '');
  if (q.sign !== cr.createHmac('sha256', key).update(base).digest('hex')) return resp(200, { error: 'error_sign', message: 'Wrong sign.' });
  const body = opt.payload ? JSON.parse(opt.payload) : {};
  if (path === '/api/v2/auth/token/get') { const t = 'AT-' + pid + '-' + body.shop_id; sp.tokens[t] = true; return resp(200, { error: '', access_token: t, refresh_token: 'RT-' + body.shop_id, expire_in: 14400 }); }
  if (path === '/api/v2/auth/access_token/get') { sp.refreshes++; const t = 'AT2-' + pid + '-' + body.shop_id; sp.tokens[t] = true; return resp(200, { error: '', access_token: t, refresh_token: 'RT2', expire_in: 14400 }); }
  if (!sp.tokens[q.access_token]) return resp(200, { error: 'invalid_access_token', message: 'Invalid access_token.' });
  if (path === '/api/v2/shop/get_shop_info') return resp(200, { error: '', response: undefined, shop_name: 'Toko Shopee ' + q.shop_id, region: 'ID' });
  if (path === '/api/v2/order/get_order_list') {
    const t0 = Number(q.time_from);
    if (Number(q.time_to) - t0 > 15 * 86400) return resp(200, { error: 'error_param', message: 'time range too long' });
    if (!q.cursor) return resp(200, { error: '', response: { more: true, next_cursor: 'c2', order_list: [{ order_sn: 'S' + t0 + 'A' }] } });
    return resp(200, { error: '', response: { more: false, order_list: [{ order_sn: 'S' + t0 + 'B' }, { order_sn: 'S' + t0 + 'C' }] } });
  }
  if (path === '/api/v2/order/get_order_detail') {
    const list = String(q.order_sn_list).split(',').map(sn => { const t0 = Number(sn.slice(1, -1)), kind = sn.slice(-1);
      return { order_sn: sn, order_status: kind === 'A' ? 'COMPLETED' : kind === 'B' ? 'CANCELLED' : 'READY_TO_SHIP', create_time: t0 + 3600, update_time: t0 + 7200, currency: 'IDR', total_amount: 59000,
        item_list: [{ item_id: 11, model_id: 22, item_sku: 'PB', model_sku: 'PB-1', item_name: 'Polybag', model_name: '35x35', model_quantity_purchased: 2, model_original_price: 30000, model_discounted_price: 25000 }] }; });
    return resp(200, { error: '', response: { order_list: list } });
  }
  if (path === '/api/v2/payment/get_escrow_detail') return resp(200, { error: '', response: { order_sn: q.order_sn, order_income: { escrow_amount: 41500, commission_fee: 3000, service_fee: 1000, seller_transaction_fee: 0, final_shipping_fee: -2000, withholding_tax: 500, seller_return_refund: 0 } } });
  return resp(404, { error: 'not_found', message: path });
};

console.log('\n49. Otorisasi mode UJI');
const link = spAuthUrl_({ env: 'test' }), st = new URL(link.url).searchParams.get('state');
ok('link uji ke server otorisasi sandbox dengan partner_id uji & state shp_test_', /open\.sandbox\.test-stable\.shopee\.com\/auth/.test(link.url) && /partner_id=1001/.test(link.url) && /^shp_test_/.test(st), link.url);
const cb = doGet({ parameter: { code: 'K1', shop_id: '555', state: st } });
ok('callback Shopee (bukan TikTok) → "berhasil terhubung" mode UJI', /Toko Shopee 555 \(UJI \(sandbox\)\) berhasil terhubung/.test(cb.content), cb.content.replace(/<[^>]+>/g, ' ').slice(0, 150));
ok('tanda tangan auth/token/get benar & body memuat partner_id uji', sp.calls.some(c => c.path === '/api/v2/auth/token/get' && c.body.partner_id === 1001 && c.body.shop_id === 555));
ok('token hanya di Script Properties, tidak di sheet', !/AT-1001/.test(JSON.stringify(S.SP_Shops.data)) && /AT-1001-555/.test(__env.props.SP_AUTH_TEST_555));
doGet({ parameter: { code: 'K2', shop_id: '556' } });
ok('callback tanpa state → MENUNGGU PERSETUJUAN', spGetConnections_().shops.find(s => s.id === '556').status === 'MENUNGGU PERSETUJUAN');

console.log('\n50. Sinkron mode UJI tidak masuk laporan asli');
throws('tidak bisa dipetakan ke toko non-Shopee', () => spUpdateShop_({ shopId: '555', env: 'test', storeCode: 'TTX' }), /bukan platform Shopee/);
spUpdateShop_({ shopId: '555', env: 'test', storeCode: 'SPX' });
const r1 = spSyncNow_({ startDate: '2026-11-01', endDate: '2026-11-16' });
ok('rentang 16 hari dipecah per 15 hari & halaman ke-2 diambil', sp.calls.filter(c => c.path === '/api/v2/order/get_order_list' && !c.q.cursor).length === 2 && rowsOf('SP_Orders').length === 6, r1.message);
ok('item, rincian dana (hanya pesanan selesai) tersimpan', rowsOf('SP_OrderLines').length === 6 && rowsOf('SP_Escrow').length === 2);
plMarkDirty_('');
ok('data mode UJI tidak masuk laba rugi toko SPX', plTotals_(plGetData_({ endDate: '2026-11-16', days: 16 }).daily.SPX).gross === 0);

console.log('\n51. Mode LIVE masuk laporan');
const linkL = spAuthUrl_({ env: 'live' }), stL = new URL(linkL.url).searchParams.get('state');
doGet({ parameter: { code: 'L1', shop_id: '777', state: stL } });
spUpdateShop_({ shopId: '777', env: 'live', storeCode: 'SPX' });
spSyncNow_({ startDate: '2026-11-01', endDate: '2026-11-16', shopKey: 'live:777' });
const tl = plTotals_(plGetData_({ endDate: '2026-11-16', days: 16 }).daily.SPX);
ok('omzet = 4 pesanan bukan batal × 50.000 (batal tidak dihitung)', tl.gross === 200000 && tl.orders === 4, tl);
ok('potongan 2 × (3.000+1.000), ongkir 2 × 2.000, PPh 22 dipotong 2 × 500', tl.fee === 8000 && tl.ship === 4000 && tl.tax === 1000);
ok('pesanan belum selesai → potongan belum settle (2 × 50.000), laba belum final', tl.feePending === 100000 && tl.final === false);
const n0 = rowsOf('SP_Orders').length; spSyncNow_({ startDate: '2026-11-01', endDate: '2026-11-16', shopKey: 'live:777' });
ok('sinkron ulang tidak menggandakan', rowsOf('SP_Orders').length === n0);

console.log('\n52. Token diperbarui otomatis & stok');
const a = JSON.parse(__env.props.SP_AUTH_LIVE_777); a.access_expire_at = Math.floor(Date.now() / 1000) + 60; __env.props.SP_AUTH_LIVE_777 = JSON.stringify(a);
spSyncNow_({ startDate: '2026-11-15', endDate: '2026-11-16', shopKey: 'live:777' });
ok('token hampir habis → diperbarui lewat access_token/get', sp.refreshes === 1 && /AT2-2002-777/.test(__env.props.SP_AUTH_LIVE_777));
stockSave_({ storeCode: 'SPX', sku: 'PB-1', type: 'adj', qty: 50 });
spSyncNow_({ startDate: '2030-03-01', endDate: '2030-03-05', shopKey: 'live:777' });
ok('penjualan Shopee LIVE memotong stok (2 pesanan bukan batal × 2 unit → 46)', (stockGet_({ storeCode: 'SPX' }).items.find(i => i.sku === 'PB-1') || {}).qty === 46);

console.log('\n53. Kesalahan & akses');
__env.props.SHOPEE_LIVE_PARTNER_KEY = 'salah';
const bad = spSyncNow_({ startDate: '2026-11-15', endDate: '2026-11-16', shopKey: 'live:777' });
ok('kunci salah → penjelasan tanda tangan', /Tanda tangan ditolak/.test(JSON.stringify(bad)), bad.shops[0].error);
__env.props.SHOPEE_LIVE_PARTNER_KEY = 'kunci-shp-live';
TEAM_REQUEST_CONTEXT_ = null;
const fin2 = sessionFor('uang@gmail.com', 'finance');
ok('Keuangan boleh melihat koneksi & sinkron', !!teamRpc(fin2, 'spGetConnections', []).shops);
throws('Keuangan ditolak membuat link otorisasi Shopee', () => teamRpc(fin2, 'spGetAuthUrl', [{ env: 'live' }]), /tidak diizinkan/);
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
__env.fetchHandler = prevHandler;

console.log('\n=== MASTER TOKO (form baru) ===');
finSaveStore_({ code: 'ALS', name: 'Toko Alias', platform: 'Shopee', branch: 'Pusat', aliases: 'nama lama', platformShopId: '999' });
finSaveStore_({ code: 'ALS', name: 'Toko Alias 2', platform: 'Shopee', branch: 'Jatiwarna', active: 'true' });
const als = finListStores_().stores.find(s => s.code === 'ALS');
ok('edit dari form baru tidak menghapus alias & ID toko lama', als.aliases.join() === 'nama lama' && als.platformShopId === '999' && als.branch === 'Jatiwarna', als);
const spx = finListStores_().stores.find(s => s.code === 'SPX');
ok('daftar toko menampilkan sumber data API terhubung', spx.api.some(a => /^Shopee API/.test(a)), spx.api);

throws('hapus toko yang masih terhubung ditolak', () => finDeleteStore_({ code: 'SPX', confirm: 'HAPUS' }), /masih terhubung/);
throws('hapus toko tanpa konfirmasi ditolak', () => finDeleteStore_({ code: 'ALS' }), /HAPUS/);
finDeleteStore_({ code: 'ALS', confirm: 'HAPUS' });
ok('toko tanpa koneksi bisa dihapus', !finListStores_().stores.some(s => s.code === 'ALS'));
const live1 = spShops_()[0];
throws('hapus koneksi Shopee yang masih aktif ditolak', () => spUpdateShop_({ shopId: live1.id, env: live1.env, remove: true }), /Hentikan sinkron/);
spUpdateShop_({ shopId: live1.id, env: live1.env, disconnect: true });
spUpdateShop_({ shopId: live1.id, env: live1.env, approve: true });
ok('toko DIPUTUS bisa diaktifkan lagi', spShops_().find(x => x.id === live1.id && x.env === live1.env).status === 'AKTIF');
spUpdateShop_({ shopId: live1.id, env: live1.env, disconnect: true });
spUpdateShop_({ shopId: live1.id, env: live1.env, remove: true });
ok('hapus koneksi Shopee: baris & token hilang', !spShops_().some(x => x.id === live1.id && x.env === live1.env) && !__env.props[spTokKey_(live1.env, live1.id)]);

ok('tanggal dari sel Date (diubah Google Sheets) tetap dikenali', plDayKey_(new Date('2026-11-10T05:00:00Z')) === '2026-11-10' && plDayKey_('2026-11-10T12:00:00') === '2026-11-10');

const rep = plReport_({ start: finAddDays_(plToday_(), -29), end: plToday_() });
ok('Laporan Keuangan membaca mesin laba rugi (ada baris per toko, cabang, platform)', rep.stores.length > 0 && rep.branches.length > 0 && rep.channels.length > 0 && typeof rep.total.labaBersih === 'number', rep.total);
ok('Teks WhatsApp laporan tersusun', /Laba bersih toko/.test(plReportText_({ start: finAddDays_(plToday_(), -6), end: plToday_() }).text));
throws('rentang > 180 hari ditolak', () => plReport_({ start: '2026-01-01', end: '2026-11-01' }), /180/);

plSaveSkuCost_({ storeCode: '*', sku: 'HPP-UMUM', cost: 1000, from: '2026-01-01' });
plSaveSkuCost_({ storeCode: 'SPX', sku: 'HPP-UMUM', cost: 1500, from: '2026-10-01' });
const hppOf = plSkuIndex_();
ok('HPP Semua toko dipakai toko lain', hppOf('TTX', 'hpp-umum', '2026-11-01') === 1000);
ok('HPP khusus toko menimpa mulai tanggalnya, sebelum itu kembali ke Semua toko', hppOf('SPX', 'HPP-UMUM', '2026-11-01') === 1500 && hppOf('SPX', 'HPP-UMUM', '2026-05-01') === 1000);

{
  const txt = require('fs').readFileSync('/tmp/claude-0/-home-user-derianal-github-io/1f3b8c6a-d155-56fb-892d-2dfd315e222b/scratchpad/hpp-user.txt', 'utf8');
  const pv = plSkuBulk_({ text: txt, storeCode: '*', from: '2026-10-01' });
  console.log('    info: ' + JSON.stringify({ total: pv.total, matched: pv.matched, dupes: pv.dupes, dupeSkus: pv.rows.filter(r => r.dupe).map(r => r.sku) }));
  ok('HPP massal: daftar pengguna terbaca (baris judul dilewati)', pv.total >= 380 && pv.skipped.length === 1, { total: pv.total, skipped: pv.skipped, dupes: pv.dupes });
  ok('HPP massal: harga Rp10.000 → 10000, Rp825 → 825', pv.rows.find(r => r.sku === 'Andam-Karung').cost === 10000 && pv.rows.find(r => r.sku === 'Benih-BayamHijau-Seribuan').cost === 825);
  ok('HPP massal: pratinjau tidak menyimpan apa pun', plSkuIndex_()('X', 'Andam-Karung', '2026-11-01') === null);
}
ok('Seller SKU kosong → HPP pakai ID varian TikTok', plLineSku_('tts', [0,0,0,0,0,0,0,0,0,'1736314263963862655','',0]) === '1736314263963862655' && plLineSku_('tts', [0,0,0,0,0,0,0,0,0,'99','PB-35']) === 'PB-35');

{
  // Pemetaan SKU: varian TikTok tanpa Seller SKU → SKU internal di daftar HPP
  const sh = ttsSheet_('TTS_OrderLines');
  sh.appendRow(['X|O1|L1', 'SHOPX', 'TTX', 'O1', 'L1', '2026-11-05T10:00:00', 'COMPLETED', '', 'P1', '17363', '', 'Cengkeh pangan baik premium', '10 gram', 1, 5000, 5000, 0, 0, 'IDR', '']);
  plSaveSkuCost_({ storeCode: '*', sku: 'Cengkeh-10g', name: 'Cengkeh 10 gram', cost: 2500, from: '2026-01-01' });
  const before = skuMapList_({}).rows.find(r => r.key === 'tts|17363');
  ok('varian tanpa Seller SKU muncul di daftar pemetaan, dengan saran', before && !before.internalSku && before.suggest === 'Cengkeh-10g', before);
  skuMapSave_({ items: [{ key: 'tts|17363', internalSku: 'Cengkeh-10g' }] });
  ok('setelah dipetakan, HPP memakai SKU internal', plLineSku_('tts', [0,0,0,0,0,0,0,0,0,'17363','']) === 'Cengkeh-10g' && plSkuIndex_()('TTX', plLineSku_('tts', [0,0,0,0,0,0,0,0,0,'17363','']), '2026-11-05') === 2500);
  ok('stok tidak memakai ID varian bila tidak dipetakan', plLineSku_('tts', [0,0,0,0,0,0,0,0,0,'999',''], true) === '');
  skuMapSave_({ items: [{ key: 'tts|17363', internalSku: '' }] });
  ok('pemetaan bisa dilepas', plLineSku_('tts', [0,0,0,0,0,0,0,0,0,'17363','']) === '17363');
}

{
  // Tempel HPP → tautan otomatis ke varian TikTok
  const sh = ttsSheet_('TTS_OrderLines');
  sh.appendRow(['X|O2|L1', 'SHOPX', 'TTX', 'O2', 'L1', '2026-11-06T10:00:00', 'COMPLETED', '', 'P2', '5551', '', 'Pot Vinca 25 cm Pot Bunga Plastik Tebal', 'Hitam', 1, 9000, 9000, 0, 0, 'IDR', '']);
  sh.appendRow(['X|O2|L2', 'SHOPX', 'TTX', 'O2', 'L2', '2026-11-06T10:00:00', 'COMPLETED', '', 'P2', '5552', '', 'Pot Vinca 25 cm Pot Bunga Plastik Tebal', 'Putih', 1, 9000, 9000, 0, 0, 'IDR', '']);
  sh.appendRow(['X|O2|L3', 'SHOPX', 'TTX', 'O2', 'L3', '2026-11-06T10:00:00', 'COMPLETED', '', 'P3', '5553', '', 'Pot Vinca 30 cm', 'Hitam', 1, 9000, 9000, 0, 0, 'IDR', '']);
  const txt = 'Pot-Vinca-25-Hitam\tRp4.392\nPot-Vinca-25-Putih\tRp6.021\nPot-Vinca-40-Hitam\tRp12.411';
  const pv = plSkuBulk_({ text: txt, storeCode: '*', from: '2026-10-01' });
  const L = k => pv.links.find(l => l.key === k);
  ok('tautan otomatis: Pot Vinca 25 Hitam → Pot-Vinca-25-Hitam (yakin)', L('tts|5551') && L('tts|5551').sku === 'Pot-Vinca-25-Hitam' && L('tts|5551').sure, pv.links);
  ok('tautan otomatis: warna Putih ke SKU Putih', L('tts|5552') && L('tts|5552').sku === 'Pot-Vinca-25-Putih');
  ok('ukuran beda (30 cm) tidak ditautkan ke 25/40', !L('tts|5553'));
  const r = plSkuBulk_({ text: txt, storeCode: '*', from: '2026-10-01', apply: true, linkKeys: pv.links.filter(l => l.sure).map(l => l.key) });
  ok('simpan HPP + tautan sekaligus', r.linked >= 2 && plSkuIndex_()('TTX', plLineSku_('tts', [0,0,0,0,0,0,0,0,0,'5551','']), '2026-11-06') === 4392, r.message);
}

{
  const detail = { title: 'Pot Vinca 25', skus: [
    { id: '5551', seller_sku: '', price: { currency: 'IDR', sale_price: '9000', tax_exclusive_price: '9000' }, inventory: [{ warehouse_id: 'W1', quantity: 12 }],
      sales_attributes: [{ id: 'A1', name: 'Warna', value_id: 'V1', value_name: 'Hitam', sku_img: { uri: 'img1', urls: ['x'] } }] },
    { id: '5552', seller_sku: 'LAMA', price: { currency: 'IDR', sale_price: '9500' }, inventory: [{ warehouse_id: 'W1', quantity: 3 }],
      sales_attributes: [{ id: 'A1', name: 'Warna', value_id: 'V2', value_name: 'Putih' }] }] };
  const b = skuEditBuildBody_(detail, { '5551': 'Pot-Vinca-25-Hitam' });
  ok('edit SKU: semua varian ikut dikirim (tidak ada yang terhapus)', b.body.skus.length === 2 && !b.unsupported.length);
  ok('edit SKU: hanya seller_sku yang berubah; harga, stok, atribut disalin', b.body.skus[0].seller_sku === 'Pot-Vinca-25-Hitam' && b.body.skus[1].seller_sku === 'LAMA' &&
    b.body.skus[0].price.amount === '9000' && b.body.skus[1].price.amount === '9500' && b.body.skus[0].inventory[0].quantity === 12 && b.body.skus[0].inventory[0].warehouse_id === 'W1' &&
    b.body.skus[0].sales_attributes[0].value_name === 'Hitam' && b.body.skus[0].sales_attributes[0].sku_img.uri === 'img1', b.body);
  const bad = skuEditBuildBody_({ skus: [{ id: '1', price: { sale_price: '1', currency: 'IDR' }, inventory: [], combined_skus: [{ product_id: 'x' }] }] }, {});
  ok('edit SKU: produk bundle ditolak (diubah manual)', bad.unsupported.length > 0);
  ok('Seller SKU dirapikan: tanpa spasi & kurung, maks 50', skuEditSanitize_('Polybag 20CM-Hitam-500Gram { 83 pcs }') === 'Polybag-20CM-Hitam-500Gram-83-pcs');
  throws('edit SKU wajib konfirmasi UBAH', () => skuEditApply_({ productKeys: ['x|y'] }), /UBAH/);
}

{
  const r = JSON.parse(doPost({ postData: { contents: JSON.stringify({ kind: 'team-auth', code: 'x', state: 'zz' }) } }).text);
  ok('doPost menerima hasil login dari halaman perantara tanpa error', r.success === true);
  ok('tanpa TEAM_AUTH_REDIRECT_URL, alamat balik login tetap /exec (perilaku lama)', (() => { try { return teamConfig_().redirect === teamConfig_().url; } catch (e) { return /TEAM_GOOGLE_CLIENT_ID/.test(e.message); } })());
}

{
  // Barang sama di dua toko: dipetakan di satu toko → toko lain dapat saran SKU yang sama (100%)
  const sh = ttsSheet_('TTS_OrderLines');
  sh.appendRow(['Y|O9|L1', 'SHOPY', 'TTY', 'O9', 'L1', '2026-11-07T10:00:00', 'COMPLETED', '', 'P9', '9901', '', 'Pot Tawon 20', 'Putih', 1, 5000, 5000, 0, 0, 'IDR', '']);
  sh.appendRow(['Z|O9|L1', 'SHOPZ', 'TTZ', 'O9', 'L1', '2026-11-07T10:00:00', 'COMPLETED', '', 'P8', '8801', '', 'Pot  Tawon 20!', 'putih', 1, 5000, 5000, 0, 0, 'IDR', '']);
  skuMapSave_({ items: [{ key: 'tts|9901', internalSku: 'Pot-Tawon-20-Putih' }] });
  const other = skuMapList_({}).rows.find(r => r.key === 'tts|8801');
  ok('barang sama di toko lain dikelompokkan & disarankan SKU yang sama', other.group === skuMapList_({}).rows.find(r => r.key === 'tts|9901').group && other.suggest === 'Pot-Tawon-20-Putih' && other.sameGroup, other);
}

{
  // Varian tanpa nama (belum diambil) tidak boleh digabung walau katalognya sama
  const sh = ttsSheet_('TTS_OrderLines');
  sh.appendRow(['Q|O1|L1', 'SHOPQ', 'TTQ', 'O1', 'L1', '2026-11-07T10:00:00', 'COMPLETED', '', 'PQ', '7001', '', 'Cengkeh Premium', '', 1, 5000, 5000, 0, 0, 'IDR', '']);
  sh.appendRow(['Q|O1|L2', 'SHOPQ', 'TTQ', 'O1', 'L2', '2026-11-07T10:00:00', 'COMPLETED', '', 'PQ', '7002', '', 'Cengkeh Premium', '', 1, 9000, 9000, 0, 0, 'IDR', '']);
  const L = skuMapList_({}).rows, a = L.find(r => r.key === 'tts|7001'), b = L.find(r => r.key === 'tts|7002');
  ok('varian tanpa nama tidak digabung (10 g & 50 g tetap terpisah)', a.group !== b.group);
}

{
  skuMapSave_({ items: [{ key: 'tts|7001', internalSku: 'cengkeh-10gram' }] });
  let x = skuMapList_({}).rows.find(r => r.key === 'tts|7001');
  ok('varian tersambung tanpa HPP → hpp kosong (bukan 0)', x.hpp === null, x.hpp);
  plSkuBulk_({ text: 'cengkeh-10gram\t2500', storeCode: '*', from: '2026-01-01', apply: true, autoLink: false });
  x = skuMapList_({}).rows.find(r => r.key === 'tts|7001');
  ok('HPP diisi dari Pemetaan SKU langsung tampil di varian', x.hpp === 2500, x.hpp);
}

{
  // Dua katalog berbeda untuk Biji Pala, varian sama → katalog kedua dapat saran dari katalog pertama
  const sh = ttsSheet_('TTS_OrderLines');
  sh.appendRow(['P|O1|L1', 'SHOPP', 'TTP', 'O1', 'L1', '2026-11-07T10:00:00', 'COMPLETED', '', 'PA', '8101', '', 'Biji Pala Utuh Banda Kualitas Ekspor', '50 gram', 1, 5000, 5000, 0, 0, 'IDR', '']);
  sh.appendRow(['P|O1|L2', 'SHOPP', 'TTP', 'O1', 'L2', '2026-11-07T10:00:00', 'COMPLETED', '', 'PB', '8201', '', 'PANGAN BAIK - Biji Pala Utuh Premium 100% Alami | Pala Kering Pilihan untuk Bumbu Masak', '50 gram', 1, 5000, 5000, 0, 0, 'IDR', '']);
  sh.appendRow(['P|O1|L3', 'SHOPP', 'TTP', 'O1', 'L3', '2026-11-07T10:00:00', 'COMPLETED', '', 'PC', '8301', '', 'Cengkeh Kering Premium', '50 gram', 1, 5000, 5000, 0, 0, 'IDR', '']);
  skuMapSave_({ items: [{ key: 'tts|8101', internalSku: 'bijipala-50gram' }] });
  const L = skuMapList_({}).rows, b = L.find(r => r.key === 'tts|8201'), c = L.find(r => r.key === 'tts|8301');
  ok('katalog lain yang mirip (Biji Pala) disarankan SKU yang sama', b.suggest === 'bijipala-50gram' && b.fromSimilar, b);
  ok('katalog beda barang (Cengkeh 50 gram) TIDAK disarankan SKU biji pala', c.suggest !== 'bijipala-50gram', c.suggest);
}

{
  const sh = ttsSheet_('TTS_OrderLines');
  const T1 = 'Pangan Baik - Biji Pala Utuh 50g 100g 250g Pala Kering Bumbu Masak & Kue';
  const T2 = 'PANGAN BAIK - Biji Pala Utuh Premium 100% Alami | Pala Kering Pilihan untuk Bumbu Masak, Rempah & Herbal | 50g 100g 250g';
  let n = 0; const add = (t, v, id) => sh.appendRow(['R|O' + id + '|L', 'SHOPR', 'TTR', 'O' + id, 'L', '2026-11-07T10:00:00', 'COMPLETED', '', 'P' + id, id, '', t, v, 1, 5000, 5000, 0, 0, 'IDR', '']);
  add(T1, '50 gram', 'A1'); add(T2, '50 gram', 'B1');
  ['Biji Cengkeh', 'Biji Kapulaga', 'Biji Ketumbar', 'Merica', 'Biji Jinten', 'Kayu Manis', 'Lada', 'Kemiri', 'Adas'].forEach((w, i) => add('PANGAN BAIK - ' + w + ' Premium', '50 gram', 'C' + i));
  skuMapSave_({ items: [{ key: 'tts|A1', internalSku: 'bijipala-50gram' }] });
  const b = skuMapList_({}).rows.find(r => r.key === 'tts|B1');
  ok('Biji Pala katalog kedua dapat saran (kata biji/pangan baik umum)', b.suggest === 'bijipala-50gram' && b.fromSimilar, b.suggest);
  const c0 = skuMapList_({}).rows.find(r => r.key === 'tts|C0');
  ok('Cengkeh 50 gram tidak dapat SKU biji pala', c0.suggest !== 'bijipala-50gram', c0.suggest);
}

{
  skuMapSave_({ items: [{ key: 'tts|8201', internalSku: 'bijipala-50gram' }] });
  ok('SKU Gudang: SKU milik toko lain tidak muncul di gudang yang tidak memakainya', !skuGudangList_({ storeCode: 'TTX' }).rows.some(x => plSkuKey_(x.sku) === 'BIJIPALA-50GRAM'));
  let g = skuGudangList_({ storeCode: 'TTP' }), r = g.rows.find(x => plSkuKey_(x.sku) === 'BIJIPALA-50GRAM');
  ok('SKU Gudang: SKU dari pemetaan muncul walau belum ada HPP/stok', r && r.variants >= 2 && r.hpp === null && r.stock === null, r);
  skuGudangSave_({ storeCode: 'TTX', from: '2026-01-01', items: [{ sku: 'bijipala-50gram', hpp: '7500', stock: '40' }] });
  g = skuGudangList_({ storeCode: 'TTX' }); r = g.rows.find(x => plSkuKey_(x.sku) === 'BIJIPALA-50GRAM');
  ok('SKU Gudang: ubah HPP & stok dari daftar', r.hpp === 7500 && r.stock === 40 && r.stockAll === 40, r);
  skuGudangSave_({ storeCode: 'TTX', items: [{ sku: 'bijipala-50gram', stock: '35' }] });
  r = skuGudangList_({ storeCode: 'TTX' }).rows.find(x => plSkuKey_(x.sku) === 'BIJIPALA-50GRAM');
  ok('SKU Gudang: stok bisa dikoreksi (hitung fisik)', r.stock === 35, r.stock);
}

{
  console.log('\n=== LOGIN EMAIL + KATA SANDI ===');
  const members = JSON.parse(__env.props.TEAM_MEMBERS_JSON), ownerEmail = Object.keys(members).find(e => members[e] === 'owner');
  // rapikan tim supaya ada slot
  Object.keys(members).forEach(e => { if (e !== ownerEmail) delete members[e]; }); __env.props.TEAM_MEMBERS_JSON = JSON.stringify(members);
  const subs = JSON.parse(__env.props.TEAM_GOOGLE_SUBJECTS_JSON || '{}'); subs[ownerEmail] = 'sub-' + ownerEmail; __env.props.TEAM_GOOGLE_SUBJECTS_JSON = JSON.stringify(subs);
  const ownTok = require('crypto').createHash('sha256').update('own-pw-test').digest('hex');
  __env.cache['team:session:' + teamHash_(ownTok)] = JSON.stringify({ email: ownerEmail, sub: 'sub-' + ownerEmail, expires: Date.now() + 3600000 });
  throws('kata sandi lemah ditolak', () => teamManage(ownTok, 'add', { email: 'reviewer@shopee-test.com', role: 'viewer', password: 'abc' }), /minimal 8/);
  const r = teamManage(ownTok, 'add', { email: 'reviewer@shopee-test.com', role: 'viewer', password: 'Review2026' });
  ok('owner menambah anggota non-Gmail dengan kata sandi', r.ok && JSON.parse(__env.props.TEAM_MEMBERS_JSON)['reviewer@shopee-test.com'] === 'viewer');
  ok('kata sandi tidak disimpan apa adanya', !Object.values(__env.props).some(v => String(v).indexOf('Review2026') >= 0));
  throws('sandi salah ditolak dengan pesan umum', () => teamPasswordLogin('reviewer@shopee-test.com', 'Salah12345'), /Email atau kata sandi salah/);
  throws('email tidak terdaftar: pesan sama', () => teamPasswordLogin('orang@luar.com', 'Review2026'), /Email atau kata sandi salah/);
  const L = teamPasswordLogin('REVIEWER@shopee-test.com', 'Review2026');
  ok('login email+sandi berhasil → sesi berlaku', L.session && teamRequire_(L.session).role === 'viewer');
  throws('Pembaca tetap tidak boleh menulis', () => teamRpc(L.session, 'finSaveStore', [{ code: 'Z1', name: 'z', branch: 'x' }]), /tidak diizinkan/);
  for (let i = 0; i < 5; i++) { try { teamPasswordLogin('reviewer@shopee-test.com', 'Salah' + i + 'xxxx'); } catch (e) {} }
  throws('dikunci setelah 5x salah (sandi benar pun ditolak)', () => teamPasswordLogin('reviewer@shopee-test.com', 'Review2026'), /Terlalu banyak percobaan/);
  Object.keys(__env.cache).filter(k => k.indexOf('team:pwfail:') === 0).forEach(k => delete __env.cache[k]);
  const L2 = teamPasswordLogin('reviewer@shopee-test.com', 'Review2026');
  teamManage(ownTok, 'setpw', { email: 'reviewer@shopee-test.com', password: 'Baru2026x' });
  throws('owner atur ulang sandi → sesi lama keluar', () => teamRequire_(L2.session), /LOGIN_REQUIRED/);
  const L3 = teamPasswordLogin('reviewer@shopee-test.com', 'Baru2026x');
  teamChangePassword(L3.session, 'Baru2026x', 'Ganti2026y');
  ok('ganti sandi sendiri: sesi yang dipakai tetap jalan', teamRequire_(L3.session).email === 'reviewer@shopee-test.com');
  throws('ganti sandi sendiri butuh sandi lama yang benar', () => teamChangePassword(L3.session, 'salahlama1', 'Lain2026z'), /lama salah/);
  teamManage(ownTok, 'remove', { email: 'reviewer@shopee-test.com', role: 'viewer' });
  throws('anggota dihapus → tidak bisa login lagi', () => teamPasswordLogin('reviewer@shopee-test.com', 'Ganti2026y'), /Email atau kata sandi salah/);
}

{
  console.log('\n=== NOTIFIKASI TELEGRAM ===');
  TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
  const TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghijklmnop';
  const tg = { sent: [] }, prev = __env.fetchHandler;
  __env.fetchHandler = (url, opt) => {
    const u = String(url);
    if (u.indexOf('https://api.telegram.org/bot') !== 0) return prev(url, opt);
    const okTok = u.indexOf('/bot' + TOKEN + '/') > 0, method = u.split('/').pop(), body = opt.payload ? JSON.parse(opt.payload) : {};
    const R = (code, o) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(o) });
    if (!okTok) return R(401, { ok: false, description: 'Unauthorized' });
    if (method === 'getMe') return R(200, { ok: true, result: { username: 'pks_keuangan_bot' } });
    if (method === 'getUpdates') return R(200, { ok: true, result: [{ message: { chat: { id: 555111, type: 'private', first_name: 'Owner' } } }, { message: { chat: { id: -100777, type: 'group', title: 'Tim PKS' } } }] });
    if (method === 'sendMessage') { tg.sent.push(body); return R(200, { ok: true, result: {} }); }
    return R(404, { ok: false, description: 'Not Found' });
  };
  throws('token format salah ditolak', () => notifySetToken_({ token: 'abc' }), /Format token/);
  let err = ''; try { notifySetToken_({ token: '123456789:AAWrongTokenWrongTokenWrongToken_xyz' }); } catch (e) { err = e.message; }
  ok('token salah: pesan jelas & token tidak bocor', /token bot salah/.test(err) && err.indexOf('AAWrong') < 0 && !__env.props.TELEGRAM_BOT_TOKEN, err);
  ok('token benar tersimpan, nama bot terbaca', notifySetToken_({ token: TOKEN }).bot === 'pks_keuangan_bot');
  ok('konfigurasi tidak pernah mengembalikan token', JSON.stringify(notifyConfig_()).indexOf('AAFake') < 0 && notifyConfig_().tokenSet === true);
  const chats = notifyFindChats_().chats;
  ok('cari chat menemukan pribadi & grup', chats.length === 2 && chats.some(c => c.title === 'Tim PKS'));
  notifySetChat_({ chatId: '-100777', title: 'Tim PKS' });
  // pesanan baru: 1 dibayar, 1 belum dibayar
  const nowIso = Utilities.formatDate(new Date(), 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
  __env.props.NOTIFY_SINCE = String(Math.floor(Date.now() / 1000) - 600);
  const sh = ttsSheet_('TTS_Orders'), shl = ttsSheet_('TTS_OrderLines');
  sh.appendRow(['N1|991', 'N1', 'TTN', '991', nowIso, nowIso, nowIso, 'AWAITING_SHIPMENT', 'IDR', 45000, 0, 0, 45000, 0, 0, 0, 0, 0, 45000, 2, 'COD', true, nowIso]);
  sh.appendRow(['N1|992', 'N1', 'TTN', '992', nowIso, nowIso, '', 'UNPAID', 'IDR', 9000, 0, 0, 9000, 0, 0, 0, 0, 0, 9000, 1, '', false, nowIso]);
  shl.appendRow(['N1|991|a', 'N1', 'TTN', '991', 'a', nowIso, 'AWAITING_SHIPMENT', '', 'P', 'S1', '', 'Cengkeh <Premium>', '50 gram', 1, 0, 0, 0, 0, 'IDR', '']);
  shl.appendRow(['N1|991|b', 'N1', 'TTN', '991', 'b', nowIso, 'AWAITING_SHIPMENT', '', 'P', 'S1', '', 'Cengkeh <Premium>', '50 gram', 1, 0, 0, 0, 0, 'IDR', '']);
  const before = tg.sent.length;
  notifyTick_();
  const msg = tg.sent.slice(before);
  ok('pesanan dibayar dikirim ke Telegram (1 pesan, item digabung ×2, COD, HTML aman)', msg.length === 1 && /#991/.test(msg[0].text) && /×2/.test(msg[0].text) && /COD/.test(msg[0].text) && /&lt;Premium&gt;/.test(msg[0].text) && msg[0].chat_id === '-100777', msg);
  notifyTick_();
  ok('pesanan yang sama tidak dikirim dua kali; UNPAID tidak dikirim', tg.sent.length === before + 1);
  __env.fetchHandler = prev;
}

{
  console.log('\n=== NOTIFIKASI WHATSAPP (FONNTE) ===');
  TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
  const FT = 'fonnteTokenUji1234567', wa = [], prev = __env.fetchHandler;
  __env.fetchHandler = (url, opt) => {
    if (String(url) !== 'https://api.fonnte.com/send') return prev(url, opt);
    const R = o => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(o) });
    if ((opt.headers || {}).Authorization !== FT) return R({ status: false, reason: 'invalid token' });
    wa.push(opt.payload); return R({ status: true });
  };
  throws('nomor salah ditolak', () => notifySetWa_({ token: FT, target: '12345' }), /formatnya salah/);
  let e1 = ''; try { notifySetWa_({ token: 'tokenSalahSekali999', target: '081234567890' }); } catch (e) { e1 = e.message; }
  ok('token Fonnte salah: ditolak, tidak tersimpan, tidak bocor', /periksa token/.test(e1) && !__env.props.FONNTE_TOKEN && e1.indexOf('tokenSalah') < 0, e1);
  notifySetWa_({ token: FT, target: '0812-3456-7890, +62 857 1111 2222' });
  ok('nomor dinormalisasi ke 62xxx & pesan tes terkirim', __env.props.WA_TARGET === '6281234567890,6285711112222' && wa.length === 1 && wa[0].target === '6281234567890,6285711112222');
  ok('konfigurasi tidak mengembalikan token Fonnte', JSON.stringify(notifyConfig_()).indexOf(FT) < 0 && notifyConfig_().waTokenSet);
  const nowIso = Utilities.formatDate(new Date(), 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
  ttsSheet_('TTS_Orders').appendRow(['N1|993', 'N1', 'TTN', '993', nowIso, nowIso, nowIso, 'AWAITING_SHIPMENT', 'IDR', 9000, 0, 0, 9000, 0, 0, 0, 0, 0, 9000, 1, '', false, nowIso]);
  ttsSheet_('TTS_OrderLines').appendRow(['N1|993|a', 'N1', 'TTN', '993', 'a', nowIso, 'AWAITING_SHIPMENT', '', 'P', 'S1', '', 'Kapulaga', '25 gram', 1, 0, 0, 0, 0, 'IDR', '']);
  const n0 = wa.length; notifyTick_();
  ok('pesanan baru dikirim lewat WhatsApp (format *tebal*, bukan HTML)', wa.length === n0 + 1 && /\*Pesanan baru — TTN\*/.test(wa[n0].message) && /#993/.test(wa[n0].message) && wa[n0].message.indexOf('<b>') < 0, wa[n0]);
  __env.fetchHandler = prev;
}

{
  console.log('\n=== HALAMAN PESANAN ===');
  TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
  const nowIso = Utilities.formatDate(new Date(), 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss");
  const o = ttsSheet_('TTS_Orders'), l = ttsSheet_('TTS_OrderLines');
  [['O1', 'AWAITING_SHIPMENT'], ['O2', 'AWAITING_COLLECTION'], ['O3', 'COMPLETED'], ['O4', 'CANCELLED'], ['O5', 'UNPAID']].forEach(x =>
    o.appendRow(['Q|' + x[0], 'Q', 'TTN', x[0], nowIso, nowIso, nowIso, x[1], 'IDR', 1000, 0, 0, 1000, 0, 0, 0, 0, 0, 1000, 1, '', false, nowIso]));
  l.appendRow(['Q|O1|a', 'Q', 'TTN', 'O1', 'a', nowIso, 'AWAITING_SHIPMENT', '', 'P', 'S', '', 'Jahe Merah', '100 gram', 1, 0, 0, 0, 0, 'IDR', '']);
  l.appendRow(['Q|O1|b', 'Q', 'TTN', 'O1', 'b', nowIso, 'AWAITING_SHIPMENT', '', 'P', 'S', '', 'Jahe Merah', '100 gram', 1, 0, 0, 0, 0, 'IDR', '']);
  const r = ordersList_({ group: 'kirim', storeCode: 'TTN' });
  const k = r.rows.find(x => x.id === 'O1');
  ok('pesanan dikelompokkan per status (perlu dikirim, menunggu kurir, selesai, batal, belum bayar)', k && r.counts.kirim >= 1 && r.counts.ambil >= 1 && r.counts.sampai !== undefined && r.counts.selesai >= 1 && r.counts.batal >= 1 && r.counts.belumbayar >= 1, r.counts);
  ok('item digabung ×2', k.items.length === 1 && k.items[0].qty === 2 && /Jahe Merah — 100 gram/.test(k.items[0].name));
  ok('pencarian produk', ordersList_({ group: 'kirim', storeCode: 'TTN', q: 'jahe' }).rows.length === 1 && ordersList_({ group: 'kirim', storeCode: 'TTN', q: 'kopi' }).rows.length === 0);
  const testSn = plSheetRows_('SP_Orders', 14).filter(x => String(x[12]) === 'test').map(x => String(x[3]));
  const liveSn = plSheetRows_('SP_Orders', 14).filter(x => String(x[12]) === 'live').map(x => String(x[3]));
  const shown = [].concat(...['belumbayar', 'kirim', 'ambil', 'dikirim', 'sampai', 'selesai', 'batal'].map(g => ordersList_({ group: g, days: 60 }).rows)).filter(x => x.platform === 'Shopee').map(x => x.id);
  ok('Shopee: hanya pesanan LIVE yang tampil (UJI tidak ikut)', testSn.length > 0 && shown.length === liveSn.length, { testSn: testSn.length, liveSn: liveSn.length, shown: shown.length });
  const A = ordersList_({ group: 'all', storeCode: 'TTN' });
  ok('mode semua status: semua pesanan dikirim sekali (tab diproses di browser)', A.group === 'all' && ['O1', 'O2', 'O3', 'O4', 'O5'].every(id => A.rows.some(x => x.id === id)) && A.rows.find(x => x.id === 'O2').group === 'ambil');
  __env.props.ORDERS_LAST_PULL = String(Date.now());
  ok('tarik ulang dibatasi 90 detik (tidak menarik lagi)', ordersRefresh_({ group: 'kirim' }).pulled === false);
}

{
  const prev = __env.fetchHandler, seen = [];
  __env.fetchHandler = (url, opt) => {
    if (String(url).indexOf('/order/202309/orders/search') < 0) return prev(url, opt);
    seen.push(opt.payload ? JSON.parse(opt.payload) : {});
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ code: 0, data: { orders: [], next_page_token: '' } }) };
  };
  try { ttsPullOrders_({ id: 'X', storeCode: 'TTX', cipher: 'c' }, { access_token: 't' }, { ge: 100, lt: 200 }, Date.now() + 5000, 'update_time'); } catch (e) {}
  try { ttsPullOrders_({ id: 'X', storeCode: 'TTX', cipher: 'c' }, { access_token: 't' }, { ge: 100, lt: 200 }, Date.now() + 5000); } catch (e) {}
  ok('tarik pesanan berdasarkan perubahan status (update_time) & default create_time', seen.length === 2 && seen[0].update_time_ge === 100 && seen[0].update_time_lt === 200 && !seen[0].create_time_ge && seen[1].create_time_ge === 100, seen);
  __env.fetchHandler = prev;
}

{
  // Sheet penuh (baris habis): penulisan harus menambah baris otomatis, bukan error
  const sh = stockSheet_(); sh.maxR = sh.getLastRow();   // tidak ada baris kosong tersisa
  let ok1 = true; try { ensureRoom_(sh, 3, STOCK_HEADERS.length).getRange(sh.getLastRow() + 1, 1, 3, STOCK_HEADERS.length).setValues([1, 2, 3].map(i => STOCK_HEADERS.map(() => 'x' + i))); } catch (e) { ok1 = e.message; }
  ok('sheet tanpa baris kosong: tulis 3 baris tetap berhasil (baris ditambah otomatis)', ok1 === true && sh.getMaxRows() >= sh.getLastRow(), ok1);
  let bad = ''; sh.maxR = sh.getLastRow(); try { sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([['a', 'b']]); } catch (e) { bad = e.message; }
  ok('tanpa pengaman memang error (tiruan mengikuti Google Sheets)', /out of bounds/.test(bad));
  sh.data.splice(sh.data.length - 3, 3);
}

{
  // Sheet HPP_SKU sudah ada tapi kosong (tanpa judul) → HPP pertama tidak boleh hilang
  const db = getDatabase_(), h = db.getSheetByName('HPP_SKU'); h.data = []; 
  plSaveSkuCost_({ storeCode: '*', sku: 'KOSONG-1', cost: 1234, from: '2026-01-01' });
  ok('sheet HPP kosong: judul ditulis dulu, HPP pertama terbaca', String(h.data[0][1]) === 'Seller SKU' && plSkuIndex_()('X', 'KOSONG-1', '2026-11-01') === 1234, h.data.slice(0, 2));
}

{
  TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
  const pr = plProductsForAI_({ days: 60, endDate: plToday_() });
  const jahe = pr.terlarisMenurutUnit.find(x => /Jahe Merah/.test(x.produk));
  ok('AI: ringkasan produk terlaris (TikTok item digabung, unit & omzet, batal tidak dihitung)', pr.jumlahProduk > 0 && jahe && jahe.unit >= 2 && !pr.terlarisMenurutUnit.some(x => /O4/.test(x.produk)), { n: pr.jumlahProduk, jahe });
}

{
  // Tahap 2 Pesanan: atur pengiriman & cetak resi (TikTok API ditiru)
  TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
  const row = plSheetRows_('TTS_Orders', 23).find(r => String(r[3]));
  const oid = row ? String(row[3]) : '';
  const orig = { req: ttsRequest, shops: ttsShops_, auth: ttsGetAuth_ }, calls = [];
  let status = 'AWAITING_SHIPMENT';
  ttsShops_ = () => [{ id: String(row && row[1]), openId: 'o1', cipher: 'c1', storeCode: String(row && row[2]) }];
  ttsGetAuth_ = () => ({ access_token: 'tok' });
  ttsRequest = (shop, m, path, q, body) => { calls.push({ m, path, q, body });
    if (path === '/order/202309/orders') return { orders: [{ id: q.ids, status, shipping_type: 'TIKTOK', delivery_option_name: 'Reguler', packages: [{ id: 'PKG1' }] }] };
    if (/handover_time_slots$/.test(path)) return { can_pickup: true, can_drop_off: true, pickup_slots: [{ start_time: 1790000000, end_time: 1790007200, avaliable: true }, { start_time: 1, end_time: 2, avaliable: false }] };
    if (/\/ship$/.test(path)) return {};
    if (/shipping_documents$/.test(path)) return { doc_url: 'https://example.test/label.pdf', tracking_number: 'JX123' };
    throw new Error('path tak terduga ' + path); };
  try {
    ok('ada pesanan TikTok untuk uji', !!oid, oid);
    const info = ordShipInfo_({ orderId: oid });
    ok('info kirim: pickup/drop-off & slot tersedia saja', info.canPickup && info.canDropOff && info.slots.length === 1 && info.packages[0] === 'PKG1', info);
    throws('atur kirim wajib konfirmasi', () => ordShip_({ orderId: oid, method: 'PICKUP' }), /Konfirmasi/);
    throws('atur kirim wajib pilih metode', () => ordShip_({ orderId: oid, method: 'X', confirm: 'KIRIM' }), /Pickup/);
    throws('no. pesanan aneh ditolak', () => ordShip_({ orderId: '1;DROP', method: 'PICKUP', confirm: 'KIRIM' }), /tidak valid/);
    const r = ordShip_({ orderId: oid, method: 'PICKUP', slotStart: 1790000000, slotEnd: 1790007200, confirm: 'KIRIM' });
    const shipCall = calls.find(c => /\/ship$/.test(c.path));
    ok('atur kirim: body handover_method + pickup_slot sesuai SDK', r.ok && shipCall.m === 'POST' && shipCall.body.handover_method === 'PICKUP' && shipCall.body.pickup_slot.start_time === 1790000000, shipCall);
    ok('atur kirim tercatat di Fulfill_Log', getDatabase_().getSheetByName('Fulfill_Log').data.some(x => String(x[3]) === oid && x[6] === 'BERHASIL'));
    status = 'AWAITING_COLLECTION';
    throws('pesanan yang sudah diatur tidak dikirim ulang', () => ordShip_({ orderId: oid, method: 'DROP_OFF', confirm: 'KIRIM' }), /tidak perlu/);
    const lb = ordLabel_({ orderIds: [oid], size: 'A6' });
    const docCall = calls.find(c => /shipping_documents$/.test(c.path));
    ok('cetak resi: link PDF + no. resi, query document_type/size', lb.docs[0].ok && lb.docs[0].tracking === 'JX123' && docCall.q.document_type === 'SHIPPING_LABEL' && docCall.q.document_size === 'A6', lb);
  } finally { ttsRequest = orig.req; ttsShops_ = orig.shops; ttsGetAuth_ = orig.auth; }
}

{
  // Saran berdasarkan ciri: ukuran 3M X 10M = 3x10, 85% dianggap 90%, warna & polos/terpal harus cocok
  const al = skuPctAlias_(), c = ['polos-hitam-roll-3x10 90%', 'polos-coffe-roll-3x10 90%', 'polos-hitam-roll-3x10 75%', 'terpal-hitam-3x10-90%'].map(s => ({ sku: s, f: skuFeat_(s.replace(/-/g, ' '), al) }));
  const T = 'PARANET PK - Jaring Paranet 3M x 10M Polos Peneduh Tanaman Tebal Hitam';
  const a = skuMapFeatSuggest_({ product: T, variant: '3M X 10M 85%' }, c, al), b = skuMapFeatSuggest_({ product: T, variant: '3M X 10M 75%' }, c, al);
  const d = skuMapFeatSuggest_({ product: 'Paranet 90% List Terpal hitam', variant: '3M X 10M List Terpal' }, c, al), e = skuMapFeatSuggest_({ product: T, variant: '4M X 10M 90%' }, c, al);
  ok('saran ciri: 85% → SKU 90%, 75% tetap 75%, terpal tidak tertukar polos, ukuran beda tidak ditebak',
    a.sku === 'polos-hitam-roll-3x10 90%' && !a.ambiguous && b.sku === 'polos-hitam-roll-3x10 75%' && d.sku === 'terpal-hitam-3x10-90%' && e === null, { a, b, d, e });
}

{
  // Katalog mirip tapi persen beda (75% vs 85%/90%) → tidak disarankan
  const refs = [{ sku: 'polos-hitam-roll-2x10 75%', v: skuMapNorm_('2M X 10M Polos'), t: skuMapTitleTokens_('PARANET PK - Jaring Paranet 75% Grade A Paranet 75% Garden Sunshade Net Jaring Rumah Kaca') }];
  const a = skuMapSimilar_({ product: 'PARANET PK - Jaring Paranet 85% 90% Grade A Paranet 85% 90% Garden Sunshade Net Jaring Rumah Kaca', variant: '2M X 10M Polos' }, refs);
  const b = skuMapSimilar_({ product: 'PARANET PK - Jaring Paranet 75% Grade A Lebar 2 Meter Garden Sunshade Net Jaring Rumah Kaca', variant: '2M X 10M Polos' }, refs);
  ok('katalog mirip: persen beda tidak disarankan, persen sama tetap disarankan', a === null && b && b.sku === 'polos-hitam-roll-2x10 75%', { a, b });
}

{
  const al = skuPctAlias_();
  const a = skuMapConflict_({ product: 'Paranet Hitam 95% 2x50 Meter Roll', variant: '(tanpa varian)', internalSku: 'terpal-hitam-roll-3x100' }, al);
  const b = skuMapConflict_({ product: 'Paranet Coffee {95% UV- TANPA TERPAL} 3x100 Meter Roll', variant: '(tanpa varian)', internalSku: 'roll-coffe-polos-3x100-95%' }, al);
  const c = skuMapConflict_({ product: 'Paranet 90% List Terpal', variant: '3M X 10M List Terpal', internalSku: 'terpal-hitam-3x10-90%' }, al);
  ok('pemeriksa pemetaan: ukuran/jenis salah ditandai, "tanpa terpal" = polos, yang benar tidak ditandai', a && a.length === 2 && b === null && c === null, { a, b, c });
}

{
  // Data Produk: daftar + ubah harga + hapus varian (TikTok API ditiru)
  TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
  const sh = ttsSheet_('TTS_Products');
  sh.appendRow(['SHX|P9|V1', 'SHX', 'TTX', 'P9', 'V1', '', 'Paranet Uji', 'ACTIVATE', 'IDR', '', 10000, 5, '', '', '']);
  sh.appendRow(['SHX|P9|V2', 'SHX', 'TTX', 'P9', 'V2', '', 'Paranet Uji', 'ACTIVATE', 'IDR', '', 20000, 3, '', '', '']);
  const L = prodList_({ storeCode: 'TTX' }), pr = L.products.find(x => x.productId === 'P9');
  ok('Data Produk: produk & varian terbaca (harga dari tax_exclusive_price, status live)', pr && pr.variants.length === 2 && pr.group === 'live' && pr.variants.some(v => v.price === 10000), pr);
  const orig = { req: ttsRequest, shops: ttsShops_, auth: ttsGetAuth_ }, calls = [];
  ttsShops_ = () => [{ id: 'SHX', openId: 'o', cipher: 'c' }]; ttsGetAuth_ = () => ({ access_token: 't' });
  ttsRequest = (tok, m, path, q, body) => { calls.push({ m, path, body });
    if (m === 'GET') return { skus: [{ id: 'V1', price: { sale_price: '10000', currency: 'IDR' }, inventory: [{ warehouse_id: 'W', quantity: 5 }] }, { id: 'V2', price: { sale_price: '20000', currency: 'IDR' }, inventory: [{ warehouse_id: 'W', quantity: 3 }] }] };
    return {}; };
  try {
    throws('ubah harga wajib konfirmasi UBAH', () => prodAction_({ action: 'price', items: [{ shopId: 'SHX', productId: 'P9', variantId: 'V1', price: 12000 }] }), /UBAH/);
    prodAction_({ action: 'price', confirm: 'UBAH', items: [{ shopId: 'SHX', productId: 'P9', variantId: 'V1', price: 12000 }] });
    const pc = calls.find(c => /prices\/update$/.test(c.path));
    ok('ubah harga: body skus[{id, price{amount,currency}}] & harga lokal ikut berubah', pc && pc.body.skus[0].id === 'V1' && pc.body.skus[0].price.amount === '12000' && prodList_({ storeCode: 'TTX' }).products.find(x => x.productId === 'P9').variants.find(v => v.id === 'V1').price === 12000, pc);
    throws('hapus varian wajib konfirmasi HAPUS', () => prodAction_({ action: 'delvariant', confirm: 'UBAH', items: [{ shopId: 'SHX', productId: 'P9', variantId: 'V2' }] }), /HAPUS/);
    prodAction_({ action: 'delvariant', confirm: 'HAPUS', items: [{ shopId: 'SHX', productId: 'P9', variantId: 'V2' }] });
    const pe = calls.find(c => /partial_edit$/.test(c.path));
    ok('hapus varian: partial_edit tanpa varian yang dihapus, varian lain tetap', pe && pe.body.skus.length === 1 && pe.body.skus[0].id === 'V1' && prodList_({ storeCode: 'TTX' }).products.find(x => x.productId === 'P9').variants.length === 1, pe && pe.body);
    prodAction_({ action: 'deactivate', confirm: 'UBAH', items: [{ shopId: 'SHX', productId: 'P9' }] });
    const dc = calls.find(c => /deactivate$/.test(c.path));
    ok('nonaktifkan: body product_ids & status lokal jadi nonaktif', dc && dc.body.product_ids[0] === 'P9' && prodList_({ storeCode: 'TTX' }).products.find(x => x.productId === 'P9').group === 'nonaktif');
  } finally { ttsRequest = orig.req; ttsShops_ = orig.shops; ttsGetAuth_ = orig.auth; }
}

{
  // Kapasitas & backup
  TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
  const st = capacityStatus_();
  ok('kapasitas: jumlah sel & persen dari 10 juta, kuota Drive terbaca', st.cells > 0 && st.pct >= 0 && st.drive.limitGb === 15 && st.drive.usedGb === 2, { cells: st.cells, pct: st.pct, drive: st.drive });
  const big = getDatabase_().insertSheet('Kosong_Besar'); big.appendRow(['a']); big.maxR = 5000;
  const freed = capTrim_();
  ok('pangkas baris kosong berlebih (data tidak tersentuh)', freed > 0 && big.getMaxRows() <= 201 + 1 && big.getLastRow() === 1, { freed, max: big.getMaxRows() });
  for (let i = 0; i < 10; i++) capBackupNow_();
  const fo = DriveApp._folders[PropertiesService.getScriptProperties().getProperty('CAP_BACKUP_FOLDER')];
  ok('backup: 10x dibuat, hanya 8 terbaru disimpan (sisanya ke Sampah)', fo.files.filter(f => !f.trashed).length === 8 && fo.files.filter(f => f.trashed).length === 2);
  const org = capOrganize_(), P = PropertiesService.getScriptProperties(), root = P.getProperty('CAP_ROOT_FOLDER');
  ok('folder induk: database & kode dipindah ke "E-Commerce Analytics", Backup & Arsip jadi subfolder', DriveApp._moves.some(m => m[0] === 'MOCKDB' && m[1] === root) && DriveApp._moves.some(m => m[0] === 'SCRIPT1' && m[1] === root) &&
    DriveApp._folders[P.getProperty('CAP_BACKUP_FOLDER')].parent === root && DriveApp._folders[P.getProperty('CAP_ARCHIVE_FOLDER')].parent === root, org.moved);
  throws('kapasitas khusus owner', () => { TEAM_REQUEST_CONTEXT_ = { email: 'a@x.com', role: 'admin' }; try { capacityAction_({ action: 'backup' }); } finally { TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' }; } }, /Owner/);
}

{
  // Izin centang per anggota
  const M = teamMembers_(); M['staf9@gmail.com'] = 'member'; teamProperties_().setProperty('TEAM_MEMBERS_JSON', JSON.stringify(M));
  ok('izin: tanpa pengaturan khusus memakai template peran', JSON.stringify(permOf_('staf9@gmail.com', 'member')) === JSON.stringify(PERM_PRESETS_.member));
  ok('izin: staf (template) tidak boleh ubah/hapus produk & atur kirim', permMethods_('staf9@gmail.com', 'member').indexOf('prodAction') < 0 && permMethods_('staf9@gmail.com', 'member').indexOf('ordShip') < 0);
  permSet_({ email: 'owner@gmail.com', role: 'owner' }, 'staf9@gmail.com', ['pesanan', 'kirim', 'xx'], false);
  const ms = permMethods_('staf9@gmail.com', 'member');
  ok('izin dicentang: hanya pesanan + kirim (kunci asing dibuang), keuangan tidak lagi', ms.indexOf('ordShip') >= 0 && ms.indexOf('ordersList') >= 0 && ms.indexOf('plGetData') < 0 && JSON.stringify(permOf_('staf9@gmail.com', 'member')) === '["pesanan","kirim"]', ms);
  permSet_({ email: 'owner@gmail.com', role: 'owner' }, 'staf9@gmail.com', [], true);
  ok('izin: kembali ke template peran', !permCustom_('staf9@gmail.com') && permMethods_('staf9@gmail.com', 'member').indexOf('plGetData') >= 0);
  throws('izin owner tidak bisa diubah', () => permSet_({ role: 'owner' }, 'owner@gmail.com', [], false), /Owner|belum aktif/);
}

console.log('\nHASIL: ' + PASS + ' lulus, ' + FAIL + ' gagal');
if (FAIL) throw new Error(FAIL + ' uji gagal');
