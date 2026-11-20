console.log('\n=== TAHAP 2: akses per toko & pemetaan ===');
TEAM_REQUEST_CONTEXT_ = null;
// Data uji: S1 punya data Shop, TT1 punya data Shop, + 1 baris lama tanpa toko (dari bagian 3, S1 sudah dihapus di bagian 6)
importShopFlexibleRows_({ storeCode: 'S1', fileName: 's1b.xlsx', kind: 'summary', rows: [{ Tanggal: '10/11/2026', GMV: '400.000', Pesanan: '4' }] });
__env.props.TEAM_STORE_SCOPE_JSON = JSON.stringify({ 'adm@gmail.com': ['S1'] });

console.log('\n14. Admin toko S1');
as('admin', 'adm@gmail.com');
const vS = getShopFlexibleAnalytics_({});
ok('admin S1 hanya melihat data S1 saat pilih "semua toko"', vS.rows.length > 0 && vS.rows.every(r => r.storeCode === 'S1'), vS.rows.map(r => r.storeCode));
ok('admin tidak diberi tahu jumlah data lama', vS.unassignedRows === 0);
throws('admin S1 ditolak membuka TT1', () => getShopFlexibleAnalytics_({ storeCode: 'TT1' }), /tidak ditugaskan ke toko TT1/);
throws('admin ditolak membuka data lama tanpa toko', () => getShopFlexibleAnalytics_({ storeCode: 'UNASSIGNED' }), /Owner atau Keuangan/);
throws('admin S1 ditolak impor ke TT1', () => importShopFlexibleRows_({ storeCode: 'TT1', fileName: 'x.xlsx', kind: 'summary', rows: [{ Tanggal: '11/11/2026', GMV: '1' }] }), /tidak ditugaskan/);
const finBefore = rowsOf('FinSales').length;
throws('admin S1 ditolak impor penjualan berisi toko TT1 (semua batal)', () => finImportSales_(sales), /tidak ditugaskan/);
ok('tidak ada baris penjualan tersimpan saat ditolak', rowsOf('FinSales').length === finBefore);
const repA = finGetReport_({ start: '2026-11-01', end: '2026-11-07' });
ok('laporan admin hanya toko S1', repA.stores.every(s => s.code === 'S1') && repA.total.omzet === 100000, repA.total.omzet);
ok('daftar toko admin hanya S1', finListStores_().stores.map(s => s.code).join() === 'S1');
throws('admin ditolak mencatat biaya pusat', () => finSaveCost_({ date: '2026-11-03', level: 'Pusat', category: 'Internet', amount: 5000 }), /Owner atau Keuangan/);
ok('admin boleh biaya toko S1', !!finSaveCost_({ date: '2026-11-04', level: 'Toko', code: 'S1', category: 'Packing', amount: 3000 }).id);
throws('admin ditolak biaya toko TT1', () => finSaveCost_({ date: '2026-11-04', level: 'Toko', code: 'TT1', category: 'Packing', amount: 3000 }), /tidak ditugaskan/);
throws('admin ditolak membaca arsip impor (berisi semua toko)', () => listWorkArchives_(), /Owner atau Keuangan/);
throws('admin ditolak pemetaan data lama', () => migrateLegacy_({ source: 'shop', mode: 'preview' }), /Owner atau Keuangan/);

console.log('\n15. Admin tanpa toko ditugaskan');
as('admin', 'baru@gmail.com');
ok('tidak melihat data apa pun', getShopFlexibleAnalytics_({}).rows.length === 0 && finGetReport_({ start: '2026-11-01', end: '2026-11-07' }).total.omzet === 0);

console.log('\n16. Matriks peran di teamRpc');
TEAM_REQUEST_CONTEXT_ = null;
function sessionFor(email, role) {
  const m = JSON.parse(__env.props.TEAM_MEMBERS_JSON); m[email] = role; __env.props.TEAM_MEMBERS_JSON = JSON.stringify(m);
  const subs = JSON.parse(__env.props.TEAM_GOOGLE_SUBJECTS_JSON); subs[email] = 'sub-' + email; __env.props.TEAM_GOOGLE_SUBJECTS_JSON = JSON.stringify(subs);
  const tok = require('crypto').createHash('sha256').update(email).digest('hex');
  __env.cache['team:session:' + teamHash_(tok)] = JSON.stringify({ email: email, sub: 'sub-' + email, expires: Date.now() + 3600000 });
  return tok;
}
const vw = sessionFor('baca@gmail.com', 'viewer'), fin = sessionFor('uang@gmail.com', 'finance'), adm = sessionFor('adm@gmail.com', 'admin');
throws('Pembaca ditolak impor', () => teamRpc(vw, 'importShopFlexibleRows', [{}]), /tidak diizinkan/);
throws('Pembaca ditolak AI (memakai kuota)', () => teamRpc(vw, 'askAnalyticsAI', [{}]), /tidak diizinkan/);
ok('Pembaca boleh melihat (data kosong karena belum ditugaskan)', teamRpc(vw, 'finGetReport', [{ start: '2026-11-01', end: '2026-11-07' }]).total.omzet === 0);
ok('Keuangan melihat semua toko', teamRpc(fin, 'finGetReport', [{ start: '2026-11-01', end: '2026-11-07' }]).total.omzet === 150000);
throws('Keuangan ditolak mengubah Master Toko', () => teamRpc(fin, 'finSaveStore', [{ code: 'Z9', name: 'z', branch: 'x' }]), /tidak diizinkan/);
throws('Keuangan ditolak menjalankan pemetaan', () => teamRpc(fin, 'migrateLegacy', [{ source: 'shop', mode: 'preview' }]), /tidak diizinkan/);
throws('Admin toko ditolak mengubah Master Toko', () => teamRpc(adm, 'finSaveStore', [{ code: 'Z9', name: 'z', branch: 'x' }]), /tidak diizinkan/);
ok('Admin toko S1 boleh impor ke S1 lewat teamRpc', teamRpc(adm, 'importShopFlexibleRows', [{ storeCode: 'S1', fileName: 'a.xlsx', kind: 'summary', rows: [{ Tanggal: '12/11/2026', GMV: '10.000', Pesanan: '1' }] }]).added === 1);
throws('Admin toko S1 ditolak impor ke TT1 lewat teamRpc', () => teamRpc(adm, 'importShopFlexibleRows', [{ storeCode: 'TT1', fileName: 'a.xlsx', kind: 'summary', rows: [{ Tanggal: '12/11/2026', GMV: '1' }] }]), /tidak ditugaskan/);
ok('getMyAccess admin', JSON.stringify(teamRpc(adm, 'getMyAccess', [])) === JSON.stringify({ email: 'adm@gmail.com', role: 'admin', roleLabel: 'Admin toko', allStores: false, stores: ['S1'], perms: PERM_PRESETS_.admin }));

console.log('\n17. Pemetaan data lama (owner): pratinjau → terapkan → batalkan');
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
const tx = S.Transactions; // 1 baris KasirKu lama (tanpa toko) dari bagian 13 + tambah 2 baris lama
tx.appendRow(['KASIRKU:OLD:1', new Date(), '2026-10-14', 'KasirKu', 'cocoblock', 81000, 1, 3, 0, 52419, 0, 0, 0, 0, '', 28581, 28581]);
tx.appendRow(['MANUAL-1', new Date(), '2026-10-15', 'Shopee', 'polybag', 50000, 1, 1, 0, 30000, 0, 0, 0, 0, '', 20000, 20000]);
const pv = migrateLegacy_({ source: 'transactions', mode: 'preview' });
ok('pratinjau: 3 baris tanpa toko, dikelompokkan per sumber', pv.rows === 3 && pv.groups.find(g => g.label === 'KasirKu').rows === 2, pv);
const pvK = migrateLegacy_({ source: 'transactions', mode: 'preview', label: 'KasirKu' });
ok('pratinjau hanya KasirKu: 2 baris, omzet 162.000', pvK.rows === 2 && pvK.valueTotal === 162000, pvK);
finSaveStore_({ code: 'KG', name: 'Toko Offline', platform: 'POS/Toko', branch: 'Pusat' });
throws('terapkan ditolak bila jumlah tidak sama dengan pratinjau', () => migrateLegacy_({ source: 'transactions', mode: 'apply', label: 'KasirKu', storeCode: 'KG', expectedRows: 5 }), /berubah sejak pratinjau/);
const ap2 = migrateLegacy_({ source: 'transactions', mode: 'apply', label: 'KasirKu', storeCode: 'KG', expectedRows: 2 });
ok('2 baris KasirKu dipetakan ke KG, baris Shopee manual tetap tanpa toko', rowsOf('Transactions').filter(r => r[17] === 'KG').length === 2 && rowsOf('Transactions').find(r => r[0] === 'MANUAL-1')[17] === '', ap2.message);
ok('dashboard toko KG = 162.000', getDashboardData_({ storeCode: 'KG' }).totals.revenue === 162000);
ok('dashboard data lama = 50.000', getDashboardData_({ storeCode: 'UNASSIGNED' }).totals.revenue === 50000);
ok('riwayat migrasi tercatat', listMigrations_()[0].status === 'APPLIED' && listMigrations_()[0].rows === 2);
const un = migrateLegacy_({ source: 'transactions', mode: 'undo', migrationId: ap2.migrationId });
ok('batalkan: 2 baris kembali tanpa toko', un.reverted === 2 && rowsOf('Transactions').filter(r => r[17] === 'KG').length === 0, un.message);
throws('batalkan dua kali ditolak', () => migrateLegacy_({ source: 'transactions', mode: 'undo', migrationId: ap2.migrationId }), /sudah dibatalkan/);
const shopPv = migrateLegacy_({ source: 'shop', mode: 'preview' });
ok('pratinjau Shop: 1 baris lama', shopPv.rows === 1, shopPv);
const shopAp = migrateLegacy_({ source: 'shop', mode: 'apply', storeCode: 'TT1', expectedRows: 1 });
ok('baris Shop lama masuk TT1 dan terlihat di TT1', getShopFlexibleAnalytics_({ storeCode: 'TT1' }).rows.some(r => r.date === '2026-10-17'), shopAp.message);
ok('audit migrasi tercatat', rowsOf('TeamAudit').some(r => r[3] === 'migrate-apply') && rowsOf('TeamAudit').some(r => r[3] === 'migrate-undo'));

console.log('\n18. Toko untuk KasirKu baru');
const ks = setKasirKuStore_('KG');
TEAM_REQUEST_CONTEXT_ = null; // doPost KasirKu tidak punya konteks tim
receiveKasirKuSale_({ eventId: 'kasirku.sale.created:T2', transaction: { id: 'KSR-T2', occurredAt: '2026-11-06T03:00:00Z', total: 23500, items: [{ name: 'MT hias', sku: 'BB-2', qty: 1, price: 23500, cost: 15000, subtotal: 23500, profit: 8500 }] } });
ok('transaksi KasirKu baru tercatat ke KG', rowsOf('Transactions').find(r => r[0] === 'KASIRKU:KSR-T2:1')[17] === 'KG', ks.message);
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
throws('toko KasirKu harus terdaftar', () => setKasirKuStore_('ZZ'), /belum terdaftar/);

console.log('\n19. Kelola tim: tugaskan toko');
TEAM_REQUEST_CONTEXT_ = null;
const ownTok = sessionFor('owner@gmail.com', 'owner');
throws('toko tak dikenal ditolak', () => teamManage(ownTok, 'scope', { email: 'adm@gmail.com', stores: ['S1', 'XX'] }), /tidak ada di Master Toko/);
teamManage(ownTok, 'scope', { email: 'adm@gmail.com', stores: ['S1', 'TT1'] });
ok('admin sekarang S1+TT1', JSON.stringify(teamRpc(adm, 'getMyAccess', []).stores) === '["S1","TT1"]');
throws('Keuangan tidak perlu daftar toko', () => teamManage(ownTok, 'scope', { email: 'uang@gmail.com', stores: ['S1'] }), /otomatis/);
ok('daftar tim memuat peran & toko', teamManage(ownTok, 'list', {}).members.find(m => m.email === 'adm@gmail.com').stores.length === 2);
S.TeamJoinRequests.appendRow(['baca@gmail.com', 'sub-baca@gmail.com', 'approved', '', '', '']);
teamManage(ownTok, 'role', { email: 'baca@gmail.com', role: 'finance' });
ok('Pembaca diubah jadi Keuangan → melihat semua toko', teamRpc(vw, 'getMyAccess', []).allStores === true);
throws('peran owner tidak bisa diberikan lewat Kelola tim', () => teamManage(ownTok, 'role', { email: 'baca@gmail.com', role: 'owner' }), /Peran tidak valid/);


