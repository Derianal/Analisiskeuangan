/**
 * TAHAP 3 — DEFINISI KOLOM IMPOR (satu sumber kebenaran)
 * Dipakai untuk: membaca kolom, laporan deteksi kolom di pratinjau, dan koreksi kolom manual.
 * Alias pertama = nama kanonik yang dipakai saat pengguna memetakan kolom secara manual.
 */
const IMPORT_FIELDS_ = {
  shopSummary: [
    { key: 'date', label: 'Tanggal', required: true, aliases: ['date', 'tanggal', 'per hari', 'day'] },
    { key: 'gmv', label: 'GMV / Omzet', aliases: ['gmv', 'gross merchandise value', 'omzet', 'nilai penjualan'] },
    { key: 'orders', label: 'Pesanan', aliases: ['orders', 'pesanan', 'jumlah pesanan'] },
    { key: 'buyers', label: 'Pembeli', aliases: ['buyers', 'pembeli'] },
    { key: 'units', label: 'Produk terjual', aliases: ['units sold', 'produk terjual', 'items sold'] },
    { key: 'refunds', label: 'Refund', aliases: ['refunds', 'refund', 'pengembalian dana'] },
    { key: 'grossRevenue', label: 'Pendapatan bruto', aliases: ['gross revenue', 'pendapatan bruto'] },
    { key: 'pageViews', label: 'Tayangan halaman', aliases: ['page views', 'product page views', 'tayangan halaman'] },
    { key: 'visitors', label: 'Pengunjung', aliases: ['visitors', 'pengunjung'] },
    { key: 'conversionRate', label: 'Tingkat konversi', aliases: ['conversion rate', 'tingkat konversi', 'konversi'] },
    { key: 'impressions', label: 'Impresi produk', aliases: ['product impressions', 'impressions', 'impresi produk'] },
    { key: 'clicks', label: 'Klik produk', aliases: ['product clicks', 'clicks', 'klik produk'] },
    { key: 'aov', label: 'Nilai pesanan rata-rata', aliases: ['aov', 'average order value', 'nilai pesanan rata-rata'] },
    { key: 'affiliateVideoGmv', label: 'GMV video afiliasi', aliases: ['affiliate video gmv', 'gmv from affiliate videos', 'gmv video affiliate', 'gmv dari video afiliasi'] }
  ],
  shopOrders: [
    { key: 'orderId', label: 'Nomor pesanan', required: true, aliases: ['order id', 'order number', 'nomor pesanan', 'no. pesanan', 'no pesanan', 'id pesanan'] },
    { key: 'date', label: 'Waktu pesanan dibuat', required: true, aliases: ['created time', 'order creation time', 'order created time', 'waktu pesanan dibuat', 'waktu pembuatan pesanan', 'tanggal pesanan', 'tanggal dibuat', 'create time', 'date', 'tanggal'] },
    { key: 'total', label: 'Total pesanan', aliases: ['order amount', 'order total', 'total amount', 'total pembayaran', 'total pesanan', 'jumlah pembayaran', 'total payment'] },
    { key: 'line', label: 'Subtotal produk', aliases: ['sku subtotal after discount', 'product subtotal', 'subtotal produk', 'total harga produk', 'subtotal', 'item total'] },
    { key: 'qty', label: 'Jumlah', aliases: ['quantity', 'jumlah', 'qty', 'jumlah produk'] },
    { key: 'status', label: 'Status pesanan', aliases: ['order status', 'status pesanan', 'status'] },
    { key: 'lineId', label: 'ID item / SKU', aliases: ['order item id', 'order line id', 'sub order id', 'sku id', 'seller sku', 'sku reference no.', 'sku penjual', 'nomor referensi sku'] },
    { key: 'currency', label: 'Mata uang', aliases: ['currency', 'mata uang'] }
  ],
  gmvmax: [
    { key: 'date', label: 'Tanggal', required: true, aliases: ['date', 'per hari', 'tanggal', 'day'] },
    { key: 'spend', label: 'Biaya iklan', aliases: ['spend', 'biaya', 'ad spend'] },
    { key: 'orders', label: 'Pesanan', aliases: ['orders', 'pesanan'] },
    { key: 'sku', label: 'SKU', aliases: ['sku', 'toko saat ini', 'pesanan sku toko saat ini', 'pesanan sku'] },
    { key: 'costPerOrder', label: 'Biaya per pesanan', aliases: ['cost per order', 'biaya per pesanan', 'cpo'] },
    { key: 'grossIncome', label: 'Penghasilan bruto (atribusi)', aliases: ['gross income', 'penghasilan bruto'] },
    { key: 'roi', label: 'ROI / ROAS', aliases: ['roi', 'roas'] },
    { key: 'currency', label: 'Mata uang', aliases: ['currency', 'mata uang'] }
  ]
};
/** Kolom penjualan Keuangan dibangun dari FIN_ALIASES agar tidak ada daftar ganda. */
function finImportFields_() {
  const labels = { date: 'Tanggal', store: 'Nama toko', order: 'Nomor pesanan', sku: 'SKU', product: 'Nama produk', qty: 'Jumlah',
    omzet: 'Omzet', income: 'Pendapatan platform', cost: 'Modal / HPP', currency: 'Mata uang', status: 'Status pesanan' };
  return Object.keys(FIN_ALIASES).map(function(k) {
    return { key: k, label: labels[k] || k, required: k === 'date' || k === 'order', aliases: FIN_ALIASES[k] };
  });
}
function importFieldGroup_(group) {
  if (group === 'fin') return finImportFields_();
  const g = IMPORT_FIELDS_[group];
  if (!g) throw new Error('Jenis laporan tidak dikenal.');
  return g;
}
function aliasesOf_(group, key) {
  const f = importFieldGroup_(group).find(function(x) { return x.key === key; });
  if (!f) throw new Error('Kolom ' + key + ' tidak dikenal.');
  return f.aliases;
}
function importHeaderNorm_(k) { return String(k).toLowerCase().replace(/[\s_\-().%\/]/g, ''); }
/** Laporan deteksi: untuk tiap kolom yang dibutuhkan, header file mana yang dipakai (atau tidak ditemukan). */
function detectColumns_(rows, group, columnMap) {
  const fields = importFieldGroup_(group);
  const seen = {};
  (rows || []).slice(0, 50).forEach(function(r) { Object.keys(r || {}).forEach(function(h) { seen[h] = true; }); });
  const headers = Object.keys(seen);
  return fields.map(function(f) {
    let header = null, manual = false;
    if (columnMap && columnMap[f.key]) { header = columnMap[f.key]; manual = true; }
    else for (let i = 0; i < f.aliases.length && !header; i++) {
      const want = importHeaderNorm_(f.aliases[i]);
      header = headers.find(function(h) { return importHeaderNorm_(h) === want; }) || null;
    }
    return { field: f.key, label: f.label, required: !!f.required, header: header, manual: manual };
  });
}
/**
 * Koreksi kolom manual: columnMap = {fieldKey: 'Nama Header di File'}.
 * Header pilihan disalin ke nama kanonik (alias pertama); alias lain untuk kolom itu dibuang agar tidak dobel tafsir.
 */
function applyColumnMap_(rows, group, columnMap) {
  if (!columnMap || typeof columnMap !== 'object') return rows;
  const fields = importFieldGroup_(group);
  const keys = Object.keys(columnMap).filter(function(k) { return columnMap[k] && fields.some(function(f) { return f.key === k; }); });
  if (!keys.length) return rows;
  return rows.map(function(r) {
    const o = Object.assign({}, r);
    keys.forEach(function(k) {
      const f = fields.find(function(x) { return x.key === k; });
      const header = String(columnMap[k]);
      const value = Object.prototype.hasOwnProperty.call(r, header) ? r[header] : '';
      Object.keys(o).forEach(function(h) {
        if (f.aliases.some(function(a) { return importHeaderNorm_(a) === importHeaderNorm_(h); })) delete o[h];
      });
      o[f.aliases[0]] = value;
    });
    return o;
  });
}
/** Riwayat impor (ImportLog) dibatasi pada toko yang boleh dilihat. */
function listImportLog_(opts) {
  opts = opts || {};
  const want = String(opts.storeCode || '').trim().toUpperCase();
  if (want) assertStoreAllowed_(want);
  const ss = ensureImportSheets_();
  const sh = ss.getSheetByName('ImportLog');
  const width = SHEET_HEADERS.ImportLog.length;
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
  const scope = allowedStoreList_();
  return rows.filter(function(r) {
    const codes = String(r[7] || '').split(',').map(function(c) { return c.trim().toUpperCase(); }).filter(Boolean);
    if (want && codes.indexOf(want) < 0) return false;
    if (scope && !codes.length) return false;
    if (scope && codes.some(function(c) { return scope.indexOf(c) < 0; })) return false;
    return true;
  }).map(function(r) {
    const t = r[1] instanceof Date ? Utilities.formatDate(r[1], 'Asia/Jakarta', 'yyyy-MM-dd HH:mm') : String(r[1]);
    return { importId: String(r[0]), time: t, source: String(r[2]), file: String(r[3]), rows: numOrNull_(r[4]), status: String(r[5]),
      note: String(r[6] || ''), storeCode: String(r[7] || ''), added: numOrNull_(r[8]), updated: numOrNull_(r[9]), skipped: numOrNull_(r[10]), by: String(r[11] || '') };
  }).reverse().slice(0, Math.min(Number(opts.limit) || 50, 200));
}
/** Daftar kolom (tanpa data) untuk layar koreksi kolom di browser. */
function getImportFields_(group) {
  return importFieldGroup_(group).map(function(f) { return { key: f.key, label: f.label, required: !!f.required }; });
}
