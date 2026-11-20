console.log('\n=== TAHAP 3: pratinjau, koreksi kolom, pembaruan status ===');
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
const count = n => rowsOf(n).length;

console.log('\n20. Pratinjau tidak menyimpan apa pun');
let snap = [count('ShopAnalytics'), count('GMVMax'), count('FinSales'), count('ImportLog')];
const pvShop = importShopFlexibleRows_({ storeCode: 'S1', fileName: 'p.xlsx', kind: 'summary', dryRun: true, rows: [{ Tanggal: '20/11/2026', GMV: '1.000.000', Pesanan: '5' }, { Tanggal: '10/11/2026', GMV: '400.000', Pesanan: '4' }] });
ok('pratinjau Shop: 1 baru, 1 diperbarui', pvShop.dryRun && pvShop.added === 1 && pvShop.updated === 1, pvShop.message);
ok('pratinjau Shop memuat laporan kolom', pvShop.columns.find(c => c.field === 'date').header === 'Tanggal' && pvShop.columns.find(c => c.field === 'visitors').header === null);
const pvAds = importGmvMaxWithHistory_({ storeCode: 'S1', fileName: 'g.xlsx', dryRun: true, rows: [{ Date: '2026-11-20', Spend: '10.000', Orders: '1', SKU: 'X' }] });
ok('pratinjau GMV Max: 1 baru', pvAds.dryRun && pvAds.added === 1, pvAds.message);
const pvFin = finImportSales_(Object.assign({ dryRun: true }, sales));
ok('pratinjau Keuangan: 0 baru, 3 diperbarui', pvFin.dryRun && pvFin.added === 0 && pvFin.updated === 3, pvFin.message);
ok('tidak ada baris ditulis ke sheet / ImportLog', JSON.stringify(snap) === JSON.stringify([count('ShopAnalytics'), count('GMVMax'), count('FinSales'), count('ImportLog')]), snap);

console.log('\n21. Koreksi kolom manual');
const oddFile = { storeCode: 'S1', fileName: 'aneh.xlsx', kind: 'summary', rows: [{ 'Tgl Laporan': '21/11/2026', 'Nilai Jual': '250.000', 'Order Masuk': '2' }] };
throws('tanpa koreksi: kolom tidak dikenali', () => importShopFlexibleRows_(Object.assign({ dryRun: true }, oddFile)), /tidak valid|tidak ditemukan/);
const fixed = importShopFlexibleRows_(Object.assign({ dryRun: true, columnMap: { date: 'Tgl Laporan', gmv: 'Nilai Jual', orders: 'Order Masuk' } }, oddFile));
ok('dengan koreksi: terbaca & ditandai manual', fixed.added === 1 && fixed.columns.find(c => c.field === 'gmv').manual === true, fixed.sample);
const saved = importShopFlexibleRows_(Object.assign({ columnMap: { date: 'Tgl Laporan', gmv: 'Nilai Jual', orders: 'Order Masuk' } }, oddFile));
ok('disimpan dengan nilai benar (GMV 250.000)', getShopFlexibleAnalytics_({ storeCode: 'S1' }).rows.find(r => r.date === '2026-11-21').gmv === 250000, saved.message);
const finOdd = { fileName: 'fin-aneh.xlsx', defaultStore: 'S1', rows: [{ 'Tgl': '05/11/2026', 'Invoice': 'INV-9', 'Nilai': '30.000', 'Kondisi': 'Selesai' }] };
const finFixed = finImportSales_(Object.assign({ dryRun: true, columnMap: { date: 'Tgl', order: 'Invoice', omzet: 'Nilai', status: 'Kondisi' } }, finOdd));
ok('Keuangan dengan koreksi kolom: 1 baris baru', finFixed.added === 1 && finFixed.sample[0].order === 'INV-9' && finFixed.sample[0].omzet === 30000, finFixed.sample);

console.log('\n22. Pembaruan status: selesai → batal');
const o1 = { fileName: 'st1.xlsx', rows: [{ 'Nama Toko': 'Shopee Petani Kota', 'No. Pesanan': '7001', SKU: 'PB-9', Omzet: '90.000', 'Pendapatan Platform': '80.000', Modal: '50.000', 'Status Pesanan': 'Selesai', Tanggal: '06/11/2026' }] };
finImportSales_(o1);
const before = finGetReport_({ start: '2026-11-06', end: '2026-11-06' }).total.omzet;
const o2 = JSON.parse(JSON.stringify(o1)); o2.rows[0]['Status Pesanan'] = 'Dibatalkan';
const pv2 = finImportSales_(Object.assign({ dryRun: true }, o2));
ok('pratinjau mendeteksi 1 perubahan status', pv2.statusChanged === 1, pv2.message);
const n1 = count('FinSales'); finImportSales_(o2);
const after = finGetReport_({ start: '2026-11-06', end: '2026-11-06' }).total.omzet;
ok('omzet 90.000 → 0 setelah pesanan dibatalkan', before === 90000 && after === 0, [before, after]);
ok('baris tidak bertambah (diperbarui, bukan ditambah)', count('FinSales') === n1);

console.log('\n23. Riwayat impor per toko');
const logOwner = listImportLog_({});
ok('impor Keuangan tercatat di ImportLog', logOwner.some(l => l.source === 'FinSales'));
as('admin', 'adm@gmail.com'); __env.props.TEAM_STORE_SCOPE_JSON = JSON.stringify({ 'adm@gmail.com': ['S1'] });
const logAdm = listImportLog_({});
ok('admin S1 hanya melihat riwayat impor S1', logAdm.length > 0 && logAdm.every(l => l.storeCode.split(',').every(c => c === 'S1')), logAdm.map(l => l.storeCode));
throws('admin S1 ditolak riwayat TT1', () => listImportLog_({ storeCode: 'TT1' }), /tidak ditugaskan/);
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };

console.log('\n24. Kolom yang dikirim browser = kolom yang dibaca server');
const html = require('fs').readFileSync(require('path').join(__testsDir, '..', 'index.html'), 'utf8');
const safeLit = html.match(/const SAFE=(\[[^\]]*\])/);
const SAFE = safeLit ? eval(safeLit[1]) : [];
const nrm = v => String(v || '').trim().toLowerCase().replace(/[\s_\-().%\/]/g, '');
const missing = []; Object.keys(FIN_ALIASES).forEach(k => FIN_ALIASES[k].forEach(a => { if (!SAFE.map(nrm).includes(nrm(a))) missing.push(k + ':' + a); }));
ok('semua alias Keuangan (termasuk status) dikirim browser', missing.length === 0, missing);


