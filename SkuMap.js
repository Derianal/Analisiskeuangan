/**
 * Pemetaan SKU — menghubungkan varian produk di marketplace (TikTok sku_id / Shopee item+model)
 * ke SKU internal (kode di daftar HPP & gudang). TIDAK mengubah apa pun di TikTok/Shopee.
 * Urutan pakai SKU untuk HPP: pemetaan → Seller SKU marketplace → ID varian.
 */
const SKU_MAP_HEADERS = ['key', 'platform', 'shop_id', 'store_code', 'product_id', 'variant_id', 'product_name', 'variant_name', 'internal_sku', 'updated_by', 'updated_at', 'product_img', 'variant_img'];
let SKU_MAP_CACHE_ = null;

function skuMapSheet_() {
  const ss = getDatabase_();
  let sh = ss.getSheetByName('SKU_Map');
  if (!sh) sh = ss.insertSheet('SKU_Map');
  if (!sh.getLastRow()) { sh.getRange(1, 1, 1, SKU_MAP_HEADERS.length).setValues([SKU_MAP_HEADERS]); sh.setFrozenRows(1); }   // sheet ada tapi kosong → tulis judul
  else if (sh.getLastColumn() < SKU_MAP_HEADERS.length) sh.getRange(1, 1, 1, SKU_MAP_HEADERS.length).setValues([SKU_MAP_HEADERS]);   // kolom gambar ditambahkan belakangan
  return sh;
}
function skuMapRows_() {
  const sh = getDatabase_().getSheetByName('SKU_Map');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, SKU_MAP_HEADERS.length).getValues();
}
/** key varian → SKU internal (di-cache selama satu eksekusi). */
function skuMapIndex_() {
  if (SKU_MAP_CACHE_) return SKU_MAP_CACHE_;
  const m = {};
  skuMapRows_().forEach(function(r) { if (r[0] && String(r[8] || '').trim()) m[String(r[0])] = String(r[8]).trim(); });
  SKU_MAP_CACHE_ = m;
  return m;
}
function skuMapKeyTts_(skuId) { return 'tts|' + String(skuId || '').trim(); }
function skuMapKeySp_(itemId, modelId) { return 'sp|' + String(itemId || '').trim() + '|' + String(modelId && String(modelId) !== '0' ? modelId : '').trim(); }

/** Kata kunci untuk saran: huruf kecil, dipisah non-alfanumerik; angka+satuan digabung (25 cm → 25cm). */
function skuMapTokens_(s) {
  const unit = { gram: 'g', gr: 'g', g: 'g', kg: 'kg', liter: 'l', l: 'l', ml: 'ml', meter: 'm', m: 'm', cm: 'cm', pcs: 'pcs' };
  return String(s || '').toLowerCase().replace(/(\d+)\s*(cm|liter|kg|gram|gr|ml|meter|pcs|g|l|m)\b/g, function(_, n, u) { return n + unit[u]; })
    .split(/[^a-z0-9%]+/).filter(function(t) { return t && t.length > 1 || /\d/.test(t); })
    .reduce(function(out, t) { out.push(t); const m = t.match(/^(\d+)[a-z]+$/); if (m && out.indexOf(m[1]) < 0) out.push(m[1]); return out; }, []);
}
/** Normalisasi nama untuk mengelompokkan produk yang sama di banyak toko. */
function skuMapNorm_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim(); }
/** Kata penting judul katalog (tanpa angka & kata umum) untuk mengenali katalog lain dari barang yang sama. */
const SKU_STOP_ = ('dan untuk dengan yang atau di ke dari isi pcs pack paket premium alami asli murah promo ready stok stock original ori kualitas terbaik pilihan ' +
  'utuh kering bumbu masak rempah herbal minuman 100 gram gr kg').split(' ');
let SKU_COMMON_WORDS_ = {};
function skuMapTitleTokens_(t) {
  const out = {}; skuMapNorm_(t).split(' ').forEach(function(w) { if (w.length > 2 && !/^\d/.test(w) && SKU_STOP_.indexOf(w) < 0 && !SKU_COMMON_WORDS_[w]) out[w] = true; });
  return out;
}
/** Varian belum dipetakan → SKU dari varian lain yang nama variannya sama & judul katalognya mirip (≥ 60% kata penting sama). */
function skuMapSimilar_(x, refs) {
  if (!x.variant || !x.product) return null;
  const v = skuMapNorm_(x.variant), t = skuMapTitleTokens_(x.product), tk = Object.keys(t);
  if (!tk.length) return null;
  // Persen (75% vs 85/90%) dari nama varian, kalau tidak ada dari judul katalog; harus cocok dengan persen di SKU.
  const al = skuPctAlias_(), fv = skuFeat_(x.variant, al), xp = Object.keys(fv.pct).length ? fv.pct : skuFeat_(x.product, al).pct;
  const score = {};
  refs.forEach(function(r) {
    if (r.v !== v) return;
    const rp = skuFeat_(String(r.sku).replace(/-/g, ' '), al).pct;
    if (Object.keys(rp).length && Object.keys(xp).length && !skuShare_(rp, xp)) return;
    const rk = Object.keys(r.t); if (!rk.length) return;
    const common = tk.filter(function(w) { return r.t[w]; }).length, ov = common / Math.min(tk.length, rk.length);
    // ≥2 kata penting sama; atau semua kata penting judul yang lebih pendek sama & judulnya ringkas (mis. "Biji Pala … Kue")
    const ok = (common >= 2 && ov >= 0.5) || (common >= 1 && ov === 1 && Math.max(tk.length, rk.length) <= 4);
    if (ok) score[r.sku] = Math.max(score[r.sku] || 0, ov);
  });
  const ks = Object.keys(score).sort(function(a, b) { return score[b] - score[a]; });
  if (!ks.length) return null;
  return { sku: ks[0], score: Math.round(score[ks[0]] * 100), ambiguous: ks.length > 1 && score[ks[1]] === score[ks[0]] && plSkuKey_(ks[1]) !== plSkuKey_(ks[0]) };
}
/* ===== Saran berdasarkan ciri barang: ukuran (3M X 10M = 3x10), persen (85% dianggap 90%), warna, jenis (polos/terpal) =====
 * Untuk barang seperti paranet yang nama variannya beda-beda tulisan di tiap katalog. */
/** Persen yang dianggap barang sama (permintaan pemilik: 85% = 90%). Bisa diubah lewat Script Property SKU_PERSEN_SETARA, mis. "85=90,80=75". */
function skuPctAlias_() {
  const raw = PropertiesService.getScriptProperties().getProperty('SKU_PERSEN_SETARA') || '85=90', m = {};
  raw.split(',').forEach(function(p) { const a = p.split('='); if (a.length === 2 && +a[0] && +a[1]) m[String(+a[0])] = String(+a[1]); });
  return m;
}
const SKU_COLORS_ = { hitam: 'hitam', black: 'hitam', coffe: 'coffe', coffee: 'coffe', kopi: 'coffe', coklat: 'coffe', cokelat: 'coffe', brown: 'coffe',
  cream: 'cream', krem: 'cream', putih: 'putih', white: 'putih', hijau: 'hijau', green: 'hijau', silver: 'silver' };
function skuFeat_(text, alias) {
  const t = String(text || '').toLowerCase().replace(/tanpa\s*terpal/g, ' polos ').replace(/(\d{2,3})\s*persen/g, '$1%'), f = { dims: {}, pct: {}, color: {}, kind: {} };
  t.replace(/(\d+(?:[.,]\d+)?)\s*m?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(?:m\b)?/g, function(_, a, b) { f.dims[(+a.replace(',', '.')) + 'x' + (+b.replace(',', '.'))] = true; return _; });
  t.replace(/(\d{2,3})\s*%?\s*(?:[-\/]|s\.?d\.?)\s*(\d{2,3})\s*%|(\d{2,3})\s*%/g, function(_, a, b, c) {
    [a, b, c].forEach(function(n) { if (n) { const k = String(+n); f.pct[alias[k] || k] = true; } }); return _; });
  t.split(/[^a-z]+/).forEach(function(w) { if (SKU_COLORS_[w]) f.color[SKU_COLORS_[w]] = true; if (w === 'polos') f.kind.polos = true; if (w === 'terpal' || w === 'terpa' || w === 'terpalhitam') f.kind.terpal = true; });
  if (/terpal/.test(t)) f.kind.terpal = true;
  return f;
}
function skuKeys_(o) { return Object.keys(o); }
/** Ciri sebuah varian marketplace: ukuran, persen, warna, terpal/polos. Tanpa tulisan "terpal" = polos (aturan pemilik). */
function skuXInfo_(x, alias) {
  const fv = skuFeat_(x.variant, alias), ft = skuFeat_(x.product, alias);
  let dk = skuKeys_(fv.dims);
  const noVar = !x.variant || /tanpa varian/i.test(x.variant);
  if (!dk.length && noVar && skuKeys_(ft.dims).length === 1) dk = skuKeys_(ft.dims);     // produk tanpa varian: ukuran dari judul
  const pct = skuKeys_(fv.pct).length ? fv.pct : ft.pct, color = skuKeys_(fv.color).length ? fv.color : ft.color;
  let terpal = !!(fv.kind.terpal || ft.kind.terpal);
  if (terpal && fv.kind.polos) terpal = false;
  if (terpal && !fv.kind.terpal && ft.kind.polos && !/list\s*terpal/i.test(x.variant || '')) terpal = false;
  return { dim: dk.length === 1 ? dk[0] : '', pct: pct, color: color, terpal: terpal, fv: fv, ft: ft };
}
/** SKU yang sudah dipetakan tapi cirinya bertentangan dengan varian → alasan (untuk ditandai merah). */
function skuMapConflict_(x, alias) {
  if (!x.internalSku) return null;
  const i = skuXInfo_(x, alias), f = skuFeat_(String(x.internalSku).replace(/-/g, ' '), alias), out = [];
  const sd = skuKeys_(f.dims);
  if (i.dim && sd.length && !f.dims[i.dim]) out.push('ukuran (' + i.dim + ' vs ' + sd.join('/') + ')');
  if (!!f.kind.terpal !== i.terpal && (sd.length || f.kind.terpal)) out.push(i.terpal ? 'jenis (varian terpal, SKU polos)' : 'jenis (tidak ada tulisan terpal, SKU terpal)');
  if (skuKeys_(f.pct).length && skuKeys_(i.pct).length && !skuShare_(f.pct, i.pct)) out.push('persen');
  if (skuKeys_(f.color).length && skuKeys_(i.color).length && !skuShare_(f.color, i.color)) out.push('warna');
  return out.length ? out : null;
}
function skuShare_(a, b) { return skuKeys_(a).some(function(k) { return b[k]; }); }
/** x: baris varian; cands: [{sku, f}]. Hasil {sku, score, ambiguous} atau null. Ukuran wajib sama persis. */
function skuMapFeatSuggest_(x, cands, alias) {
  const info = skuXInfo_(x, alias);
  if (!info.dim) return null;                                          // ukuran tidak jelas → tidak ditebak
  const dim = info.dim, pct = info.pct, color = info.color;
  const kind = info.terpal ? { terpal: true } : { polos: true };        // aturan pemilik: tidak ada tulisan "terpal" = polos
  const scored = [];
  cands.forEach(function(c) {
    if (!c.f.dims[dim]) return;
    if (!!c.f.kind.terpal !== !!kind.terpal) return;                   // polos ≠ terpal (list terpal)
    const cp = skuKeys_(c.f.pct), xp = skuKeys_(pct);
    if (cp.length && xp.length && !skuShare_(c.f.pct, pct)) return;    // 75% ≠ 90%
    const cc = skuKeys_(c.f.color), xc = skuKeys_(color);
    if (cc.length && xc.length && !skuShare_(c.f.color, color)) return; // hitam ≠ coffe
    let score = 60 + (cp.length && xp.length ? 20 : 0) + (cc.length && xc.length ? 15 : 0) + (kind.polos && c.f.kind.polos ? 5 : 0);
    // data penting tidak ada di salah satu sisi → kurang yakin
    if (cp.length !== xp.length && (cp.length || xp.length)) score -= 10;
    if (cc.length && !xc.length) score -= 10;
    scored.push({ sku: c.sku, score: score });
  });
  if (!scored.length) return null;
  scored.sort(function(a, b) { return b.score - a.score; });
  const top = scored[0], tops = scored.filter(function(s) { return s.score === top.score; }), tie = tops.length > 1;
  const out = { sku: top.sku, score: Math.min(95, top.score), ambiguous: tie || top.score < 80 };
  // Seri karena warna tidak tertulis → kirim pilihan warna; browser membaca warna dari foto varian lalu memilih yang cocok.
  if (tie && !skuKeys_(color).length) {
    const byColor = {}; tops.forEach(function(s) { const cf = cands.find(function(c) { return c.sku === s.sku; }).f.color, ck = skuKeys_(cf);
      if (ck.length === 1 && !byColor[ck[0]]) byColor[ck[0]] = s.sku; });
    if (skuKeys_(byColor).length > 1) out.colorAlts = byColor;
  }
  return out;
}
/** Belum ada SKU yang cocok → usulkan NAMA SKU BARU mengikuti pola SKU yang sudah ada (jenis & panjang sejenis),
 *  dengan ukuran/warna/persen diganti sesuai varian. Hanya usulan — tidak otomatis diisi "Pakai semua saran". */
function skuMapProposeNew_(x, cands, alias) {
  const info = skuXInfo_(x, alias); if (!info.dim) return null;
  const dim = info.dim, len = Number(dim.split('x')[1]), long = len >= 50;
  const pct = info.pct, color = info.color, terpal = info.terpal;
  const pool = cands.filter(function(c) { const cd = skuKeys_(c.f.dims); return cd.length === 1 && !!c.f.kind.terpal === terpal && (Number(cd[0].split('x')[1]) >= 50) === long; });
  if (!pool.length) return null;
  const xp = skuKeys_(pct), xc = skuKeys_(color);
  pool.sort(function(a, b) {
    const sa = (xp.length && skuShare_(a.f.pct, pct) ? 2 : 0) + (xc.length && skuShare_(a.f.color, color) ? 2 : 0) + (a.f.color.hitam ? 0.5 : 0);
    const sb = (xp.length && skuShare_(b.f.pct, pct) ? 2 : 0) + (xc.length && skuShare_(b.f.color, color) ? 2 : 0) + (b.f.color.hitam ? 0.5 : 0);
    return sb - sa || a.sku.localeCompare(b.sku); });
  const base = pool[0];
  let name = base.sku.replace(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i, dim);
  if (xc.length === 1 && !base.f.color[xc[0]]) { const bc = skuKeys_(base.f.color)[0]; if (bc) name = name.replace(new RegExp(bc === 'coffe' ? 'coff?ee?' : bc, 'i'), xc[0]); }
  if (xp.length === 1 && !base.f.pct[xp[0]]) name = name.replace(/(\d{2,3})(\s*%)/, xp[0] + '$2');
  if (cands.some(function(c) { return plSkuKey_(c.sku) === plSkuKey_(name); })) return null;
  const check = []; if (!xc.length && skuKeys_(base.f.color).length) check.push('warna'); if (!xp.length && skuKeys_(base.f.pct).length) check.push('persen');
  return { sku: name, check: check };
}
function skuMapSuggest_(text, catalog) {
  const a = skuMapTokens_(text); if (!a.length) return null;
  const setA = {}; a.forEach(function(t) { setA[t] = true; });
  // Skor = bagian kata SKU internal yang ditemukan di nama produk+varian (judul marketplace panjang tidak menurunkan skor).
  const better = function(x, y) { return !y || x.score > y.score || (x.score === y.score && x.hit > y.hit); };
  let best = null, second = null;
  catalog.forEach(function(c) {
    if (!c.tokens.length) return;
    let hit = 0, numHit = 0, numMiss = 0;
    c.tokens.forEach(function(t) { if (setA[t]) { hit++; if (/\d/.test(t)) numHit++; } else if (/^\d/.test(t)) numMiss++; });
    if (hit < 2 || numMiss > 0 && numMiss >= numHit) return;           // ukuran/angka berbeda → bukan produk sama
    const cand = { sku: c.sku, score: hit / c.tokens.length, hit: hit };
    if (better(cand, best)) { second = best; best = cand; } else if (better(cand, second)) second = cand;
  });
  if (!best || best.score < 0.5) return null;
  best.ambiguous = !!(second && plSkuKey_(second.sku) !== plSkuKey_(best.sku) && second.score === best.score && second.hit === best.hit);
  return best;
}

/** Daftar varian marketplace + status pemetaan + saran. */
function skuMapList_(p) {
  p = p || {};
  const scope = allowedStoreList_();
  const allowed = function(code) { return !scope || scope.indexOf(String(code || '').toUpperCase()) >= 0; };
  const v = {};
  const put = function(key, o) { const x = v[key] || (v[key] = { key: key, platform: o.platform, shopId: '', storeCode: '', productId: '', variantId: '', product: '', variant: '', sellerSku: '', sold: 0, internalSku: '' });
    ['shopId', 'storeCode', 'productId', 'variantId', 'product', 'variant', 'sellerSku'].forEach(function(f) { if (o[f] && !x[f]) x[f] = String(o[f]); });
    if (o.sold) x.sold += o.sold; return x; };
  const db = getDatabase_();
  if (db.getSheetByName('TTS_Products')) plSheetRows_('TTS_Products', 15).forEach(function(r) {
    put(skuMapKeyTts_(r[4]), { platform: 'TikTok', shopId: r[1], storeCode: r[2], productId: r[3], variantId: r[4], sellerSku: r[5], product: r[6] }); });
  if (db.getSheetByName('TTS_OrderLines')) plSheetRows_('TTS_OrderLines', 20).forEach(function(r) {
    if (!r[9]) return; put(skuMapKeyTts_(r[9]), { platform: 'TikTok', shopId: r[1], storeCode: r[2], productId: r[8], variantId: r[9], sellerSku: r[10], product: r[11], variant: r[12], sold: 1 }); });
  if (db.getSheetByName('SP_OrderLines')) plSheetRows_('SP_OrderLines', 18).forEach(function(r) {
    if (String(r[0]).indexOf('live|') !== 0) return;
    put(skuMapKeySp_(r[7], r[8]), { platform: 'Shopee', shopId: r[1], storeCode: r[2], productId: r[7], variantId: r[8], sellerSku: r[10] || r[9], product: r[11], variant: r[12], sold: numOrNull_(r[13]) || 1 }); });
  skuMapRows_().forEach(function(r) {
    const x = put(String(r[0]), { platform: r[1], shopId: r[2], storeCode: r[3], productId: r[4], variantId: r[5], product: r[6], variant: r[7] });
    x.internalSku = String(r[8] || '');
    x.productImg = String(r[11] || ''); x.variantImg = String(r[12] || '');
  });
  // Katalog SKU internal dari HPP_SKU
  const seen = {}, catalog = [];
  const addCat = function(sku, name) { const s = String(sku || '').trim(); const k = plSkuKey_(s); if (s && !seen[k]) { seen[k] = true; catalog.push({ sku: s, tokens: skuMapTokens_(s + ' ' + (name || '')) }); } };
  plSheetRows_('HPP_SKU', PL_SKU_HEADERS.length).forEach(function(r) { addCat(r[1], r[2]); });
  (p.extraCatalog || []).forEach(function(x) { addCat(x); });   // SKU dari tempelan HPP yang belum disimpan
  const rows = Object.keys(v).map(function(k) { return v[k]; }).filter(function(x) { return allowed(x.storeCode); });
  // Kelompok: produk + varian bernama sama di toko mana pun = satu barang → cukup dipetakan sekali.
  const hppAt = plSkuIndex_(), today = plToday_();
  const groupSku = {};
  rows.forEach(function(x) {
    // Hanya varian yang nama katalog DAN nama variannya sama persis yang digabung. Nama varian kosong (belum diambil) → tidak digabung,
    // supaya varian berbeda (mis. 10 g vs 50 g) tidak tersambung ke satu SKU gudang.
    x.group = skuMapNorm_(x.product) + '|' + skuMapNorm_(x.variant) + (x.product && x.variant ? '' : '|' + x.key);
    if (x.internalSku) { const g = groupSku[x.group] || (groupSku[x.group] = {}); g[x.internalSku] = (g[x.internalSku] || 0) + 1; }
  });
  // Referensi: varian yang SUDAH dipetakan (judul katalog + nama varian → SKU) untuk menyarankan katalog lain yang mirip.
  // Kata yang muncul di banyak judul (mis. nama merek toko) tidak dipakai untuk menilai kemiripan.
  SKU_COMMON_WORDS_ = {};
  const titles = {}; rows.forEach(function(x) { if (x.product) titles[skuMapNorm_(x.product)] = true; });
  const tl = Object.keys(titles), df = {}; tl.forEach(function(t) { Object.keys(skuMapTitleTokens_(t)).forEach(function(w) { df[w] = (df[w] || 0) + 1; }); });
  SKU_COMMON_WORDS_ = {}; if (tl.length >= 8) Object.keys(df).forEach(function(w) { if (df[w] / tl.length > 0.5) SKU_COMMON_WORDS_[w] = true; });
  // Kandidat saran-ciri: SKU di daftar HPP + SKU gudang yang sudah dipakai di pemetaan (hanya yang punya ukuran, mis. 3x10).
  const pctAlias = skuPctAlias_(), fSeen = {}, featCands = [];
  catalog.map(function(c) { return c.sku; }).concat(rows.map(function(x) { return x.internalSku; })).forEach(function(sku) {
    const k = plSkuKey_(sku); if (!sku || fSeen[k]) return; fSeen[k] = true;
    const f = skuFeat_(String(sku).replace(/-/g, ' '), pctAlias); if (skuKeys_(f.dims).length) featCands.push({ sku: sku, f: f }); });
  const refs = rows.filter(function(x) { return x.internalSku && x.variant; }).map(function(x) { return { sku: x.internalSku, v: skuMapNorm_(x.variant), t: skuMapTitleTokens_(x.product) }; });
  rows.forEach(function(x) {
    if (!x.internalSku) {
      const g = groupSku[x.group];
      const sim = g ? null : skuMapSimilar_(x, refs);
      if (g) { const top = Object.keys(g).sort(function(a, b) { return g[b] - g[a]; })[0]; x.suggest = top; x.score = 100; x.sameGroup = true; }   // sudah dipetakan di toko lain
      else if (sim) { x.suggest = sim.sku; x.score = sim.score; x.fromSimilar = true; x.ambiguous = sim.ambiguous; }       // katalog lain yang mirip, varian sama
      else {
        const fs = skuMapFeatSuggest_(x, featCands, pctAlias);
        if (fs) { x.suggest = fs.sku; x.score = fs.score; x.ambiguous = fs.ambiguous; x.fromFeat = true; if (fs.colorAlts) x.colorAlts = fs.colorAlts; }
        else { const s = skuMapSuggest_(x.product + ' ' + x.variant + ' ' + x.sellerSku, catalog); if (s) { x.suggest = s.sku; x.score = Math.round(s.score * 100); x.ambiguous = s.ambiguous; }
          else { const nw = skuMapProposeNew_(x, featCands, pctAlias); if (nw) { x.newSku = nw.sku; x.newCheck = nw.check; } } }
      }
    }
    x.namesMissing = x.platform === 'TikTok' && !x.variant;
    const cf = skuMapConflict_(x, pctAlias); if (cf) x.conflict = cf;
    if (x.internalSku) { const c = hppAt(x.storeCode, x.internalSku, today); x.hpp = c; }   // HPP berlaku hari ini (null = belum ada)
  });
  rows.sort(function(a, b) { return (a.internalSku ? 1 : 0) - (b.internalSku ? 1 : 0) || b.sold - a.sold || a.product.localeCompare(b.product); });
  return { rows: rows, catalog: catalog.map(function(c) { return c.sku; }).sort(), mapped: rows.filter(function(x) { return x.internalSku; }).length,
    namesMissing: rows.filter(function(x) { return x.namesMissing; }).length };
}

/** Simpan pemetaan (hanya di aplikasi). items: [{key, internalSku}] — internalSku kosong = hapus pemetaan. */
function skuMapSave_(p) {
  p = p || {};
  const items = (p.items || []).slice(0, 2000);
  if (!items.length) throw new Error('Tidak ada pemetaan untuk disimpan.');
  const list = skuMapList_({}), byKey = {}; list.rows.forEach(function(x) { byKey[x.key] = x; });
  const actor = currentActorEmail_(), now = new Date();
  let changed = 0;
  withScriptLock_(function() {
    const sh = skuMapSheet_(), rows = skuMapRows_(), idx = {};
    rows.forEach(function(r, i) { idx[String(r[0])] = i; });
    const append = [];
    items.forEach(function(it) {
      const x = byKey[String(it.key)]; if (!x) return;                 // hanya varian yang terlihat oleh akun ini
      const sku = String(it.internalSku || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      const row = [x.key, x.platform, x.shopId, x.storeCode, x.productId, x.variantId, x.product.slice(0, 300), x.variant.slice(0, 200), sku, actor, now, x.productImg || '', x.variantImg || ''];
      if (idx[x.key] !== undefined) { if (String(rows[idx[x.key]][8] || '') === sku) return; sh.getRange(idx[x.key] + 2, 1, 1, row.length).setValues([row]); }
      else { if (!sku) return; append.push(row); }
      changed++;
    });
    if (append.length) ensureRoom_(sh, append.length, SKU_MAP_HEADERS.length).getRange(sh.getLastRow() + 1, 1, append.length, SKU_MAP_HEADERS.length).setValues(append);
  });
  SKU_MAP_CACHE_ = null;
  if (changed) { plMarkDirty_(''); auditChange_('sku-map', 'SKU_Map', changed + ' varian', null, { count: changed }); }
  return { ok: true, changed: changed, message: changed ? changed + ' pemetaan disimpan. Laba dihitung ulang otomatis. Produk di TikTok/Shopee tidak diubah.' : 'Tidak ada perubahan.' };
}

/** Ambil nama varian TikTok (hanya BACA dari API: Get Product) untuk varian yang belum punya nama. */
function skuMapFetchNames_() {
  assertAllStoresScope_('Ambil nama varian');
  const list = skuMapList_({}), need = {};
  list.rows.forEach(function(x) { if (x.platform === 'TikTok' && (x.namesMissing || !x.productImg) && x.productId && x.shopId) (need[x.shopId + '|' + x.productId] = need[x.shopId + '|' + x.productId] || x); });
  const shops = {}; ttsShops_().forEach(function(s) { shops[s.id] = s; });
  const deadline = Date.now() + 240000, names = {}; let done = 0, failed = 0, left = 0;
  Object.keys(need).forEach(function(k) {
    if (Date.now() > deadline) { left++; return; }
    const x = need[k], s = shops[x.shopId]; if (!s) return;
    const auth = ttsGetAuth_(s.openId); if (!auth) { failed++; return; }
    try {
      const d = ttsRequest({ cipher: s.cipher, accessToken: auth.access_token }, 'GET', '/product/202309/products/' + encodeURIComponent(x.productId), {}, null);
      (d.skus || []).forEach(function(sk) {
        const pick = function(img) { return img ? String((img.thumb_urls || [])[0] || (img.urls || [])[0] || '') : ''; };
        const vImg = (sk.sales_attributes || []).map(function(a) { return pick(a.sku_img); }).filter(String)[0] || '';
        names[skuMapKeyTts_(sk.id)] = { product: d.title || x.product, variant: (sk.sales_attributes || []).map(function(a) { return a.value_name || ''; }).filter(String).join(' / ') || '(tanpa varian)',
          productImg: pick((d.main_images || [])[0]).slice(0, 1000), variantImg: vImg.slice(0, 1000) };
      });
      done++;
    } catch (e) { failed++; }
  });
  let saved = 0;
  withScriptLock_(function() {
    const sh = skuMapSheet_(), rows = skuMapRows_(), idx = {}; rows.forEach(function(r, i) { idx[String(r[0])] = i; });
    const byKey = {}; list.rows.forEach(function(x) { byKey[x.key] = x; });
    const append = [];
    Object.keys(names).forEach(function(k) {
      const x = byKey[k], n = names[k]; if (!x) return;
      if (idx[k] !== undefined) { sh.getRange(idx[k] + 2, 7, 1, 2).setValues([[n.product.slice(0, 300), n.variant.slice(0, 200)]]); sh.getRange(idx[k] + 2, 12, 1, 2).setValues([[n.productImg, n.variantImg]]); }
      else append.push([k, x.platform, x.shopId, x.storeCode, x.productId, x.variantId, n.product.slice(0, 300), n.variant.slice(0, 200), '', '', '', n.productImg, n.variantImg]);
      saved++;
    });
    if (append.length) ensureRoom_(sh, append.length, SKU_MAP_HEADERS.length).getRange(sh.getLastRow() + 1, 1, append.length, SKU_MAP_HEADERS.length).setValues(append);
  });
  return { ok: true, products: done, variants: saved, failed: failed, left: left,
    message: saved + ' nama & gambar varian diambil dari ' + done + ' produk' + (failed ? ', ' + failed + ' gagal' : '') + (left ? ', ' + left + ' produk belum (waktu habis) — klik lagi' : '') + '. Hanya membaca dari TikTok, tidak mengubah produk.' };
}

/* ======================= Samakan Seller SKU di TikTok (MENGUBAH PRODUK DI TOKO) =======================
 * Hanya kolom seller_sku yang diganti. Karena aturan TikTok (Partial Edit): semua varian produk WAJIB ikut dikirim
 * (varian yang tidak dikirim akan DIHAPUS) dan setiap objek varian harus lengkap (kolom yang tidak dikirim dikosongkan).
 * Maka data varian dibaca ulang (Get Product) tepat sebelum dikirim, lalu disalin apa adanya.
 * Produk akan diaudit ulang oleh TikTok (v1 tetap tayang bila audit gagal; untuk toko tersambung Tokopedia lihat catatan TikTok).
 * Nama kolom diverifikasi dari SDK resmi TikTok Shop (Product 202309).
 */
const SKU_EDIT_LOG_HEADERS = ['time', 'by', 'shop_id', 'store_code', 'product_id', 'product_name', 'changes', 'result', 'message'];

/** Seller SKU TikTok: 1–50 karakter, tanpa spasi. */
function skuEditSanitize_(s) {
  return String(s || '').trim().replace(/[{}()\[\]]/g, '').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

/** Usulan perubahan: varian TikTok yang sudah dipetakan tetapi Seller SKU-nya belum sama dengan SKU internal. */
function skuEditPreview_(p) {
  assertAllStoresScope_('Mengubah Seller SKU di TikTok');
  const list = skuMapList_({}), byProduct = {};
  list.rows.forEach(function(x) {
    if (x.platform !== 'TikTok' || !x.internalSku || !x.productId) return;
    const target = skuEditSanitize_(x.internalSku);
    if (!target || target === String(x.sellerSku || '')) return;
    const g = byProduct[x.shopId + '|' + x.productId] || (byProduct[x.shopId + '|' + x.productId] = { shopId: x.shopId, storeCode: x.storeCode, productId: x.productId, product: x.product, changes: [] });
    g.changes.push({ variantId: x.variantId, variant: x.variant, from: x.sellerSku || '', to: target, internalSku: x.internalSku, renamed: target !== x.internalSku });
  });
  const products = Object.keys(byProduct).map(function(k) { return byProduct[k]; }).sort(function(a, b) { return a.product.localeCompare(b.product); });
  return { products: products, variants: products.reduce(function(a, g) { return a + g.changes.length; }, 0),
    renamed: products.reduce(function(a, g) { return a + g.changes.filter(function(c) { return c.renamed; }).length; }, 0) };
}

/** Bangun badan Partial Edit dari data Get Product: semua varian disalin lengkap, hanya seller_sku yang diganti. */
function skuEditBuildBody_(detail, newSkuById) {
  const unsupported = [];
  const skus = (detail.skus || []).map(function(s) {
    if ((s.combined_skus || []).length) unsupported.push('varian gabungan (bundle)');
    if (s.pre_sale && Object.keys(s.pre_sale).length) unsupported.push('pre-order');
    if ((s.external_list_prices || []).length) unsupported.push('harga eksternal');
    const o = { id: String(s.id) };
    o.seller_sku = Object.prototype.hasOwnProperty.call(newSkuById, String(s.id)) ? newSkuById[String(s.id)] : (s.seller_sku || '');
    if (!o.seller_sku) delete o.seller_sku;
    if (s.price) o.price = { amount: String(s.price.sale_price), currency: s.price.currency };   // amount = harga tampil (sale_price) — sesuai dok. SDK
    if (s.inventory) o.inventory = s.inventory.map(function(i) { return { warehouse_id: String(i.warehouse_id), quantity: Number(i.quantity) }; });
    if ((s.sales_attributes || []).length) o.sales_attributes = s.sales_attributes.map(function(a) {
      const x = {}; ['id', 'name', 'value_id', 'value_name'].forEach(function(k) { if (a[k] !== undefined && a[k] !== '') x[k] = a[k]; });
      if (a.sku_img && a.sku_img.uri) x.sku_img = { uri: a.sku_img.uri };
      if ((a.supplementary_sku_images || []).length) x.supplementary_sku_images = a.supplementary_sku_images.filter(function(i) { return i && i.uri; }).map(function(i) { return { uri: i.uri }; });
      return x; });
    if (s.identifier_code && s.identifier_code.code) o.identifier_code = { code: s.identifier_code.code, type: s.identifier_code.type };
    if (s.external_sku_id) o.external_sku_id = s.external_sku_id;
    if (s.list_price && s.list_price.amount) o.list_price = { amount: String(s.list_price.amount), currency: s.list_price.currency };
    if ((s.extra_identifier_codes || []).length) o.extra_identifier_codes = s.extra_identifier_codes;
    if (s.sku_unit_count) o.sku_unit_count = String(s.sku_unit_count);
    if (!o.price || !o.inventory) unsupported.push('data harga/stok varian tidak lengkap');
    return o;
  });
  return { body: { skus: skus }, unsupported: unsupported };
}

/** Kirim perubahan. productKeys: ["shopId|productId", ...]; maksimal 20 produk per klik. */
function skuEditApply_(p) {
  assertAllStoresScope_('Mengubah Seller SKU di TikTok');
  p = p || {};
  if (String(p.confirm || '') !== 'UBAH') throw new Error('Ketik UBAH untuk konfirmasi.');
  const want = {}; (p.productKeys || []).slice(0, 20).forEach(function(k) { want[k] = true; });
  const plan = skuEditPreview_({}).products.filter(function(g) { return want[g.shopId + '|' + g.productId]; });
  if (!plan.length) throw new Error('Tidak ada produk yang dipilih.');
  const shops = {}; ttsShops_().forEach(function(s) { shops[s.id] = s; });
  const actor = currentActorEmail_(), log = [], out = [];
  const deadline = Date.now() + 240000;
  plan.forEach(function(g) {
    const name = g.product.slice(0, 80);
    if (Date.now() > deadline) { out.push({ product: name, result: 'DILEWATI', message: 'Waktu habis — klik lagi untuk sisanya.' }); return; }
    const s = shops[g.shopId], auth = s && ttsGetAuth_(s.openId);
    if (!s || !auth) { out.push({ product: name, result: 'GAGAL', message: 'Token toko tidak ditemukan.' }); return; }
    const tok = { cipher: s.cipher, accessToken: auth.access_token };
    let result = 'GAGAL', message = '';
    try {
      const detail = ttsRequest(tok, 'GET', '/product/202309/products/' + encodeURIComponent(g.productId), {}, null);
      const map = {}; g.changes.forEach(function(c) { map[String(c.variantId)] = c.to; });
      const ids = (detail.skus || []).map(function(x) { return String(x.id); });
      if (g.changes.some(function(c) { return ids.indexOf(String(c.variantId)) < 0; })) throw new Error('Varian di TikTok sudah berubah. Sinkron ulang lalu coba lagi.');
      const built = skuEditBuildBody_(detail, map);
      if (built.unsupported.length) { result = 'DILEWATI'; message = 'Produk punya ' + built.unsupported.filter(function(v, i, a) { return a.indexOf(v) === i; }).join(', ') + ' — ubah Seller SKU manual di Seller Center.'; }
      else {
        ttsRequest(tok, 'POST', '/product/202309/products/' + encodeURIComponent(g.productId) + '/partial_edit', {}, built.body);
        result = 'TERKIRIM'; message = 'Diterima TikTok. Produk masuk audit; versi lama tetap tayang sampai audit lolos.';
      }
    } catch (e) { message = e.message; }
    out.push({ product: name, result: result, message: message, changes: g.changes.length });
    log.push([new Date(), actor, g.shopId, g.storeCode, g.productId, g.product.slice(0, 200), g.changes.map(function(c) { return (c.variant || c.variantId) + ': ' + (c.from || '(kosong)') + ' → ' + c.to; }).join('; ').slice(0, 2000), result, message.slice(0, 500)]);
  });
  withScriptLock_(function() {
    const ss = getDatabase_(); let sh = ss.getSheetByName('SKU_Edit_Log');
    if (!sh) sh = ss.insertSheet('SKU_Edit_Log');
  if (!sh.getLastRow()) { sh.getRange(1, 1, 1, SKU_EDIT_LOG_HEADERS.length).setValues([SKU_EDIT_LOG_HEADERS]); sh.setFrozenRows(1); }   // sheet ada tapi kosong → tulis judul
    if (log.length) ensureRoom_(sh, log.length, SKU_EDIT_LOG_HEADERS.length).getRange(sh.getLastRow() + 1, 1, log.length, SKU_EDIT_LOG_HEADERS.length).setValues(log);
  });
  auditChange_('tts-sku-edit', 'TikTok', log.length + ' produk', null, out.map(function(o) { return o.product + ': ' + o.result; }).join('; ').slice(0, 1000));
  return { results: out, message: out.filter(function(o) { return o.result === 'TERKIRIM'; }).length + ' produk terkirim, ' + out.filter(function(o) { return o.result !== 'TERKIRIM'; }).length + ' tidak. Jalankan Sinkron di Koneksi Toko besok untuk melihat Seller SKU yang sudah lolos audit.' };
}

/* ======================= Daftar SKU Gudang (seperti Merchant SKU BigSeller) =======================
 * Satu baris per SKU gudang: nama, HPP berlaku, stok di gudang terpilih (setiap toko punya gudang sendiri),
 * total stok semua gudang, dan varian marketplace yang tertaut. Perubahan HPP/stok memakai fungsi yang sudah ada
 * (plSaveSkuCost_ / stockSave_) sehingga tercatat di riwayat & laba dihitung ulang.
 */
function skuGudangList_(p) {
  p = p || {};
  const store = String(p.storeCode || '').trim().toUpperCase();
  if (store) assertStoreAllowed_(store);
  const scope = allowedStoreList_(), today = plToday_(), hppAt = plSkuIndex_();
  const out = {}, get = function(sku) { const s = String(sku || '').trim(); const k = plSkuKey_(s); if (!k) return null;
    return out[k] || (out[k] = { sku: s, name: '', hpp: null, hppFrom: '', variants: 0, stores: {}, stock: null, stockAll: null, here: false }); };
  plSheetRows_('HPP_SKU', PL_SKU_HEADERS.length).forEach(function(r) {
    const st = String(r[0] || '*').toUpperCase(); if (st !== '*' && st !== store) return;
    const x = get(r[1]); if (!x) return; if (r[2]) x.name = String(r[2]); if (store && st === store) x.here = true;
  });
  skuMapRows_().forEach(function(r) {
    const sku = String(r[8] || '').trim(); if (!sku) return;
    if (scope && scope.indexOf(String(r[3]).toUpperCase()) < 0) return;
    const x = get(sku); x.variants++; x.stores[String(r[3])] = true; if (store && String(r[3]).toUpperCase() === store) x.here = true;
  });
  const st = stockState_();
  Object.keys(st.bal).forEach(function(k) {
    const i = k.indexOf('|'), s = k.slice(0, i), sku = k.slice(i + 1);
    if (scope && scope.indexOf(s) < 0) return;
    const x = get(sku); x.stockAll = (x.stockAll || 0) + st.bal[k];
    if (s === store) { x.stock = st.bal[k]; x.here = true; }
  });
  const rows = Object.keys(out).map(function(k) {
    const x = out[k]; x.hpp = hppAt(store || '*', x.sku, today); x.stores = Object.keys(x.stores); return x;
  }).filter(function(x) {
    // Gudang dipilih → hanya SKU yang tertaut ke varian toko ini / punya stok atau HPP khusus di sini / SKU baru yang belum dipakai toko mana pun.
    return !store || x.here || (!x.variants && x.stockAll === null);
  }).sort(function(a, b) { return (b.variants > 0) - (a.variants > 0) || a.sku.localeCompare(b.sku); });
  return { storeCode: store, trackingSince: store ? (st.start[store] || '') : '', today: today, rows: rows };
}

/** Simpan banyak perubahan sekaligus: [{sku, hpp?, stock?}] — hpp berlaku mulai `from`, stok = hitung fisik di gudang `storeCode`. */
function skuGudangSave_(p) {
  p = p || {};
  const items = (p.items || []).slice(0, 500), msgs = [];
  const from = finDate_(p.from || '') || plToday_();
  let hppN = 0, stockN = 0;
  // HPP pertama sebuah SKU berlaku sejak 01/01/2026 (pesanan lama ikut terhitung); perubahan HPP berlaku mulai `from` (default hari ini).
  const hppAt = plSkuIndex_(), today = plToday_(), firstLines = [], changeLines = [];
  items.forEach(function(it) {
    if (it.hpp === undefined || it.hpp === '' || it.hpp === null) return;
    (hppAt('*', it.sku, today) === null ? firstLines : changeLines).push(String(it.sku).trim() + '\t' + it.hpp);
  });
  [[firstLines, '2026-01-01'], [changeLines, from]].forEach(function(b) {
    if (!b[0].length) return;
    try { const r = plSkuBulk_({ text: b[0].join('\n'), storeCode: '*', from: b[1], apply: true, autoLink: false }); hppN += r.saved || 0; }
    catch (e) { if (!/Tidak ada HPP baru/.test(e.message)) throw e; }
  });
  items.forEach(function(it) {
    if (it.stock === undefined || it.stock === '' || it.stock === null) return;
    stockSave_({ storeCode: p.storeCode, sku: it.sku, type: 'adj', qty: Number(it.stock), note: 'Diubah dari daftar SKU Gudang' });
    stockN++;
  });
  if (hppN) msgs.push(hppN + ' HPP disimpan' + (changeLines.length ? ' (perubahan berlaku mulai ' + from + ')' : ''));
  if (stockN) msgs.push(stockN + ' stok di gudang ' + String(p.storeCode || '').toUpperCase() + ' disesuaikan');
  return { ok: true, message: (msgs.join(', ') || 'Tidak ada perubahan') + '.' };
}
