console.log('\n=== STOK GUDANG PER TOKO ===');
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
const qtyOf = (store, sku) => (stockGet_({ storeCode: store }).items.find(i => i.sku === sku) || { qty: null }).qty;

console.log('\n38. Stok awal & penjualan lama');
const s1 = stockSave_({ storeCode: 'TTX', sku: 'a1', type: 'adj', qty: 100, note: 'stok awal' });
ok('stok awal TTX A1 = 100 (SKU disamakan huruf besar)', s1.after === 100 && qtyOf('TTX', 'A1') === 100, s1.message);
const ap0 = stockApplySales_();
ok('pesanan sebelum stok awal tidak memotong stok', ap0.added === 0 && qtyOf('TTX', 'A1') === 100, ap0.message);

console.log('\n39. Penjualan TikTok memotong stok sekali');
ttsUpsert_('TTS_Orders', [['T|X5', 'S9', 'TTX', 'X5', '2030-01-01T10:00:00', '', '', 'AWAITING_SHIPMENT', 'IDR', 60000, 0, 0, 60000, '', '', '', '', '', '', 3, '', false, '']]);
ttsUpsert_('TTS_OrderLines', [
  ['T|X5|51', 'S9', 'TTX', 'X5', '51', '2030-01-01T10:00:00', 'AWAITING_SHIPMENT', '', '', '', 'A1', 'Polybag', '', 1, 30000, 30000, '', '', 'IDR', ''],
  ['T|X5|52', 'S9', 'TTX', 'X5', '52', '2030-01-01T10:00:00', 'AWAITING_SHIPMENT', '', '', '', 'A1', 'Polybag', '', 1, 30000, 30000, '', '', 'IDR', ''],
  ['T|X5|53', 'S9', 'TTX', 'X5', '53', '2030-01-01T10:00:00', 'AWAITING_SHIPMENT', '', '', '', '', 'Tanpa SKU', '', 1, 1000, 1000, '', '', 'IDR', '']]);
const ap1 = stockApplySales_();
ok('2 item A1 memotong stok → 98; item tanpa SKU dilaporkan', ap1.added === 2 && qtyOf('TTX', 'A1') === 98 && ap1.skippedNoSku === 1, ap1.message);
ok('sinkron ulang tidak memotong lagi', stockApplySales_().added === 0 && qtyOf('TTX', 'A1') === 98);

console.log('\n40. Pesanan dibatalkan → stok kembali');
ttsUpsert_('TTS_Orders', [['T|X5', 'S9', 'TTX', 'X5', '2030-01-01T10:00:00', '', '', 'CANCELLED', 'IDR', 60000, 0, 0, 60000, '', '', '', '', '', '', 3, '', false, '']]);
const ap2 = stockApplySales_();
ok('2 mutasi BATAL_PENJUALAN, stok kembali 100', ap2.added === 2 && qtyOf('TTX', 'A1') === 100, ap2.message);
ok('pembatalan tidak dikembalikan dua kali', stockApplySales_().added === 0 && qtyOf('TTX', 'A1') === 100);

console.log('\n41. KasirKu memotong gudang outlet');
stockSave_({ storeCode: 'OFX', sku: 'BB-MT', type: 'in', qty: 50, note: 'kiriman supplier' });
S.Transactions.appendRow(['KASIRKU:K9:1', new Date(Date.now() + 60000), '2030-01-01', 'KasirKu', 'Media tanam', 70500, 1, 3, 0, 45000, 0, 0, 0, 0, 'KasirKu; Transaction ID=K9; SKU=BB-MT; Mode=offline1', 25500, 25500, 'OFX']);
const ap3 = stockApplySales_();
ok('3 unit KasirKu memotong BB-MT: 50 → 47', qtyOf('OFX', 'BB-MT') === 47, ap3.message);
ok('gudang TTX tidak berubah & tidak memuat SKU OFX', qtyOf('TTX', 'A1') === 100 && qtyOf('TTX', 'BB-MT') === null);
const g = stockGet_({ storeCode: 'OFX' }).items[0];
ok('terjual 7 hari & perkiraan habis dihitung', g.sold7 === 3 && g.daysLeft > 100 && g.status === 'Aman', g);

console.log('\n42. Validasi & akses');
throws('keluar melebihi stok ditolak', () => stockSave_({ storeCode: 'OFX', sku: 'BB-MT', type: 'out', qty: 60 }), /hanya 47/);
ok('penyesuaian ke 0 boleh (hasil hitung fisik)', stockSave_({ storeCode: 'OFX', sku: 'BB-MT', type: 'adj', qty: 0 }).after === 0 && stockGet_({ storeCode: 'OFX' }).items[0].status === 'Habis');
throws('jumlah pecahan ditolak', () => stockSave_({ storeCode: 'OFX', sku: 'BB-MT', type: 'in', qty: 1.5 }), /bilangan bulat/);
as('admin', 'adm@gmail.com'); __env.props.TEAM_STORE_SCOPE_JSON = JSON.stringify({ 'adm@gmail.com': ['TTX'] });
throws('admin TTX ditolak mengubah gudang OFX', () => stockSave_({ storeCode: 'OFX', sku: 'BB-MT', type: 'in', qty: 5 }), /tidak ditugaskan/);
throws('admin TTX ditolak melihat gudang OFX', () => stockGet_({ storeCode: 'OFX' }), /tidak ditugaskan/);
ok('admin TTX boleh mencatat stok TTX', stockSave_({ storeCode: 'TTX', sku: 'A1', type: 'in', qty: 10 }).after === 110);
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
const hist = stockGet_({ storeCode: 'TTX' }).history;
ok('riwayat mutasi tercatat lengkap (manual, penjualan, batal)', ['PENYESUAIAN', 'PENJUALAN', 'BATAL_PENJUALAN', 'MASUK'].every(k => hist.some(h => h.kind === k)));


