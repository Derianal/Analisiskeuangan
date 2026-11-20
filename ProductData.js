/**
 * Tab "Data Produk": daftar produk TikTok (live / nonaktif / lainnya) per varian dengan harga, stok, HPP & margin.
 * Aksi (pemilik saja, konfirmasi wajib, dicatat di Produk_Log):
 *   ubah harga      POST   /product/202309/products/{product_id}/prices/update  body {skus:[{id, price:{amount, currency}}]}
 *   nonaktifkan     POST   /product/202309/products/deactivate                  body {product_ids:[…]} (maks 20)
 *   aktifkan        POST   /product/202309/products/activate                    body {product_ids:[…]}
 *   hapus produk    DELETE /product/202309/products                             body {product_ids:[…]}
 *   hapus varian    GET detail → POST partial_edit dengan SEMUA varian KECUALI yang dihapus (varian yang tidak dikirim = dihapus)
 * Nama field dicocokkan dengan SDK resmi TikTok Shop (Product 202309).
 * Margin di sini = harga jual − HPP (belum dikurangi biaya admin/ongkir/iklan) — bukan laba bersih.
 */
const PROD_STATUS_GROUP_ = { ACTIVATE: 'live', SELLER_DEACTIVATED: 'nonaktif', PLATFORM_DEACTIVATED: 'nonaktif', FREEZE: 'nonaktif' };
const PROD_LOG_HEADERS_ = ['Waktu', 'Oleh', 'Toko', 'Product ID', 'Produk', 'Aksi', 'Detail', 'Hasil', 'Pesan'];

function prodList_(p) {
  p = p || {};
  const scope = allowedStoreList_(), want = String(p.storeCode || '').toUpperCase();
  const map = {}; skuMapRows_().forEach(function(r) { map[String(r[0])] = r; });
  const hppAt = plSkuIndex_(), today = plToday_(), prods = {}, counts = { all: 0, live: 0, nonaktif: 0, lainnya: 0 };
  plSheetRows_('TTS_Products', 15).forEach(function(r) {
    const store = String(r[2] || '').toUpperCase();
    if (!store || (scope && scope.indexOf(store) < 0) || (want && store !== want)) return;
    const k = r[1] + '|' + r[3], m = map['tts|' + r[4]] || [];
    const pr = prods[k] || (prods[k] = { key: k, shopId: String(r[1]), store: store, productId: String(r[3]), title: String(r[6] || m[6] || ''),
      status: String(r[7] || ''), group: PROD_STATUS_GROUP_[String(r[7])] || 'lainnya', img: String(m[11] || ''), variants: [], below: 0, noHpp: 0 });
    if (!pr.img && m[11]) pr.img = String(m[11]);
    const price = numOrNull_(r[9]) !== null ? numOrNull_(r[9]) : numOrNull_(r[10]);
    const internal = String(m[8] || ''), sku = internal || String(r[5] || '');
    const hpp = sku ? hppAt(store, sku, today) : null;
    const margin = price !== null && hpp !== null ? price - hpp : null;
    const v = { id: String(r[4]), name: String(m[7] || '') || '(nama varian belum diambil)', img: String(m[12] || ''), sellerSku: String(r[5] || ''),
      internalSku: internal, price: price, currency: String(r[8] || 'IDR'), stock: numOrNull_(r[11]), hpp: hpp, margin: margin,
      marginPct: margin !== null && price ? Math.round(margin / price * 1000) / 10 : null, below: margin !== null && margin < 0 };
    if (v.below) pr.below++; if (hpp === null) pr.noHpp++;
    pr.variants.push(v);
  });
  const list = Object.keys(prods).map(function(k) { return prods[k]; });
  list.forEach(function(pr) { counts.all++; counts[pr.group]++; pr.variants.sort(function(a, b) { return a.name.localeCompare(b.name); }); });
  list.sort(function(a, b) { return b.below - a.below || a.title.localeCompare(b.title); });
  return { products: list, counts: counts, today: today };
}

function prodLog_(row) {
  try { const ss = getDatabase_(), sh = ss.getSheetByName('Produk_Log') || ss.insertSheet('Produk_Log');
    if (!sh.getLastRow()) sh.appendRow(PROD_LOG_HEADERS_); sh.appendRow(row); } catch (e) { /* log gagal tidak membatalkan */ }
}
function prodRowsDelete_(name, width, test) {
  const sh = getDatabase_().getSheetByName(name); if (!sh || sh.getLastRow() < 2) return 0;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues(); let n = 0;
  for (let i = v.length - 1; i >= 0; i--) if (test(v[i])) { sh.deleteRow(i + 2); n++; }
  return n;
}
function prodTok_(shopId) {
  const s = ttsShops_().find(function(x) { return x.id === String(shopId); }), auth = s && ttsGetAuth_(s.openId);
  if (!s || !auth) throw new Error('Token toko tidak ditemukan — hubungkan ulang di Koneksi Toko.');
  return { cipher: s.cipher, accessToken: auth.access_token };
}

/**
 * p: {action:'price'|'deactivate'|'activate'|'delete'|'delvariant', items:[{shopId, productId, variantId?, price?}], deleteSku:bool, confirm}
 * Harga & status → konfirmasi 'UBAH'. Hapus → 'HAPUS'.
 */
function prodAction_(p) {
  // Hak: izin "produk_ubah" (dicek di teamRpc). Toko dibatasi lewat prodList_ (hanya toko dalam akses pengguna).
  p = p || {};
  const action = String(p.action || ''), items = (p.items || []).slice(0, 300);
  const need = action === 'delete' || action === 'delvariant' ? 'HAPUS' : 'UBAH';
  if (['price', 'deactivate', 'activate', 'delete', 'delvariant'].indexOf(action) < 0) throw new Error('Aksi tidak dikenal.');
  if (String(p.confirm || '') !== need) throw new Error('Ketik ' + need + ' untuk konfirmasi.');
  if (!items.length) throw new Error('Pilih produk/varian dulu.');
  // Pastikan semua produk ada di data & dalam akses
  const known = {}; prodList_({}).products.forEach(function(pr) { known[pr.key] = pr; });
  const byProd = {};
  items.forEach(function(it) { const k = it.shopId + '|' + it.productId; if (!known[k]) throw new Error('Produk ' + it.productId + ' tidak ditemukan. Sinkron ulang dulu.');
    (byProd[k] = byProd[k] || []).push(it); });
  const keys = Object.keys(byProd);
  if (keys.length > 20) throw new Error('Maksimal 20 produk sekali proses.');
  const actor = currentActorEmail_(), out = [], deadline = Date.now() + 240000, gone = {}, statusSet = {}, priceSet = {};
  if (action === 'deactivate' || action === 'activate' || action === 'delete') {
    const byShop = {}; keys.forEach(function(k) { const pr = known[k]; (byShop[pr.shopId] = byShop[pr.shopId] || []).push(pr); });
    Object.keys(byShop).forEach(function(shopId) {
      const prs = byShop[shopId], ids = prs.map(function(x) { return x.productId; });
      let res = 'GAGAL', msg = '', failed = {};
      try {
        const tok = prodTok_(shopId);
        const r = action === 'delete' ? ttsRequest(tok, 'DELETE', '/product/202309/products', {}, { product_ids: ids })
          : ttsRequest(tok, 'POST', '/product/202309/products/' + action, {}, { product_ids: ids });
        ((r && r.errors) || []).forEach(function(e) { const id = String(e.detail && e.detail.product_id || ''); failed[id || '*'] = e.message || String(e.code); });
        res = 'BERHASIL';
      } catch (e) { msg = e.message; }
      prs.forEach(function(pr) {
        const err = res !== 'BERHASIL' ? msg : (failed[pr.productId] || failed['*'] || '');
        const ok = !err;
        if (ok && action === 'delete') pr.variants.forEach(function(v) { gone[v.id] = true; });
        if (ok && action !== 'delete') statusSet[pr.key] = action === 'deactivate' ? 'SELLER_DEACTIVATED' : 'ACTIVATE';
        out.push({ product: pr.title.slice(0, 80), store: pr.store, result: ok ? 'BERHASIL' : 'GAGAL', message: ok ? { delete: 'Produk dihapus dari TikTok.', deactivate: 'Produk dinonaktifkan.', activate: 'Produk diaktifkan (bisa masuk peninjauan TikTok).' }[action] : err });
        prodLog_([new Date(), actor, pr.store, pr.productId, pr.title.slice(0, 200), action.toUpperCase(), pr.variants.length + ' varian', ok ? 'BERHASIL' : 'GAGAL', String(ok ? '' : err).slice(0, 500)]);
      });
    });
  } else {
    keys.forEach(function(k) {
      const pr = known[k], list = byProd[k], name = pr.title.slice(0, 80);
      if (Date.now() > deadline) { out.push({ product: name, result: 'DILEWATI', message: 'Waktu habis — ulangi untuk sisanya.' }); return; }
      let res = 'GAGAL', msg = '', detail = '';
      try {
        const tok = prodTok_(pr.shopId);
        if (action === 'price') {
          const skus = list.map(function(it) {
            const v = pr.variants.find(function(x) { return x.id === String(it.variantId); });
            const price = Math.round(Number(it.price));
            if (!v) throw new Error('Varian ' + it.variantId + ' tidak ditemukan.');
            if (!(price > 0)) throw new Error('Harga ' + v.name + ' tidak valid.');
            detail += v.name + ': ' + (v.price === null ? '?' : v.price) + ' → ' + price + '; ';
            priceSet[pr.shopId + '|' + pr.productId + '|' + v.id] = price;
            return { id: v.id, price: { amount: String(price), currency: v.currency || 'IDR' } };
          });
          ttsRequest(tok, 'POST', '/product/202309/products/' + encodeURIComponent(pr.productId) + '/prices/update', {}, { skus: skus });
          res = 'BERHASIL'; msg = skus.length + ' harga varian diubah.';
        } else {   // delvariant
          const ids = list.map(function(it) { return String(it.variantId); });
          const d = ttsRequest(tok, 'GET', '/product/202309/products/' + encodeURIComponent(pr.productId), {}, null);
          const live = (d.skus || []).map(function(x) { return String(x.id); }), del = ids.filter(function(id) { return live.indexOf(id) >= 0; });
          detail = pr.variants.filter(function(v) { return ids.indexOf(v.id) >= 0; }).map(function(v) { return v.name; }).join('; ');
          if (!del.length) { res = 'BERHASIL'; msg = 'Varian sudah tidak ada di TikTok.'; ids.forEach(function(id) { gone[id] = true; }); }
          else if (del.length >= live.length) {
            const r = ttsRequest(tok, 'DELETE', '/product/202309/products', {}, { product_ids: [pr.productId] });
            if (((r && r.errors) || []).length) throw new Error(r.errors.map(function(e) { return e.message || e.code; }).join('; '));
            res = 'BERHASIL'; msg = 'Semua varian dipilih → produk dihapus dari TikTok.'; live.forEach(function(id) { gone[id] = true; });
          } else {
            const built = skuEditBuildBody_(d, {});
            if (built.unsupported.length) throw new Error('Produk punya ' + built.unsupported.filter(function(v, i, a) { return a.indexOf(v) === i; }).join(', ') + ' — hapus varian manual di Seller Center.');
            built.body.skus = built.body.skus.filter(function(x) { return del.indexOf(String(x.id)) < 0; });
            ttsRequest(tok, 'POST', '/product/202309/products/' + encodeURIComponent(pr.productId) + '/partial_edit', {}, built.body);
            res = 'BERHASIL'; msg = del.length + ' varian dihapus, ' + built.body.skus.length + ' varian lain tetap. Produk masuk peninjauan TikTok.';
            del.forEach(function(id) { gone[id] = true; });
          }
        }
      } catch (e) { msg = e.message; }
      out.push({ product: name, store: pr.store, result: res, message: msg });
      prodLog_([new Date(), actor, pr.store, pr.productId, pr.title.slice(0, 200), action.toUpperCase(), detail.slice(0, 1000), res, String(msg).slice(0, 500)]);
    });
  }
  // Perbarui data lokal agar tampilan langsung sesuai (sinkron berikutnya tetap jadi acuan)
  const cleaned = { variants: 0, skus: [] };
  withScriptLock_(function() {
    const sh = getDatabase_().getSheetByName('TTS_Products');
    if (sh && sh.getLastRow() > 1 && (Object.keys(statusSet).length || Object.keys(priceSet).length)) {
      const v = sh.getRange(2, 1, sh.getLastRow() - 1, 15).getValues();
      v.forEach(function(r, i) {
        const st = statusSet[r[1] + '|' + r[3]]; if (st) sh.getRange(i + 2, 8).setValue(st);
        const pz = priceSet[r[1] + '|' + r[3] + '|' + r[4]]; if (pz !== undefined) sh.getRange(i + 2, 10, 1, 2).setValues([[pz, pz]]);
      });
    }
    const g = Object.keys(gone); if (!g.length) return;
    const usedBefore = {}; skuMapRows_().forEach(function(r) { if (r[1] === 'TikTok' && gone[String(r[5])] && r[8]) usedBefore[plSkuKey_(r[8])] = String(r[8]); });
    cleaned.variants = prodRowsDelete_('TTS_Products', 15, function(r) { return gone[String(r[4])]; });
    prodRowsDelete_('SKU_Map', SKU_MAP_HEADERS.length, function(r) { return r[1] === 'TikTok' && gone[String(r[5])]; });
    if (p.deleteSku) {
      // SKU gudang hanya dihapus bila sudah tidak dipakai varian mana pun (TikTok/Shopee) setelah penghapusan
      const still = {}; skuMapRows_().forEach(function(r) { if (r[8]) still[plSkuKey_(r[8])] = true; });
      Object.keys(usedBefore).forEach(function(k) {
        if (still[k]) { cleaned.skus.push({ sku: usedBefore[k], kept: true }); return; }
        const h = prodRowsDelete_('HPP_SKU', PL_SKU_HEADERS.length, function(r) { return plSkuKey_(r[1]) === k; });
        const m = prodRowsDelete_('Stok_Mutasi', STOCK_HEADERS.length, function(r) { return plSkuKey_(r[3]) === k; });
        cleaned.skus.push({ sku: usedBefore[k], hppRows: h, stockRows: m });
        prodLog_([new Date(), actor, '*', '', usedBefore[k], 'HAPUS SKU GUDANG', '', 'BERHASIL', h + ' baris HPP, ' + m + ' baris stok']);
      });
    }
  });
  return { results: out, cleaned: cleaned };
}
