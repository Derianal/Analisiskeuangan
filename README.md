# Pusat Keuangan — E-Commerce Analytics

Aplikasi internal untuk mengelola toko online multi-marketplace (TikTok Shop, Shopee) dan kasir offline dalam satu tempat.
Dibangun dengan **Google Apps Script** dan **Google Sheets** sebagai basis data, sehingga ringan, murah, dan mudah dirawat.

> Ini salinan kode untuk portofolio. Data, token, dan kunci API asli **tidak** disertakan; semuanya disimpan di
> Script Properties pada server, tidak pernah di kode atau halaman.

## Fitur utama

- **Pusat Keuangan**: omzet, laba rugi, margin, ROAS, dan biaya toko per toko maupun gabungan.
- **Sinkron marketplace**: pesanan dan produk TikTok Shop (API 202309) dan Shopee.
- **Pesanan**: atur pengiriman (pickup/drop-off) dan cetak resi massal (A6/A5).
- **Data Produk**: daftar produk live/nonaktif, peringatan harga di bawah HPP, ubah harga, nonaktifkan, atau hapus. Semua aksi wajib dikonfirmasi dan dicatat.
- **Pemetaan SKU**: saran otomatis berdasarkan ukuran, persen, warna (termasuk dari foto varian), dan jenis produk, plus deteksi pemetaan yang salah.
- **SKU Gudang & stok**: HPP, mutasi stok per gudang.
- **Kelola tim**: akses per orang lewat centang per fitur dan per toko. Server selalu memeriksa izin, bukan hanya menyembunyikan tombol.
- **Kapasitas & backup**: pantau batas sel spreadsheet dan kuota Drive, backup mingguan, dan arsip data lama otomatis ke Google Drive.
- **Analis AI**: ringkasan kinerja dari data agregat (tanpa data pribadi pelanggan).
- **Aplikasi Android** ringan (WebView) sebagai peluncur.

## Struktur

| File | Isi |
|---|---|
| `Kode.js` | Entry point web app (`doGet`) |
| `TeamAccess.js`, `Access.js`, `Permissions.js` | Login tim, peran, izin per fitur & toko |
| `TikTokShop.js`, `Shopee.js` | Koneksi & sinkron marketplace |
| `Orders.js`, `Fulfill.js` | Pesanan, pengiriman, resi |
| `ProductData.js`, `SkuMap.js`, `Stock.js` | Produk, pemetaan SKU, stok |
| `Finance.js`, `Ledger.js`, `Summary.js` | Laporan keuangan & arsip |
| `Capacity.js` | Monitor kapasitas, backup, arsip ke Drive |
| `index.html` | Antarmuka (satu halaman, ramah HP) |
| `tests/` | Uji otomatis dengan tiruan (mock) Apps Script |
| `android/` | Aplikasi peluncur Android |

## Menjalankan uji

```bash
node tests/run-tests.js
```

## Memasang sendiri

1. Buat proyek Apps Script, salin semua file `.js` dan `index.html` (bisa memakai [clasp](https://github.com/google/clasp)).
2. Isi Script Properties yang dibutuhkan (kunci aplikasi marketplace dsb.) lewat editor Apps Script — **jangan** di kode.
3. Deploy sebagai Web App, lalu ganti `ID_DEPLOYMENT_ANDA` di `web/pks-login.html` dan aplikasi Android.
4. Untuk APK: buat keystore sendiri dan isi variabel `KS_PASS` sebelum menjalankan `android/build.sh`.


Aplikasi dibuka lewat https://analisiskeuangan.github.io/ (akses dijaga login tim).
