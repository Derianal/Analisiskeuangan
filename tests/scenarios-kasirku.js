console.log('\n=== PERANGKAT KASIRKU ===');
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
finSaveStore_({ code: 'OF7', name: 'Outlet Tujuh', platform: 'POS/Toko', branch: 'Pusat' });
const post = (token, id, sku, qty) => JSON.parse(doPost({ postData: { contents: JSON.stringify({ token, eventId: 'kasirku.sale.created:' + id, eventType: 'kasirku.sale.created',
  transaction: { id, occurredAt: '2030-02-01T03:00:00Z', total: 20000 * qty, paymentMethod: 'QRIS', items: [{ name: 'Polybag', sku, qty, price: 20000, cost: 12000, subtotal: 20000 * qty, profit: 8000 * qty }] } }) } }).text);

console.log('\n43. Token per perangkat');
const devA = kasirkuAddDevice_({ storeCode: 'OFX', label: 'Kasir depan OFX' });
const devB = kasirkuAddDevice_({ storeCode: 'OF7', label: 'Kasir OF7' });
ok('token dibuat sekali (64 hex) dan hanya hash yang tersimpan', /^[a-f0-9]{64}$/.test(devA.token) && JSON.stringify(S.KasirKu_Perangkat.data).indexOf(devA.token) < 0);
ok('daftar perangkat tidak memuat token', JSON.stringify(kasirkuDevices_()).indexOf(devA.token) < 0 && kasirkuDevices_().devices.length === 2);
const rA = post(devA.token, 'KSR-A1', 'BB-MT', 2), rB = post(devB.token, 'KSR-B1', 'BB-MT', 1);
const rowA = rowsOf('Transactions').find(r => r[0] === 'KASIRKU:KSR-A1:1'), rowB = rowsOf('Transactions').find(r => r[0] === 'KASIRKU:KSR-B1:1');
ok('transaksi perangkat A masuk ke OFX, perangkat B ke OF7', rA.success && rB.success && rowA[17] === 'OFX' && rowB[17] === 'OF7', [rowA && rowA[17], rowB && rowB[17]]);
ok('catatan transaksi memuat ID perangkat', new RegExp('Perangkat=' + devA.id).test(rowA[14]));
ok('kirim ulang event yang sama tidak menggandakan', post(devA.token, 'KSR-A1', 'BB-MT', 2).duplicate === true && rowsOf('Transactions').filter(r => r[0] === 'KASIRKU:KSR-A1:1').length === 1);
const devRow = kasirkuDevices_().devices.find(d => d.id === devA.id);
ok('waktu data terakhir & jumlah event tercatat', devRow.events === 2 && !!devRow.lastSeen, devRow);
__env.props.KASIRKU_BRIDGE_TOKEN = 'c'.repeat(64); // token lama seperti yang sekarang dipakai KasirKu
ok('token lama tetap diterima (masa peralihan)', post(__env.props.KASIRKU_BRIDGE_TOKEN, 'KSR-L1', 'X', 1).success === true);
ok('token asal-asalan ditolak', post('f'.repeat(64), 'KSR-Z1', 'X', 1).success === false);

console.log('\n44. Cabut perangkat & akses');
kasirkuRevokeDevice_({ id: devB.id });
const rv = post(devB.token, 'KSR-B2', 'BB-MT', 1);
ok('token yang dicabut ditolak dengan pesan jelas', rv.success === false && /dicabut/.test(rv.message));
as('admin', 'adm@gmail.com');
throws('admin toko ditolak membuat perangkat', () => kasirkuAddDevice_({ storeCode: 'OFX', label: 'x' }), /Owner atau Keuangan/);
TEAM_REQUEST_CONTEXT_ = null;
const finTok = sessionFor('uang@gmail.com', 'finance');
throws('Keuangan ditolak membuat token lewat teamRpc', () => teamRpc(finTok, 'kasirkuAddDevice', [{ storeCode: 'OFX', label: 'x' }]), /tidak diizinkan/);
ok('Keuangan boleh melihat daftar perangkat', teamRpc(finTok, 'kasirkuDevices', []).devices.length === 2);
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };


