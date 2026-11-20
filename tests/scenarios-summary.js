console.log('\n=== RINGKASAN HARIAN & ARSIP ===');
TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' };
const R = { endDate: '2026-11-05', days: 10 };
const g = (d, code, dt) => d.daily[code][d.dates.indexOf(dt)];

console.log('\n45. Ringkasan = hitungan langsung');
plEnsureFresh_(true);
const viaSummary = plGetData_(R), direct = plComputeSales_(viaSummary.dates);
// Bandingkan komponen penjualan (ads/ops di plGetData_ juga memuat biaya yang dicatat, jadi tidak dibandingkan)
const SALES_F = ['orders', 'gross', 'ret', 'hpp', 'hppMissing', 'fee', 'feePending', 'ship'];
const same = ['TTX', 'OFX'].every(c => viaSummary.dates.every((dt, i) => SALES_F.every(f => Math.abs((viaSummary.daily[c][i][f] || 0) - (direct.daily[c][i][f] || 0)) < 0.01)));
ok('komponen penjualan dari ringkasan sama dengan hitungan langsung dari data mentah', same && g(viaSummary, 'TTX', '2026-11-02').gross === 80000);

console.log('\n46. Halaman tidak membaca data mentah bila tidak ada perubahan');
const saved = S.TTS_Orders.data.map(r => r.slice());
S.TTS_Orders.data.splice(1); // simulasi: data mentah tidak dibaca saat ringkasan masih segar
ok('omzet tetap 80.000 dari ringkasan', g(plGetData_(R), 'TTX', '2026-11-02').gross === 80000);
S.TTS_Orders.data = saved;

console.log('\n47. Perubahan menandai ringkasan & dihitung ulang');
const tok = kasirkuAddDevice_({ storeCode: 'OFX', label: 'Kasir uji ringkasan' }).token;
JSON.parse(doPost({ postData: { contents: JSON.stringify({ token: tok, eventId: 'kasirku.sale.created:KSR-S1', eventType: 'kasirku.sale.created',
  transaction: { id: 'KSR-S1', occurredAt: '2026-11-04T03:00:00Z', total: 15000, items: [{ name: 'Pot', sku: 'POT', qty: 1, price: 15000, cost: 9000, subtotal: 15000, profit: 6000 }] } }) } }).text);
ok('transaksi KasirKu baru langsung tampil (ringkasan dihitung ulang)', g(plGetData_(R), 'OFX', '2026-11-04').gross === 15000);
plSaveSkuCost_({ storeCode: 'TTX', sku: 'A1', cost: 16000, from: '2026-11-02' });
ok('HPP baru berlaku → HPP TTX 2 Nov ikut berubah (16.000 + 7.000)', g(plGetData_(R), 'TTX', '2026-11-02').hpp === 39000);

console.log('\n48. Arsip data lama');
ttsUpsert_('TTS_Orders', [['T|OLD1', 'S9', 'TTX', 'OLD1', '2024-03-05T10:00:00', '', '', 'COMPLETED', 'IDR', 70000, 0, 0, 70000, '', '', '', '', '', '', 1, '', false, '']]);
ttsUpsert_('TTS_OrderLines', [['T|OLD1|1', 'S9', 'TTX', 'OLD1', '1', '2024-03-05T10:00:00', 'COMPLETED', '', '', '', 'A1', 'Polybag', '', 1, 70000, 70000, '', '', 'IDR', '']]);
throws('Admin ditolak mengarsip', () => { as('admin', 'adm@gmail.com'); try { archiveOldData_({ months: 13 }); } finally { TEAM_REQUEST_CONTEXT_ = { email: 'owner@gmail.com', role: 'owner' }; } }, /hanya untuk Owner/);
const pv = archiveOldData_({ months: 13 });
ok('pratinjau: 2 baris (pesanan + item 2024) siap diarsip, belum ada yang dipindah', pv.rows === 2 && rowsOf('TTS_Orders').some(r => r[3] === 'OLD1'), pv.message);
throws('jumlah berbeda dari pratinjau ditolak', () => archiveOldData_({ months: 13, mode: 'apply', expectedRows: 99 }), /berubah sejak pratinjau/);
const ar = archiveOldData_({ months: 13, mode: 'apply', expectedRows: pv.rows });
const arc = Object.values(__env.others).find(x => x.name === 'Arsip E-Commerce 2024');
ok('baris dipindah ke "Arsip E-Commerce 2024" dan hilang dari sheet utama', arc && arc.sheets.TTS_Orders.data.length === 2 && !rowsOf('TTS_Orders').some(r => r[3] === 'OLD1'), ar.message);
ok('laporan Maret 2024 tetap utuh dari ringkasan (omzet 70.000)', g(plGetData_({ endDate: '2024-03-10', days: 10 }), 'TTX', '2024-03-05').gross === 70000);
plEnsureFresh_(true);
ok('hitung ulang penuh tidak menghapus ringkasan tanggal yang sudah diarsip', g(plGetData_({ endDate: '2024-03-10', days: 10 }), 'TTX', '2024-03-05').gross === 70000);
ok('data terbaru tetap di sheet utama', rowsOf('TTS_Orders').some(r => r[3] === 'X1'));
ok('audit arsip tercatat', rowsOf('TeamAudit').some(r => r[3] === 'archive'));


