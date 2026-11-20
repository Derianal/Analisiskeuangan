let PASS = 0, FAIL = 0;
function ok(label, cond, info) { if (cond) PASS++; else FAIL++; console.log((cond ? '  LULUS  ' : '  GAGAL  ') + label + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
function throws(label, fn, re) { try { fn(); ok(label, false, 'tidak error'); } catch (e) { ok(label, !re || re.test(e.message), e.message); } }
function noBadNumbers(label, obj) { const s = JSON.stringify(obj, (k, v) => (typeof v === 'number' && !isFinite(v)) ? '__BAD__' : v); ok(label, s.indexOf('__BAD__') < 0 && s.indexOf('NaN') < 0); }
const S = __env.sheets;
function rowsOf(name) { const sh = S[name]; return sh ? sh.data.slice(1).filter(r => r.some(v => v !== '' && v != null)) : []; }
function as(role, email) { TEAM_REQUEST_CONTEXT_ = { email: email || role + '@gmail.com', role: role }; }

setupDatabase_(); // membuat sheet kosong di database tiruan
console.log('\n1. Parser angka & tanggal');
[['1.250.000', 1250000], ['1.234', 1234], ['Rp 12.500', 12500], ['1,250,000', 1250000], ['2.500,50', 2500.5], ['', null], [null, null], ['-', null], ['abc', null], ['(5.000)', -5000], [0, 0]]
  .forEach(([i, w]) => ok('importNum_(' + JSON.stringify(i) + ') = ' + w, importNum_(i) === w, importNum_(i)));
ok('tanggal 02/11/2026 dibaca 2 Nov (format Indonesia)', normalizeImportDate_('02/11/2026') === '2026-11-02', normalizeImportDate_('02/11/2026'));
ok('tanggal 31/02/2026 ditolak', normalizeImportDate_('31/02/2026') === '');
ok('serial Excel 46328 = 2026-11-02', normalizeImportDate_(46328) === '2026-11-02', normalizeImportDate_(46328));

console.log('\n2. Master toko');
as('owner', 'owner@gmail.com');
finSaveStore_({ code: 'S1', name: 'Shopee Petani Kota', platform: 'Shopee', branch: 'Pusat' });
finSaveStore_({ code: 'TT1', name: 'TikTok Petani Kota', platform: 'TikTok', branch: 'Pusat', dataMethod: 'API' });
const st = finListStores_().stores;
ok('dua toko tersimpan', st.length === 2);
ok('toko metode API ditandai belum terhubung (tidak diklaim aktif)', st.find(s => s.code === 'TT1').syncStatus === 'API belum terhubung');

console.log('\n3. Impor Shop per toko, impor ulang, data lama');
// data lama tanpa kolom toko (simulasi baris sebelum migrasi, 17 kolom)
ensureImportSheets_();
S.ShopAnalytics.appendRow(['OLD', new Date(), 'lama.xlsx', '2026-10-17', 0, 0, 0, 0, 0, 0, 9, 2, 0, 112, 11, 0, 0]);
const shopFile = { fileName: 'shop_s1.xlsx', kind: 'summary', rows: [
  { Tanggal: '01/11/2026', GMV: '1.250.000', Pesanan: '10', Pengunjung: '1.234', 'Klik Produk': '' },
  { Tanggal: '02/11/2026', GMV: '500.000', Pesanan: '4', Pengunjung: '', 'Klik Produk': '' } ] };
throws('impor tanpa memilih toko ditolak', () => importShopFlexibleRows_(shopFile), /Pilih toko/);
ok('penolakan tidak menambah data', rowsOf('ShopAnalytics').length === 1);
throws('impor ke toko tak terdaftar ditolak', () => importShopFlexibleRows_(Object.assign({ storeCode: 'XX' }, shopFile)), /belum terdaftar/);
const r1 = importShopFlexibleRows_(Object.assign({ storeCode: 'S1' }, shopFile));
ok('impor pertama: 2 baris baru', r1.added === 2 && r1.updated === 0, r1.message);
const r2 = importShopFlexibleRows_(Object.assign({ storeCode: 'S1' }, shopFile));
ok('impor ULANG file sama: 0 baru, 2 diperbarui', r2.added === 0 && r2.updated === 2, r2.message);
ok('jumlah baris tetap 3 (2 S1 + 1 lama)', rowsOf('ShopAnalytics').length === 3);
importShopFlexibleRows_({ storeCode: 'TT1', fileName: 'shop_tt1.xlsx', kind: 'summary', rows: [{ Tanggal: '01/11/2026', GMV: '300.000', Pesanan: '3' }] });
const s1 = getShopFlexibleAnalytics_({ storeCode: 'S1' }).summary, tt = getShopFlexibleAnalytics_({ storeCode: 'TT1' }).summary;
const all = getShopFlexibleAnalytics_({}).summary, legacy = getShopFlexibleAnalytics_({ storeCode: 'UNASSIGNED' });
ok('GMV S1 = 1.750.000 (tidak tercampur TT1)', s1.gmv === 1750000, s1.gmv);
ok('GMV TT1 = 300.000 pada tanggal yang sama', tt.gmv === 300000, tt.gmv);
ok('Semua toko = 2.050.000 (S1+TT1+lama 0)', all.gmv === 2050000, all.gmv);
ok('pengunjung S1 = 1.234 (bukan 1,234)', s1.visitors === 1234, s1.visitors);
ok('klik kosong → null (tidak tersedia), bukan 0', s1.clicks === null && s1.clickRate === null, s1.clicks);
ok('TT1 tanpa kolom pengunjung → null', tt.visitors === null);
ok('data lama tanpa toko ditandai, tidak masuk ke S1', legacy.rows.length === 1 && legacy.unassignedRows === 1);
noBadNumbers('ringkasan tanpa NaN/Infinity', [s1, tt, all]);

console.log('\n4. Detail pesanan Shop (status batal)');
const det = importShopFlexibleRows_({ storeCode: 'S1', fileName: 'orders.xlsx', kind: 'orders', rows: [
  { 'Order ID': 'A1', 'Created Time': '05/11/2026 10:00', 'Order Amount': '100.000', 'Order Status': 'Completed', 'Seller SKU': 'PB-1', Quantity: 2 },
  { 'Order ID': 'A2', 'Created Time': '05/11/2026 11:00', 'Order Amount': '80.000', 'Order Status': 'Cancelled', 'Seller SKU': 'PB-1', Quantity: 1 } ] });
const d5 = getShopFlexibleAnalytics_({ storeCode: 'S1' }).rows.find(r => r.date === '2026-11-05');
ok('pesanan batal tidak masuk GMV (100.000, 1 pesanan)', d5 && d5.gmv === 100000 && d5.orders === 1, d5);
ok('metrik yang tidak ada di laporan detail = null', d5.visitors === null && d5.buyers === null);

console.log('\n5. GMV Max per toko');
const ads = { fileName: 'gmv.xlsx', rows: [{ Date: '2026-11-01', Spend: '50.000', Orders: '2', SKU: 'PB-1', 'Gross income': '250.000', ROI: '5', Currency: 'IDR' },
  { Date: '2026-11-01', Spend: '20.000', Orders: '0', SKU: 'PN-2', 'Gross income': '0', ROI: '', Currency: 'IDR' }] };
importGmvMaxWithHistory_(Object.assign({ storeCode: 'S1' }, ads));
const a2 = importGmvMaxWithHistory_(Object.assign({ storeCode: 'S1' }, ads));
ok('impor ulang GMV Max tidak dobel', a2.added === 0 && a2.updated === 2, a2.message);
const ap = getAdsPerformanceData_({ storeCode: 'S1' });
ok('ROAS S1 = 250.000/70.000', Math.abs(ap.summary.roi - 250000 / 70000) < 1e-9, ap.summary.roi);
ok('CPA SKU tanpa pesanan = null (bukan 0/Infinity)', ap.bySku.find(x => x.sku === 'PN-2').cpa === null);
ok('GMV Max TT1 kosong', getAdsPerformanceData_({ storeCode: 'TT1' }).summary.spend === null);

console.log('\n6. Hapus data satu toko');
const logBefore = rowsOf('ImportLog').length;
throws('hapus tanpa pilih toko ditolak', () => clearImportedAnalytics_('shop', ''), /Pilih toko/);
const cl = clearImportedAnalytics_('shop', 'S1');
ok('data S1 terhapus, TT1 & data lama tetap', getShopFlexibleAnalytics_({ storeCode: 'S1' }).rows.length === 0 && getShopFlexibleAnalytics_({ storeCode: 'TT1' }).rows.length === 1 && getShopFlexibleAnalytics_({ storeCode: 'UNASSIGNED' }).rows.length === 1, cl.message);
ok('riwayat ImportLog tidak dihapus, penghapusan dicatat', rowsOf('ImportLog').length === logBefore + 1 && rowsOf('ImportLog').slice(-1)[0][5] === 'CLEARED');

console.log('\n7. Keuangan: ID pesanan sama di dua toko, impor ulang, batal');
const sales = { fileName: 'bigseller.xlsx', rows: [
  { 'Nama Toko': 'Shopee Petani Kota', 'No. Pesanan': '1001', SKU: 'PB-1', Produk: 'Polybag 35x35', Qty: 10, Omzet: '100.000', 'Pendapatan Platform': '90.000', Modal: '60.000', 'Status Pesanan': 'Selesai', Tanggal: '03/11/2026' },
  { 'Nama Toko': 'TikTok Petani Kota', 'No. Pesanan': '1001', SKU: 'PB-1', Produk: 'Polybag 35x35', Qty: 5, Omzet: '50.000', 'Pendapatan Platform': '45.000', Modal: '', 'Status Pesanan': 'Selesai', Tanggal: '03/11/2026' },
  { 'Nama Toko': 'Shopee Petani Kota', 'No. Pesanan': '1002', SKU: 'PN-2', Produk: 'Paranet', Qty: 1, Omzet: '70.000', 'Pendapatan Platform': '63.000', Modal: '40.000', 'Status Pesanan': 'Batal', Tanggal: '03/11/2026' } ] };
const f1 = finImportSales_(sales), f2 = finImportSales_(sales);
ok('impor pertama: 3 baris disimpan, 1 berstatus batal', f1.added === 3 && f1.excludedStatus === 1, f1.message);
ok('impor ulang: 0 baru, 3 diperbarui', f2.added === 0 && f2.updated === 3, f2.message);
ok('pesanan 1001 tersimpan terpisah per toko', rowsOf('FinSales').filter(r => r[3] === '1001').map(r => r[2]).sort().join() === 'S1,TT1');
const rep = finGetReport_({ start: '2026-11-01', end: '2026-11-07' });
ok('omzet total 150.000 (batal tidak dihitung)', rep.total.omzet === 150000, rep.total.omzet);
ok('modal TT1 kosong → laba BELUM FINAL, margin null', rep.total.complete === false && rep.total.margin === null && rep.total.netMargin === null);
ok('S1 lengkap → margin S1 dihitung 30%', Math.abs(rep.stores.find(s => s.code === 'S1').margin - 30) < 1e-9);
ok('teks WA menulis "BELUM FINAL"', /BELUM FINAL/.test(finReportText_({ start: '2026-11-01', end: '2026-11-07' }).text));
noBadNumbers('laporan tanpa NaN/Infinity', rep);
const empty = finGetReport_({ start: '2025-01-01', end: '2025-01-31' });
ok('periode kosong: margin null, laba 0 tanpa NaN', empty.total.margin === null && empty.total.netProfit === 0);

console.log('\n8. Biaya: batal (bukan hapus) + audit sebelum/sesudah');
const c = finSaveCost_({ date: '2026-11-03', level: 'Toko', code: 'S1', category: 'Iklan', amount: '10.000' });
finSaveCost_({ id: c.id, date: '2026-11-03', level: 'Toko', code: 'S1', category: 'Iklan', amount: '12.000' });
ok('biaya iklan masuk laporan (12.000)', finGetReport_({ start: '2026-11-01', end: '2026-11-07' }).total.ads === 12000);
finDeleteCost_(c.id);
ok('biaya dibatalkan tidak masuk laporan', finGetReport_({ start: '2026-11-01', end: '2026-11-07' }).total.ads === 0);
ok('baris biaya tetap ada berstatus DIBATALKAN', rowsOf('FinCosts').length === 1 && rowsOf('FinCosts')[0][9] === 'DIBATALKAN');
throws('biaya yang dibatalkan tidak bisa diedit', () => finSaveCost_({ id: c.id, date: '2026-11-03', level: 'Toko', code: 'S1', category: 'Iklan', amount: '1' }), /dibatalkan/);
const audit = rowsOf('TeamAudit').filter(r => r[6] === c.id);
ok('audit mencatat buat, ubah, batal + nilai sebelum/sesudah', audit.map(r => r[3]).join() === 'cost-create,cost-update,cost-cancel' && /10000/.test(audit[1][7]) && /12000/.test(audit[1][8]), audit.map(r => r[3]));

console.log('\n9. Produk: nonaktif bukan hapus');
const p = saveProduct_({ name: 'Polybag 35x35', price: 1000, cogs: 600 });
deleteProduct_(p.id);
ok('produk hilang dari daftar aktif, baris tetap ada', listProducts_().length === 0 && rowsOf('Products').length === 1);

console.log('\n10. Dashboard transaksi kosong');
const dash = getDashboardData_({ startDate: '2026-11-01', endDate: '2026-11-07' });
ok('margin tanpa omzet = null (bukan 0%)', dash.netMargin === null && dash.roas === null);
noBadNumbers('dashboard tanpa NaN/Infinity', dash);

console.log('\n11. Izin server (teamRpc)');
TEAM_REQUEST_CONTEXT_ = null;
__env.props.TEAM_MEMBERS_JSON = JSON.stringify({ 'owner@gmail.com': 'owner', 'mem@gmail.com': 'member' });
__env.props.TEAM_GOOGLE_SUBJECTS_JSON = JSON.stringify({ 'mem@gmail.com': 'sub-mem' });
const sess = 'a'.repeat(64);
__env.cache['team:session:' + teamHash_(sess)] = JSON.stringify({ email: 'mem@gmail.com', sub: 'sub-mem', expires: Date.now() + 3600000 });
throws('member ditolak mengimpor penjualan', () => teamRpc(sess, 'finImportSales', [sales]), /tidak diizinkan/);
throws('member ditolak menghapus data impor', () => teamRpc(sess, 'clearImportedAnalytics', ['shop', 'TT1']), /tidak diizinkan/);
ok('member boleh membaca laporan', !!teamRpc(sess, 'finGetReport', [{ start: '2026-11-01', end: '2026-11-07' }]).total);
throws('tanpa sesi ditolak', () => teamRpc('', 'finGetReport', [{}]), /LOGIN_REQUIRED/);

console.log('\n12. Uji bawaan modul keuangan');
const origLog = console.log; let inner = []; console.log = m => inner.push(m);
const builtIn = ujiKeuangan_(); console.log = origLog;
ok('ujiKeuangan_ lulus', builtIn, inner.filter(x => /GAGAL/.test(x)));

console.log('\n13. KasirKu tidak berubah: kirim ulang tidak dobel');
const ev = { eventId: 'kasirku.sale.created:T1', transaction: { id: 'KSR-T1', occurredAt: '2026-11-05T03:00:00Z', total: 81000, paid: 90000, change: 9000,
  items: [{ name: 'cocoblock 2,5kg', sku: 'BB-1', qty: 3, price: 27000, cost: 17473, subtotal: 81000, profit: 28581 }] } };
const k1 = receiveKasirKuSale_(ev), k2 = receiveKasirKuSale_(ev);
ok('event pertama masuk 1 baris, kirim ulang 0 baris', k1.rowsImported === 1 && k2.rowsImported === 0 && k2.duplicate === true);
ok('Transactions berisi 1 baris', rowsOf('Transactions').length === 1);


