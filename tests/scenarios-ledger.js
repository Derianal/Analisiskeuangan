console.log('\n=== PUSAT KEUANGAN: laba rugi per toko ===');
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
finSaveStore_({ code: 'TTX', name: 'TikTok Uji', platform: 'TikTok', branch: 'Pusat' });
finSaveStore_({ code: 'OFX', name: 'Outlet Uji', platform: 'POS/Toko', branch: 'Pusat' });
// Pesanan TikTok tiruan untuk TTX (tanggal tetap)
ttsUpsert_('TTS_Orders', [
  ['T|X1', 'S9', 'TTX', 'X1', '2026-11-02T10:00:00', '', '', 'COMPLETED', 'IDR', 60000, 5000, 5000, 50000, 9000, '', '', '', '', 59000, 2, '', false, ''],
  ['T|X2', 'S9', 'TTX', 'X2', '2026-11-02T11:00:00', '', '', 'AWAITING_SHIPMENT', 'IDR', 30000, 0, 0, 30000, '', '', '', '', '', '', 1, '', false, ''],
  ['T|X3', 'S9', 'TTX', 'X3', '2026-11-02T12:00:00', '', '', 'CANCELLED', 'IDR', 99000, 0, 0, 99000, '', '', '', '', '', '', 1, '', false, '']]);
ttsUpsert_('TTS_OrderLines', [
  ['T|X1|1', 'S9', 'TTX', 'X1', '1', '2026-11-02T10:00:00', 'COMPLETED', '', '', '', 'A1', 'Polybag', '', 1, 30000, 30000, '', '', 'IDR', ''],
  ['T|X1|2', 'S9', 'TTX', 'X1', '2', '2026-11-02T10:00:00', 'COMPLETED', '', '', '', 'B2', 'Paranet', '', 1, 20000, 20000, '', '', 'IDR', ''],
  ['T|X2|1', 'S9', 'TTX', 'X2', '3', '2026-11-02T11:00:00', 'AWAITING_SHIPMENT', '', '', '', 'A1', 'Polybag', '', 1, 30000, 30000, '', '', 'IDR', '']]);
ttsUpsert_('TTS_Finance', [['T|ST|TX9', 'S9', 'TTX', 'ST', 'TX9', 'ORDER', 'X1', '', 'IDR', 50000, -5000, -4000, -1000, '', -2000, '', 43000, '']]);
ttsUpsert_('TTS_Returns', [['T|R9', 'S9', 'TTX', 'R9', 'X1', '2026-11-03T09:00:00', '', 'REFUND', 'REFUND_COMPLETED', '', 'IDR', 10000, 0, 10000, '']]);
// Transaksi KasirKu untuk OFX
S.Transactions.appendRow(['KASIRKU:KX:1', new Date(), '2026-11-02', 'KasirKu', 'Media tanam', 100000, 1, 4, 0, 60000, 0, 0, 0, 0, '', 40000, 40000, 'OFX']);
const E = { endDate: '2026-11-05', days: 10 };
const day = (d, code, dt) => d.daily[code][d.dates.indexOf(dt)];

console.log('\n33. Penjualan & HPP dari TikTok API');
plSaveSkuCost_({ storeCode: '*', sku: 'A1', cost: 15000, from: '2026-11-01', name: 'Polybag' });
let d = plGetData_(E), x = day(d, 'TTX', '2026-11-02');
ok('omzet = sub_total pesanan bukan batal (50.000 + 30.000)', x.gross === 80000 && x.orders === 2, x);
ok('HPP A1 dihitung 2×15.000; B2 tanpa HPP ditandai (20.000 omzet)', x.hpp === 30000 && x.hppMissing === 20000);
ok('potongan platform 5.000 & ongkir 2.000 dari data keuangan TikTok', x.fee === 5000 && x.ship === 2000);
ok('pesanan X2 belum settle → potongan belum diketahui (30.000), bukan 0', x.feePending === 30000);
ok('refund selesai dicatat di tanggal retur (10.000)', day(d, 'TTX', '2026-11-03').ret === 10000);
const tx = plTotals_(d.daily.TTX);
ok('laba BELUM FINAL karena HPP kosong & belum settle', tx.final === false);
plSaveSkuCost_({ storeCode: '*', sku: 'B2', cost: 8000, from: '2026-12-01' });
ok('HPP B2 yang baru berlaku Desember tidak mengubah transaksi November', day(plGetData_(E), 'TTX', '2026-11-02').hppMissing === 20000);
plSaveSkuCost_({ storeCode: 'TTX', sku: 'B2', cost: 7000, from: '2026-10-01' });
x = day(plGetData_(E), 'TTX', '2026-11-02');
ok('HPP khusus toko berlaku → HPP 37.000, tidak ada yang kosong', x.hpp === 37000 && x.hppMissing === 0);

console.log('\n34. KasirKu masuk ke outlet');
x = day(plGetData_(E), 'OFX', '2026-11-02');
ok('omzet 100.000, HPP 60.000 dari KasirKu', x.gross === 100000 && x.hpp === 60000 && x.fee === 0);

console.log('\n35. Biaya per toko, akrual, biaya bersama');
plSaveCost_({ storeCode: 'TTX', group: 'Gaji', category: 'Gaji staf toko', amount: '3.000.000', date: '2026-11-01' });
plSaveCost_({ storeCode: 'TTX', group: 'Iklan', category: 'GMV Max', amount: 50000, date: '2026-11-02' });
plSaveCost_({ shared: true, rule: 'rata', stores: ['TTX', 'OFX'], group: 'Operasional', category: 'Internet', amount: 600000, date: '2026-11-02', spread: 'sekali' });
plSaveCost_({ shared: true, rule: 'omzet', stores: ['TTX', 'OFX'], group: 'Pajak', category: 'PPh Final UMKM 0,5%', amount: 1800, date: '2026-11-02', spread: 'sekali' });
d = plGetData_(E); const a = day(d, 'TTX', '2026-11-02'), b = day(d, 'OFX', '2026-11-02');
ok('gaji bulanan 3 jt → 100.000 per hari (akrual)', a.gaji === 100000 && day(d, 'TTX', '2026-11-05').gaji === 100000);
ok('iklan hanya di tanggalnya (50.000)', a.ads === 50000 && day(d, 'TTX', '2026-11-03').ads === 0);
ok('internet bersama dibagi rata 300.000 / toko', a.ops === 300000 && b.ops === 300000);
ok('pajak bersama dibagi porsi omzet (80rb : 100rb → 800 : 1.000)', a.tax === 800 && b.tax === 1000, [a.tax, b.tax]);
ok('gaji TTX tidak masuk ke OFX', b.gaji === 0);
const pl = plTotals_(d.daily.TTX.slice(d.dates.indexOf('2026-11-02'), d.dates.indexOf('2026-11-02') + 1));
ok('rantai laba: kotor → setelah jual → sebelum pajak → bersih konsisten', pl.grossProfit === 80000 - 37000 && pl.afterSelling === pl.grossProfit - 5000 - 2000 - 50000 && pl.netProfit === pl.afterSelling - 100000 - 300000 - 800, pl);
throws('biaya bersama harus ≥2 toko', () => plSaveCost_({ shared: true, stores: ['TTX'], group: 'Gaji', category: 'x', amount: 1, date: '2026-11-02' }), /minimal 2 toko/);
throws('nominal 0 ditolak', () => plSaveCost_({ storeCode: 'TTX', group: 'Gaji', category: 'x', amount: 0, date: '2026-11-02' }), /lebih dari 0/);
const sumOps = (dd, dt) => Object.keys(dd.daily).reduce((t, c) => t + day(dd, c, dt).ops, 0);
const opsBefore = sumOps(d, '2026-11-02');
finSaveCost_({ date: '2026-11-02', level: 'Pusat', category: 'Sewa', amount: 500000 });
d = plGetData_(E);
ok('biaya Pusat (sewa 500rb akrual 30 hari) dibagi ke semua toko, tidak ada sisa di kantor', Math.abs(sumOps(d, '2026-11-02') - opsBefore - 500000 / 30) < 0.05 && !d.office.unallocated[d.dates.indexOf('2026-11-02')], [sumOps(d, '2026-11-02') - opsBefore]);
finSaveStore_({ code: 'CBX', name: 'Toko Cabang Lain', platform: 'TikTok', branch: 'LAIN' });
const before2 = plGetData_(E), opsTT = day(before2, 'TTX', '2026-11-02').ops, opsCB = day(before2, 'CBX', '2026-11-02').ops;
plSaveCost_({ target: 'cabang', branch: 'Pusat', rule: 'omzet', group: 'Gaji', category: 'Gaji admin bersama', amount: 3000000, date: '2026-11-02', spread: 'bulanan' });
d = plGetData_(E);
ok('biaya Cabang hanya dibebankan ke toko di cabang itu', day(d, 'CBX', '2026-11-02').gaji === day(before2, 'CBX', '2026-11-02').gaji && day(d, 'TTX', '2026-11-02').gaji > day(before2, 'TTX', '2026-11-02').gaji);
ok('daftar toko membawa nama cabang', d.stores.find(x => x.code === 'TTX').branch === 'PUSAT' && d.stores.find(x => x.code === 'CBX').branch === 'LAIN');
throws('biaya cabang tanpa toko aktif ditolak', () => plSaveCost_({ target: 'cabang', branch: 'TIDAKADA', group: 'Gaji', category: 'x', amount: 1, date: '2026-11-02' }), /tidak punya toko aktif/);
ok('tidak ada NaN/Infinity', JSON.stringify(d).indexOf('NaN') < 0 && JSON.stringify(d).indexOf('Infinity') < 0);

console.log('\n36. Batas akses');
as('admin', 'adm@gmail.com'); __env.props.TEAM_STORE_SCOPE_JSON = JSON.stringify({ 'adm@gmail.com': ['TTX'] });
d = plGetData_(E);
ok('admin TTX hanya menerima data TTX, tanpa biaya kantor', d.stores.map(s => s.code).join() === 'TTX' && d.office.visible === false);
throws('admin TTX ditolak mencatat biaya untuk OFX', () => plSaveCost_({ storeCode: 'OFX', group: 'Gaji', category: 'x', amount: 1000, date: '2026-11-02' }), /tidak ditugaskan/);
throws('admin ditolak membuat biaya bersama', () => plSaveCost_({ shared: true, stores: ['TTX', 'OFX'], group: 'Gaji', category: 'x', amount: 1000, date: '2026-11-02' }), /Owner atau Keuangan/);
ok('admin TTX melihat biaya bersama yang menyentuh TTX', plListCosts_({ since: '2026-10-01' }).some(c => c.level === 'Bersama'));
throws('admin ditolak daftar biaya OFX', () => plListCosts_({ storeCode: 'OFX' }), /tidak ditugaskan/);
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };

console.log('\n37. Analis AI menerima laba rugi per toko (agregat)');
__env.props.DATABYTE_API_KEY = 'kunci-uji';
let aiBody = null; const prevFetch = __env.fetchHandler;
__env.fetchHandler = (url, opt) => { if (/databyte/.test(url)) { aiBody = JSON.parse(opt.payload); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"answer":"ok","changes":[]}' } }] }) }; } return prevFetch(url, opt); };
const aiRes = askAnalyticsAI_({ message: 'Toko mana yang boncos?', filters: {} });
__env.fetchHandler = prevFetch;
const ctx = aiBody && aiBody.messages[1].content;
ok('AI menerima labaRugiToko dengan labaBersih & final per toko', aiRes.answer === 'ok' && /labaRugiToko/.test(ctx) && /"toko":"TTX"/.test(ctx) && /labaBersih/.test(ctx) && /"final":/.test(ctx));
ok('konteks AI tanpa token/kunci', !/kunci-uji|AT1|AT2|RT1/.test(JSON.stringify(aiBody.messages)));


