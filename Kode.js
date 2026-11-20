/**
 * E-Commerce Analytics & Marketing Calculator
 * Tahap 1 — Fondasi database dan dashboard.
 *
 * Instalasi:
 * 1. Buat project Google Apps Script.
 * 2. Buat file Code.gs dan Index.html.
 * 3. Tempel isi file yang disediakan.
 * 4. Jalankan setupDatabase_() sekali dari editor Apps Script.
 * 5. Deploy sebagai Web app.
 */

const APP_TITLE = 'E-Commerce Analytics & Marketing Calculator';
const DB_PROPERTY_KEY = 'ECOMMERCE_ANALYTICS_SPREADSHEET_ID';

const SHEET_HEADERS = {
  Transactions: [
    'ID', 'Created At', 'Transaction Date', 'Marketplace', 'Product Name',
    'Revenue', 'Orders', 'Units', 'Ad Spend', 'COGS',
    'Marketplace Fees', 'Affiliate Commission', 'Voucher Cost',
    'Other Costs', 'Notes', 'Gross Profit', 'Net Profit', 'Store Code'
  ],
  Products: [
    'Product ID', 'Product Name', 'Category', 'Selling Price', 'COGS',
    'Packaging Cost', 'Operational Cost', 'Marketplace Fee Rate',
    'Affiliate Rate', 'Active', 'Created At'
  ],
  Campaigns: [
    'Campaign ID', 'Campaign Name', 'Platform', 'Start Date', 'End Date',
    'Budget', 'Actual Spend', 'Impressions', 'Clicks', 'Orders',
    'Attributed Revenue', 'Target ROAS', 'Target CPA', 'Created At'
  ],
  // Kolom baru selalu ditambahkan di BELAKANG agar indeks kolom lama tetap sama.
  ShopAnalytics: ['Import ID','Imported At','Source File','Date','GMV','Orders','Buyers','Units Sold','Refunds','Gross Revenue','Page Views','Visitors','Conversion Rate','Product Impressions','Product Clicks','AOV','Affiliate Video GMV','Store Code'],
  GMVMax: ['Import ID','Imported At','Source File','Date','Spend','Orders','SKU','Cost Per Order','Gross Income','ROI','Currency','Store Code'],
  ImportLog: ['Import ID','Imported At','Source','Source File','Rows Imported','Status','Notes','Store Code','Rows Added','Rows Updated','Rows Skipped','Imported By'],
  Settings: ['Setting', 'Value', 'Description']
};

function doGet(e) {
  const parameters=e&&e.parameter||{};
  // Callback TikTok Shop: state berawalan "tts_" (dari tombol Hubungkan Toko), atau ada code tanpa state
  // (otorisasi dimulai dari sisi TikTok). Login tim memakai state 64 karakter hex, jadi tidak bentrok.
  const state=String(parameters.state||'');
  // Shopee mengembalikan code + shop_id (state berawalan shp_ bila dimulai dari aplikasi). Dicek sebelum TikTok.
  if(parameters.code&&(parameters.shop_id||state.indexOf('shp_')===0))return handleShopeeCallback(parameters);
  if(parameters.code&&(state.indexOf('tts_')===0||!state))return handleTikTokCallback(parameters);
  if(state)return teamGoogleCallback_(parameters);
  return HtmlService.createHtmlOutputFromFile('index')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle('E-Commerce Tim')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);   // boleh dibuka lewat halaman pembungkus derianal.github.io/keuangan/ (tetap wajib login)
}

function setupDatabase_() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty(DB_PROPERTY_KEY);
  let ss;

  if (spreadsheetId) {
    try {
      ss = SpreadsheetApp.openById(spreadsheetId);
    } catch (err) {
      spreadsheetId = null;
    }
  }

  if (!spreadsheetId) {
    ss = SpreadsheetApp.create('E-Commerce Analytics - Database');
    spreadsheetId = ss.getId();
    props.setProperty(DB_PROPERTY_KEY, spreadsheetId);
  }

  Object.keys(SHEET_HEADERS).forEach(function(sheetName) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, SHEET_HEADERS[sheetName].length)
        .setValues([SHEET_HEADERS[sheetName]]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, SHEET_HEADERS[sheetName].length)
        .setFontWeight('bold')
        .setBackground('#eaf0f8');
      sheet.autoResizeColumns(1, SHEET_HEADERS[sheetName].length);
    }
  });

  const settings = ss.getSheetByName('Settings');
  if (settings.getLastRow() === 1) {
    settings.getRange(2, 1, 3, 3).setValues([
      ['Currency', 'IDR', 'Mata uang laporan'],
      ['Timezone', Session.getScriptTimeZone(), 'Zona waktu project Apps Script'],
      ['Database Version', '1.0.0', 'Versi struktur database']
    ]);
  }

  return {
    success: true,
    spreadsheetId: spreadsheetId,
    spreadsheetUrl: ss.getUrl(),
    message: 'Database berhasil disiapkan.'
  };
}

function getDatabase_() {
  const id = PropertiesService.getScriptProperties().getProperty(DB_PROPERTY_KEY);
  if (!id) throw new Error('Database belum dibuat. Jalankan setupDatabase_() terlebih dahulu.');
  return SpreadsheetApp.openById(id);
}

function parseNumber_(value, label) {
  const number = Number(value);
  if (!isFinite(number) || number < 0) {
    throw new Error(label + ' harus berupa angka nol atau lebih.');
  }
  return number;
}

function addTransaction_(payload) {
  if (!payload) throw new Error('Data transaksi tidak ditemukan.');

  const date = String(payload.transactionDate || '').trim();
  const productName = String(payload.productName || '').trim();
  const marketplace = String(payload.marketplace || '').trim();

  if (!date) throw new Error('Tanggal transaksi wajib diisi.');
  if (!productName) throw new Error('Nama produk wajib diisi.');
  if (!marketplace) throw new Error('Marketplace wajib dipilih.');

  const revenue = parseNumber_(payload.revenue, 'Omzet');
  const orders = parseNumber_(payload.orders, 'Jumlah pesanan');
  const units = parseNumber_(payload.units, 'Produk terjual');
  const adSpend = parseNumber_(payload.adSpend || 0, 'Biaya iklan');
  const cogs = parseNumber_(payload.cogs || 0, 'HPP');
  const marketplaceFees = parseNumber_(payload.marketplaceFees || 0, 'Biaya marketplace');
  const affiliateCommission = parseNumber_(payload.affiliateCommission || 0, 'Komisi affiliate');
  const voucherCost = parseNumber_(payload.voucherCost || 0, 'Biaya voucher');
  const otherCosts = parseNumber_(payload.otherCosts || 0, 'Biaya lainnya');

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - marketplaceFees - affiliateCommission -
    adSpend - voucherCost - otherCosts;

  const storeCode = String(payload.storeCode || '').trim().toUpperCase();
  if (storeCode) requireStoreCode_(storeCode);
  else if (!currentScope_().all) throw new Error('Pilih toko untuk transaksi ini.');
  const ss = getDatabase_();
  const sheet = ensureStoreColumn_('Transactions', SHEET_HEADERS.Transactions);
  plMarkDirty_(date);
  const id = Utilities.getUuid();
  const createdAt = new Date();

  sheet.appendRow([
    id, createdAt, date, marketplace, productName,
    revenue, orders, units, adSpend, cogs,
    marketplaceFees, affiliateCommission, voucherCost,
    otherCosts, String(payload.notes || '').trim(),
    grossProfit, netProfit, storeCode
  ]);

  return {
    success: true,
    id: id,
    grossProfit: grossProfit,
    netProfit: netProfit,
    message: 'Transaksi berhasil disimpan.'
  };
}


/** Baris transaksi boleh dibaca? Kolom 18 = Store Code. wantStore '' = semua toko dalam cakupan. */
function transactionStoreFilter_(wantStore) {
  const want = String(wantStore || '').trim().toUpperCase();
  if (want) assertStoreAllowed_(want);
  const scope = allowedStoreList_();
  return function(row) {
    const code = String(row[17] || '').trim().toUpperCase();
    if (want === 'UNASSIGNED') return code === '';
    if (want && code !== want) return false;
    if (scope && scope.indexOf(code) < 0) return false;
    return true;
  };
}
function getDashboardData_(filters) {
  const ss = getDatabase_();
  const sheet = ss.getSheetByName('Transactions');
  if (!sheet) throw new Error('Sheet Transactions tidak ditemukan.');

  const values = sheet.getDataRange().getValues();

  // Mendukung filter baru dan tetap kompatibel dengan pemanggilan lama.
  const options = typeof filters === 'object' && filters !== null
    ? filters
    : { period: filters || 'all' };
  const storeOk = transactionStoreFilter_(options.storeCode);
  const rows = values.length > 1 ? values.slice(1).filter(storeOk) : [];

  const sourceApp = String(options.sourceApp || 'Semua Aplikasi').trim();
  const startDate = String(options.startDate || '').trim();
  const endDate = String(options.endDate || '').trim();

  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error('Format tanggal mulai harus YYYY-MM-DD.');
  }
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('Format tanggal akhir harus YYYY-MM-DD.');
  }
  if (startDate && endDate && startDate > endDate) {
    throw new Error('Tanggal mulai tidak boleh melewati tanggal akhir.');
  }

  const now = new Date();
  const legacyStart = getPeriodStart_(options.period || 'all', now);

  function dateKey_(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return Utilities.formatDate(
        value,
        Session.getScriptTimeZone(),
        'yyyy-MM-dd'
      );
    }

    const s = String(value || '').trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    const d = new Date(value);
    if (isNaN(d.getTime())) return '';

    return Utilities.formatDate(
      d,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
  }

  const filtered = rows.filter(function(row) {
    const transactionDate = dateKey_(row[2]);
    if (!transactionDate) return false;

    // Saat ini KasirKu mengirim nama aplikasi pada kolom Marketplace.
    const appName = String(row[3] || '').trim();

    if (sourceApp !== 'Semua Aplikasi' &&
        appName.toLowerCase() !== sourceApp.toLowerCase()) {
      return false;
    }

    if (startDate && transactionDate < startDate) return false;
    if (endDate && transactionDate > endDate) return false;

    if (!startDate && !endDate && legacyStart &&
        transactionDate < dateKey_(legacyStart)) return false;

    if (!startDate && !endDate &&
        !legacyStart && options.period !== 'all' &&
        transactionDate > dateKey_(now)) return false;

    return true;
  });

  const totals = {
    revenue: 0,
    orders: 0,
    units: 0,
    adSpend: 0,
    cogs: 0,
    marketplaceFees: 0,
    affiliateCommission: 0,
    voucherCost: 0,
    otherCosts: 0,
    grossProfit: 0,
    netProfit: 0
  };

  filtered.forEach(function(r) {
    totals.revenue += num_(r[5]);
    totals.orders += num_(r[6]);
    totals.units += num_(r[7]);
    totals.adSpend += num_(r[8]);
    totals.cogs += num_(r[9]);
    totals.marketplaceFees += num_(r[10]);
    totals.affiliateCommission += num_(r[11]);
    totals.voucherCost += num_(r[12]);
    totals.otherCosts += num_(r[13]);
    totals.grossProfit += num_(r[15]);
    totals.netProfit += num_(r[16]);
  });

  const recent = filtered.slice(-10).reverse().map(function(r) {
    return {
      id: String(r[0]),
      date: dateKey_(r[2]),
      marketplace: String(r[3]),
      productName: String(r[4]),
      revenue: num_(r[5]),
      orders: num_(r[6]),
      units: num_(r[7]),
      netProfit: num_(r[16])
    };
  });

  // Catatan: transaksi (KasirKu/manual) tidak dijumlahkan dengan Shop Analytics atau atribusi GMV Max.

return {
  success: true,
  sourceApp: sourceApp,
  startDate: startDate,
  endDate: endDate,
  storeCode: String(options.storeCode || ''),
  totals: totals,

  // Tanpa omzet, margin tidak terdefinisi (null), bukan 0%.
  netMargin: totals.revenue
    ? totals.netProfit / totals.revenue * 100
    : null,

  roas: totals.adSpend
    ? totals.revenue / totals.adSpend
    : null,

  transactionCount: filtered.length,
  recentTransactions: recent,

marketplaceRevenue: buildMarketplaceSeries_(filtered),

dailyRevenue: buildDailySeriesRange_(
  filtered, startDate, endDate, now
),

weeklyRevenue: buildWeeklySeriesRange_(
  filtered, startDate, endDate, now
),

monthlyRevenue: buildMonthlySeriesRange_(
  filtered, startDate, endDate, now
),

databaseUrl: ss.getUrl(),
generatedAt: new Date().toISOString()
};
}
function buildDailySeriesRange_(rows, startDate, endDate, now) {
  if (!startDate && !endDate) {
    return buildDailySeries_(rows, now, 7);
  }

  const start = startDate
    ? new Date(startDate + 'T00:00:00')
    : new Date(endDate + 'T00:00:00');

  const end = endDate
    ? new Date(endDate + 'T00:00:00')
    : new Date(now);

  end.setHours(0, 0, 0, 0);

  const sums_ = {};
  const labels = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = new Date(d);
    const key = Utilities.formatDate(
      date, Session.getScriptTimeZone(), 'yyyy-MM-dd'
    );

    labels.push({
      key: key,
      label: Utilities.formatDate(
        date, Session.getScriptTimeZone(), 'dd MMM'
      )
    });
    sums_[key] = 0;
  }

  rows.forEach(function(r) {
    const d = parseDate_(r[2]);
    if (!d) return;

    const key = Utilities.formatDate(
      d, Session.getScriptTimeZone(), 'yyyy-MM-dd'
    );

    if (Object.prototype.hasOwnProperty.call(sums_, key)) {
      sums_[key] += num_(r[5]);
    }
  });

  return labels.map(x => ({
    label: x.label,
    value: sums_[x.key]
  }));
}

function buildWeeklySeriesRange_(rows, startDate, endDate, now) {
  if (!startDate && !endDate) {
    return buildWeeklySeries_(rows, now, 8);
  }

  const start = startDate
    ? new Date(startDate + 'T00:00:00')
    : new Date(endDate + 'T00:00:00');

  const end = endDate
    ? new Date(endDate + 'T00:00:00')
    : new Date(now);

  start.setDate(start.getDate() - start.getDay());
  end.setHours(0, 0, 0, 0);

  const sums_ = {};
  const labels = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
    const date = new Date(d);
    const key = Utilities.formatDate(
      date, Session.getScriptTimeZone(), 'yyyy-MM-dd'
    );

    labels.push({
      key: key,
      label: Utilities.formatDate(
        date, Session.getScriptTimeZone(), 'dd MMM'
      )
    });
    sums_[key] = 0;
  }

  rows.forEach(function(r) {
    const d = parseDate_(r[2]);
    if (!d) return;

    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());

    const key = Utilities.formatDate(
      d, Session.getScriptTimeZone(), 'yyyy-MM-dd'
    );

    if (Object.prototype.hasOwnProperty.call(sums_, key)) {
      sums_[key] += num_(r[5]);
    }
  });

  return labels.map(x => ({
    label: x.label,
    value: sums_[x.key]
  }));
}

function buildMonthlySeriesRange_(rows, startDate, endDate, now) {
  if (!startDate && !endDate) {
    return buildMonthlySeries_(rows, now, 6);
  }

  const start = startDate
    ? new Date(startDate + 'T00:00:00')
    : new Date(endDate + 'T00:00:00');

  const end = endDate
    ? new Date(endDate + 'T00:00:00')
    : new Date(now);

  const sums_ = {};
  const labels = [];

  let d = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);

  for (; d <= last; d.setMonth(d.getMonth() + 1)) {
    const date = new Date(d);
    const key = Utilities.formatDate(
      date, Session.getScriptTimeZone(), 'yyyy-MM'
    );

    labels.push({
      key: key,
      label: Utilities.formatDate(
        date, Session.getScriptTimeZone(), 'MMM yy'
      )
    });
    sums_[key] = 0;
  }

  rows.forEach(function(r) {
    const date = parseDate_(r[2]);
    if (!date) return;

    const key = Utilities.formatDate(
      date, Session.getScriptTimeZone(), 'yyyy-MM'
    );

    if (Object.prototype.hasOwnProperty.call(sums_, key)) {
      sums_[key] += num_(r[5]);
    }
  });

  return labels.map(x => ({
    label: x.label,
    value: sums_[x.key]
  }));
}

function getRecentTransactions_(limit, storeCode) {
  const sheet = getDatabase_().getSheetByName('Transactions');
  const values = sheet.getDataRange().getValues();
  const rows = values.length > 1 ? values.slice(1).filter(transactionStoreFilter_(storeCode)) : [];
  const count = Math.max(1, Math.min(Number(limit) || 20, 100));

  return rows.slice(-count).reverse().map(function(r) {
    return {
      id: String(r[0]),
      date: String(r[2]),
      marketplace: String(r[3]),
      productName: String(r[4]),
      revenue: num_(r[5]),
      orders: num_(r[6]),
      units: num_(r[7]),
      netProfit: num_(r[16])
    };
  });
}

function getPeriodStart_(period, now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === '7d') {
    d.setDate(d.getDate() - 6);
    return d;
  }
  if (period === '30d') {
    d.setDate(d.getDate() - 29);
    return d;
  }
  if (period === 'month') {
    d.setDate(1);
    return d;
  }
  return null;
}

function parseDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function endOfDay_(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function num_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function buildDailySeries_(rows, now, days) {
  const labels = [];
  const sums_ = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const key = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    labels.push({ key: key, label: Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd MMM') });
    sums_[key] = 0;
  }
  rows.forEach(function(r) {
    const d = parseDate_(r[2]);
    if (!d) return;
    const key = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (Object.prototype.hasOwnProperty.call(sums_, key)) sums_[key] += num_(r[5]);
  });
  return labels.map(function(x) { return { label: x.label, value: sums_[x.key] }; });
}

function buildWeeklySeries_(rows, now, weeks) {
  const labels = [], sums_ = {};
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() - d.getDay() - (i * 7));
    const end = new Date(d); end.setDate(end.getDate() + 6);
    const key = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    labels.push({key:key,label:Utilities.formatDate(d,Session.getScriptTimeZone(),'dd MMM')});
    sums_[key] = 0;
  }
  rows.forEach(function(r) {
    const d = parseDate_(r[2]); if (!d) return;
    d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay());
    const key = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (Object.prototype.hasOwnProperty.call(sums_,key)) sums_[key] += num_(r[5]);
  });
  return labels.map(x => ({label:x.label,value:sums_[x.key]}));
}

function buildPeriodComparison_(allRows, currentRows, start, now, period) {
  if (!allRows.length) return null;
  let currentStart = start;
  if (!currentStart) {
    const dates = allRows.map(r => parseDate_(r[2])).filter(Boolean).sort((a,b)=>a-b);
    currentStart = dates.length ? new Date(dates[0]) : new Date(now);
    currentStart.setHours(0,0,0,0);
  }
  const duration = Math.max(1, Math.ceil((endOfDay_(now).getTime()-currentStart.getTime()+1)/86400000));
  const previousStart = new Date(currentStart); previousStart.setDate(previousStart.getDate()-duration);
  const previousEnd = new Date(currentStart); previousEnd.setMilliseconds(previousEnd.getMilliseconds()-1);
  const previousRows = allRows.filter(r => { const d=parseDate_(r[2]); return d && d>=previousStart && d<=previousEnd; });
  function sums_(rows) {
    const out={revenue:0,orders:0,units:0,adSpend:0,netProfit:0};
    rows.forEach(r=>{out.revenue+=num_(r[5]);out.orders+=num_(r[6]);out.units+=num_(r[7]);out.adSpend+=num_(r[8]);out.netProfit+=num_(r[16]);});
    return out;
  }
  return {current:sums_(currentRows),previous:sums_(previousRows),currentStart:Utilities.formatDate(currentStart,Session.getScriptTimeZone(),'yyyy-MM-dd'),previousStart:Utilities.formatDate(previousStart,Session.getScriptTimeZone(),'yyyy-MM-dd'),durationDays:duration};
}

function buildMonthlySeries_(rows, now, months) {
  const labels = [];
  const sums_ = {};
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
    labels.push({ key: key, label: Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM yy') });
    sums_[key] = 0;
  }
  rows.forEach(function(r) {
    const d = parseDate_(r[2]);
    if (!d) return;
    const key = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
    if (Object.prototype.hasOwnProperty.call(sums_, key)) sums_[key] += num_(r[5]);
  });
  return labels.map(function(x) { return { label: x.label, value: sums_[x.key] }; });
}

function buildMarketplaceSeries_(rows) {
  const sums_ = {};
  rows.forEach(function(r) {
    const key = String(r[3] || 'Lainnya');
    sums_[key] = (sums_[key] || 0) + num_(r[5]);
  });
  return Object.keys(sums_).map(function(key) {
    return { label: key, value: sums_[key] };
  }).sort(function(a, b) { return b.value - a.value; });
}



/* =========================================================
   TAHAP 2 — IMPORT SHOP ANALYTICS & GMV MAX
   Data impor disimpan terpisah agar GMV toko tidak tercampur
   dengan gross income atribusi iklan.
========================================================= */
function ensureImportSheets_() {
  const ss = getDatabase_();
  const headers = {
    ShopAnalytics: SHEET_HEADERS.ShopAnalytics,
    GMVMax: SHEET_HEADERS.GMVMax,
    ImportLog: SHEET_HEADERS.ImportLog
  };
  Object.keys(headers).forEach(function(name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1,1,1,headers[name].length).setValues([headers[name]]);
      sh.setFrozenRows(1);
      sh.getRange(1,1,1,headers[name].length).setFontWeight('bold').setBackground('#eaf0f8');
    } else if (sh.getLastColumn() < headers[name].length) {
      // Migrasi aman: hanya menambah judul kolom baru di belakang. Data lama tidak disentuh.
      sh.getRange(1,1,1,headers[name].length).setValues([headers[name]]);
    }
  });
  return ss;
}
function importShopAnalyticsRows_(payload) {
  return importAnalyticsRows_(payload, 'ShopAnalytics');
}
function importGmvMaxRows_(payload) {
  return importAnalyticsRows_(payload, 'GMVMax');
}
/** Kode toko wajib dipilih pengguna dan harus terdaftar di Master Toko. Tidak ada tebakan toko. */
function requireStoreCode_(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) throw new Error('Pilih toko tujuan impor terlebih dahulu. Data tidak disimpan.');
  const stores = finStoresFromRows_(finRows_('FinStores'));
  const store = stores.find(function(s) { return s.code === c; });
  if (!store) throw new Error('Toko ' + c + ' belum terdaftar di Master Toko (menu Keuangan). Data tidak disimpan.');
  if (!store.active) throw new Error('Toko ' + c + ' berstatus nonaktif. Aktifkan dulu sebelum impor.');
  assertStoreAllowed_(c);
  return store;
}
/**
 * Kunci proses tunggal yang aman dipanggil bertingkat dalam satu eksekusi
 * (mencegah dua impor/penyimpanan berjalan bersamaan tanpa saling mengunci diri sendiri).
 */
let SCRIPT_LOCK_DEPTH_ = 0;
function withScriptLock_(fn, waitMs) {
  if (SCRIPT_LOCK_DEPTH_ > 0) { SCRIPT_LOCK_DEPTH_++; try { return fn(); } finally { SCRIPT_LOCK_DEPTH_--; } }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || 10000)) throw new Error('Proses lain (impor/penyimpanan) sedang berjalan. Coba lagi sebentar lagi.');
  SCRIPT_LOCK_DEPTH_ = 1;
  try { return fn(); } finally { SCRIPT_LOCK_DEPTH_ = 0; lock.releaseLock(); }
}
function currentActorEmail_() {
  return (typeof TEAM_REQUEST_CONTEXT_ !== 'undefined' && TEAM_REQUEST_CONTEXT_) ? TEAM_REQUEST_CONTEXT_.email : '';
}
/**
 * Impor per toko dengan upsert:
 * - Kunci Shop  = toko|tanggal ; kunci GMV Max = toko|tanggal|SKU.
 * - Impor ulang file yang sama MEMPERBARUI baris lama, tidak menambah.
 * - Data toko lain dan tanggal lain tidak disentuh.
 * - Sel kosong disimpan kosong (tidak tersedia), bukan 0.
 */
function importAnalyticsRows_(payload, sheetName) {
  if (!payload || !Array.isArray(payload.rows) || !payload.rows.length) throw new Error('File tidak berisi baris data.');
  const store = requireStoreCode_(payload.storeCode);
  // Koreksi kolom manual hanya untuk GMV Max di sini; Shop sudah dipetakan di prepareShopFlexible_.
  const sourceRows = sheetName === 'GMVMax' ? applyColumnMap_(payload.rows, 'gmvmax', payload.columnMap) : payload.rows;
  const ss = ensureImportSheets_();
  const sh = ss.getSheetByName(sheetName);
  const width = SHEET_HEADERS[sheetName].length;
  const importId = Utilities.getUuid();
  const importedAt = new Date();
  const fileName = String(payload.fileName || 'File Excel').slice(0,200);
  const cell = function(v) { return v === null || v === undefined ? '' : v; };
  const output = [], problems = [];
  const keyOf = function(r) { return sheetName === 'GMVMax' ? r[11] + '|' + r[3] + '|' + String(r[6] || '') : r[17] + '|' + r[3]; };
  const fileKeys = {};
  let skipped = 0, merged = 0;
  sourceRows.forEach(function(obj, idx) {
    const date = normalizeImportDate_(pickImport_(obj,aliasesOf_(sheetName === 'GMVMax' ? 'gmvmax' : 'shopSummary','date')));
    if (!date) { skipped++; if (problems.length < 20) problems.push('Baris ' + (idx + 2) + ': tanggal tidak valid'); return; }
    let values;
    if (sheetName === 'ShopAnalytics') {
      values = [
        importId, importedAt, fileName, date,
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','gmv'))),
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','orders'))),
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','buyers'))),
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','units'))),
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','refunds'))),
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','grossRevenue'))),
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','pageViews'))),
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','visitors'))),
        importRate_(pickImport_(obj,aliasesOf_('shopSummary','conversionRate'))),
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','impressions'))),
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','clicks'))),
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','aov'))),
        importNum_(pickImport_(obj,aliasesOf_('shopSummary','affiliateVideoGmv'))),
        store.code
      ];
    } else {
      const rawCur = String(pickImport_(obj,aliasesOf_('gmvmax','currency')) || '').trim().toUpperCase();
      values = [
        importId, importedAt, fileName, date,
        importNum_(pickImport_(obj,aliasesOf_('gmvmax','spend'))),
        importNum_(pickImport_(obj,aliasesOf_('gmvmax','orders'))),
        String(pickImport_(obj,aliasesOf_('gmvmax','sku')) || ''),
        importNum_(pickImport_(obj,aliasesOf_('gmvmax','costPerOrder'))),
        importNum_(pickImport_(obj,aliasesOf_('gmvmax','grossIncome'))),
        importRate_(pickImport_(obj,aliasesOf_('gmvmax','roi'))),
        ['RP','RUPIAH'].indexOf(rawCur) >= 0 ? 'IDR' : (rawCur || store.currency || 'IDR'),
        store.code
      ];
    }
    values = values.map(cell);
    const k = keyOf(values);
    if (Object.prototype.hasOwnProperty.call(fileKeys, k)) {
      // Kunci sama muncul dua kali di satu file: baris terakhir dipakai, dicatat sebagai duplikat.
      output[fileKeys[k]] = values; merged++; return;
    }
    fileKeys[k] = output.length;
    output.push(values);
  });
  if (!output.length) throw new Error('Tidak ada tanggal valid. Pastikan kolom tanggal/per hari tersedia. Data lama tetap disimpan.');

  return withScriptLock_(function() {
    const last = sh.getLastRow();
    const existing = last > 1 ? sh.getRange(2,1,last-1,width).getValues() : [];
    const pos = {};
    existing.forEach(function(r, i) { if (r[3] !== '' && r[3] != null) {
      const row = r.slice(); row[3] = normalizeImportDate_(r[3]); pos[keyOf(row)] = i; } });
    let added = 0, updated = 0;
    const appended = [];
    output.forEach(function(row) {
      const k = keyOf(row);
      if (Object.prototype.hasOwnProperty.call(pos, k)) { existing[pos[k]] = row; updated++; }
      else { appended.push(row); added++; }
    });
    const dates = output.map(function(r) { return r[3]; }).sort();
    if (payload.dryRun) {
      // PRATINJAU: tidak ada yang ditulis ke sheet maupun ImportLog.
      return {dryRun:true, storeCode:store.code, sheet:sheetName, rows:output.length, added:added, updated:updated,
        skipped:skipped, merged:merged, problems:problems, firstDate:dates[0], lastDate:dates[dates.length-1],
        sample:output.slice(0,5).map(function(r){ return sheetName === 'GMVMax'
          ? {date:r[3],spend:r[4],orders:r[5],sku:r[6],grossIncome:r[8]}
          : {date:r[3],gmv:r[4],orders:r[5],visitors:r[11]}; }),
        message:'Pratinjau toko ' + store.code + ': ' + added + ' baris baru, ' + updated + ' akan diperbarui, ' + (skipped + merged) + ' dilewati/digabung. Belum ada yang disimpan.'};
    }
    if (updated) sh.getRange(2,1,existing.length,width).setValues(existing);
    if (appended.length) ensureRoom_(sh, appended.length, width).getRange(sh.getLastRow() + 1, 1, appended.length, width).setValues(appended);
    const log = ss.getSheetByName('ImportLog');
    const note = 'Impor per toko (upsert). ' + (merged ? merged + ' baris berkunci sama di file digabung. ' : '') + problems.slice(0,5).join('; ');
    log.appendRow([importId, importedAt, sheetName, fileName, output.length, 'SUCCESS', note.slice(0,500), store.code, added, updated, skipped + merged, currentActorEmail_()]);
    return {success:true, importId:importId, storeCode:store.code, rowsImported:output.length, added:added, updated:updated,
      skipped:skipped, merged:merged, problems:problems, sheet:sheetName,
      message:'Toko ' + store.code + ': ' + added + ' baris baru, ' + updated + ' diperbarui (impor ulang tidak menggandakan), ' + (skipped + merged) + ' dilewati/digabung.'};
  });
}
function pickImport_(obj, aliases) {
  const keys = Object.keys(obj || {});
  const normalized = {};
  keys.forEach(k => normalized[String(k).toLowerCase().replace(/[\s_\-()%]/g,'').trim()] = obj[k]);
  for (let i=0;i<aliases.length;i++) {
    const key = aliases[i].toLowerCase().replace(/[\s_\-()%]/g,'').trim();
    if (Object.prototype.hasOwnProperty.call(normalized,key)) return normalized[key];
  }
  return '';
}
/**
 * Angka impor. Kosong / '-' / teks tidak dikenali -> null (TIDAK TERSEDIA), bukan 0.
 * Format Indonesia: 1.250.000 ; 1.250.000,50 ; Rp 12.500 ; juga 1,250,000.
 * (Parser lama mengubah '1.250.000' menjadi 0 dan '1.234' menjadi 1,234.)
 */
function importNum_(v) {
  return finNum_(v);
}
function importRate_(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  const n = finNum_(s.replace('%',''));
  if (n === null) return null;
  return s.indexOf('%') >= 0 ? n : (n > 1 ? n : n * 100);
}
/** Nilai sel tersimpan -> angka atau null bila kosong. */
function numOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function normalizeImportDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd');
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899,11,30) + v*86400000);
    return Utilities.formatDate(d,'UTC','yyyy-MM-dd');
  }
  const s = String(v || '').trim();
  if (!s) return '';
  // Tanggal teks diperiksa ketat (hari-bulan-tahun Indonesia). Tidak memakai new Date(teks) yang membaca format AS.
  return finDate_(s);
}
/**
 * Data impor tersimpan. opts.storeCode: '' = semua toko, 'UNASSIGNED' = data lama tanpa toko,
 * selain itu satu toko. opts.allowedStores (opsional) membatasi akses.
 */
function getImportedAnalytics_(source, opts) {
  opts = (opts && typeof opts === 'object') ? opts : {};
  const ss = ensureImportSheets_();
  const name = source === 'gmvmax' ? 'GMVMax' : 'ShopAnalytics';
  const sh = ss.getSheetByName(name);
  const width = SHEET_HEADERS[name].length;
  const storeCol = source === 'gmvmax' ? 11 : 17;
  const values = sh.getLastRow() > 1 ? sh.getRange(2,1,sh.getLastRow()-1,width).getValues() : [];
  const want = String(opts.storeCode || '').trim().toUpperCase();
  if (want) assertStoreAllowed_(want);
  // Batas akses toko diterapkan di server untuk setiap pembacaan.
  const scopeList = allowedStoreList_();
  if (scopeList) opts = Object.assign({}, opts, { allowedStores: Array.isArray(opts.allowedStores) ? opts.allowedStores.filter(function(c) { return scopeList.indexOf(c) >= 0; }) : scopeList });
  let unassigned = 0;
  const rows = [];
  values.forEach(function(r) {
    const code = String(r[storeCol] || '').trim().toUpperCase();
    if (!code) unassigned++;
    if (want === 'UNASSIGNED' ? code !== '' : (want && code !== want)) return;
    if (Array.isArray(opts.allowedStores) && opts.allowedStores.indexOf(code) < 0) return;
    const date = normalizeImportDate_(r[3]);
    if (source === 'gmvmax') rows.push({storeCode:code || null,date:date,spend:numOrNull_(r[4]),orders:numOrNull_(r[5]),sku:String(r[6]),costPerOrder:numOrNull_(r[7]),grossIncome:numOrNull_(r[8]),roi:numOrNull_(r[9]),currency:String(r[10])});
    else rows.push({storeCode:code || null,date:date,gmv:numOrNull_(r[4]),orders:numOrNull_(r[5]),buyers:numOrNull_(r[6]),units:numOrNull_(r[7]),refunds:numOrNull_(r[8]),grossRevenue:numOrNull_(r[9]),pageViews:numOrNull_(r[10]),visitors:numOrNull_(r[11]),conversionRate:numOrNull_(r[12]),impressions:numOrNull_(r[13]),clicks:numOrNull_(r[14]),aov:numOrNull_(r[15]),affiliateVideoGmv:numOrNull_(r[16])});
  });
  // Jumlah hanya dari nilai yang tersedia; bila semua kosong hasilnya null (tidak tersedia), bukan 0.
  const sum = function(key) { let t = null; rows.forEach(function(r) { if (r[key] !== null && r[key] !== undefined) t = (t || 0) + Number(r[key]); }); return t; };
  const div = function(a, b, mul) { return a !== null && b ? a / b * (mul || 1) : null; };
  let summary;
  if (source === 'gmvmax') {
    const currencies = {};
    rows.forEach(function(r) { currencies[r.currency || 'UNKNOWN'] = true; });
    const spend=sum('spend'), orders=sum('orders'), gross=sum('grossIncome');
    summary={count:rows.length,spend:spend,orders:orders,grossIncome:gross,roi:div(gross,spend),costPerOrder:div(spend,orders),currencies:Object.keys(currencies),
      mixedCurrency:Object.keys(currencies).length>1};
  } else {
    const gmv=sum('gmv'), orders=sum('orders'), views=sum('pageViews'), clicks=sum('clicks'), impressions=sum('impressions');
    summary={count:rows.length,gmv:gmv,orders:orders,buyers:sum('buyers'),units:sum('units'),refunds:sum('refunds'),grossRevenue:sum('grossRevenue'),pageViews:views,visitors:sum('visitors'),impressions:impressions,clicks:clicks,aov:div(gmv,orders),clickRate:div(clicks,impressions,100),conversionRate:div(orders,views,100)};
  }
  rows.sort(function(a,b){ return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return {source:source,storeCode:want || '',unassignedRows:currentScope_().all ? unassigned : 0,rows:rows,summary:summary};
}

/** Hapus data impor SATU toko untuk satu sumber. Riwayat ImportLog tidak dihapus; penghapusan dicatat. */
function clearImportedAnalytics_(source, storeCode) {
  if (source !== 'shop' && source !== 'gmvmax') throw new Error('Sumber data tidak valid.');
  const code = String(storeCode || '').trim().toUpperCase();
  if (!code) throw new Error('Pilih toko yang datanya akan dihapus. Penghapusan semua toko sekaligus tidak tersedia.');
  assertStoreAllowed_(code);
  const ss = ensureImportSheets_();
  const sheetName = source === 'gmvmax' ? 'GMVMax' : 'ShopAnalytics';
  const width = SHEET_HEADERS[sheetName].length, storeCol = source === 'gmvmax' ? 11 : 17;
  return withScriptLock_(function() {
    if (typeof archiveCurrentWorkData_ === 'function') archiveCurrentWorkData_(source, code);
    const sh = ss.getSheetByName(sheetName);
    const last = sh.getLastRow();
    const values = last > 1 ? sh.getRange(2,1,last-1,width).getValues() : [];
    const keep = values.filter(function(r) { return String(r[storeCol] || '').trim().toUpperCase() !== (code === 'UNASSIGNED' ? '' : code); });
    const deletedRows = values.length - keep.length;
    if (deletedRows) {
      sh.getRange(2,1,values.length,width).clearContent();
      if (keep.length) sh.getRange(2,1,keep.length,width).setValues(keep);
    }
    ss.getSheetByName('ImportLog').appendRow([Utilities.getUuid(), new Date(), sheetName, '(hapus data toko)', 0, 'CLEARED',
      deletedRows + ' baris dihapus; salinan diarsipkan di WorkDataArchive.', code, 0, 0, deletedRows, currentActorEmail_()]);
    return { success: true, source: source, storeCode: code, deletedRows: deletedRows,
      message: deletedRows + ' baris ' + (source === 'shop' ? 'Shop Analytics' : 'GMV Max') + ' toko ' + code + ' dihapus. Salinan tersimpan di arsip.' };
  });
}



/* =========================================================
   TAHAP 4 — ADS PERFORMANCE DATA
   CPC/CTR/CVR hanya dihitung jika sumber menyediakan klik,
   impresi, dan konversi yang sesuai. GMV Max export saat ini
   hanya menyediakan spend, orders, gross income, dan ROI.
========================================================= */
function getAdsPerformanceData_(opts) {
  const data = getImportedAnalytics_('gmvmax', opts);
  const rows = data.rows || [];
  const bySku = {};
  rows.forEach(function(r) {
    const key = String(r.sku || 'SKU tidak disebutkan');
    if (!bySku[key]) bySku[key] = {sku:key, spend:0, orders:0, grossIncome:0, days:0};
    if (r.spend !== null) bySku[key].spend += r.spend;
    if (r.orders !== null) bySku[key].orders += r.orders;
    if (r.grossIncome !== null) bySku[key].grossIncome += r.grossIncome;
    bySku[key].days += 1;
  });
  const skuRows = Object.keys(bySku).map(function(k) {
    const x = bySku[k];
    return {
      sku:x.sku, spend:x.spend, orders:x.orders, grossIncome:x.grossIncome,
      cpa:x.orders ? x.spend/x.orders : null,
      roas:x.spend ? x.grossIncome/x.spend : null,
      days:x.days
    };
  }).sort(function(a,b) { return b.spend-a.spend; });
  return {summary:data.summary || {count:0}, rows:rows, bySku:skuRows};
}


/* TAHAP 5 — MASTER PRODUK & HPP */
function listProducts_() {
  const sh = getDatabase_().getSheetByName('Products');
  if (!sh) throw new Error('Sheet Products tidak ditemukan.');
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  return v.slice(1).filter(r => r[0] && String(r[9]).toLowerCase() !== 'false').map(r => ({
    id:String(r[0]), name:String(r[1]), category:String(r[2] || ''),
    price:num_(r[3]), cogs:num_(r[4]), packaging:num_(r[5]),
    operational:num_(r[6]), marketplaceRate:num_(r[7]), affiliateRate:num_(r[8]),
    active:String(r[9]).toLowerCase() !== 'false'
  })).reverse();
}
function saveProduct_(payload) {
  if (!payload) throw new Error('Data produk tidak ditemukan.');
  const name=String(payload.name || '').trim();
  if (!name) throw new Error('Nama produk wajib diisi.');
  const price=parseNumber_(payload.price,'Harga jual');
  const cogs=parseNumber_(payload.cogs,'HPP bahan');
  const packaging=parseNumber_(payload.packaging || 0,'Biaya kemasan');
  const operational=parseNumber_(payload.operational || 0,'Biaya operasional');
  const marketplaceRate=parseNumber_(payload.marketplaceRate || 0,'Persentase biaya marketplace');
  const affiliateRate=parseNumber_(payload.affiliateRate || 0,'Persentase komisi affiliate');
  if (marketplaceRate > 100 || affiliateRate > 100) throw new Error('Persentase biaya tidak boleh lebih dari 100%.');
  const sh=getDatabase_().getSheetByName('Products');
  const id=String(payload.id || Utilities.getUuid());
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(5000)) throw new Error('Server sibuk, coba lagi.');
  try{
    const values=sh.getDataRange().getValues();
    let target=-1;
    for(let i=1;i<values.length;i++){if(String(values[i][0])===id){target=i+1;break;}}
    if(payload.id && target<0) throw new Error('Produk yang mau diedit tidak ditemukan.');
    const before=target>0?values[target-1].slice(0,11):null;
    // Tanggal dibuat dan status aktif lama dipertahankan saat edit.
    const row=[id,name,String(payload.category || ''),price,cogs,packaging,operational,marketplaceRate,affiliateRate,
      before?before[9]:true, before&&before[10]?before[10]:new Date()];
    if(target>0) sh.getRange(target,1,1,row.length).setValues([row]);
    else sh.appendRow(row);
    auditChange_(target>0?'product-update':'product-create','Products',id,before,row);
    return {success:true,id:id,message:target>0?'Produk diperbarui.':'Produk disimpan.'};
  }finally{lock.releaseLock();}
}
/** Produk tidak dihapus permanen: dinonaktifkan agar riwayat HPP/transaksi tetap bisa ditelusuri. */
function deleteProduct_(id) {
  const sh=getDatabase_().getSheetByName('Products');
  const values=sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++){
    if(String(values[i][0])===String(id)){
      const before=values[i].slice(0,11), after=before.slice(); after[9]=false;
      sh.getRange(i+1,10).setValue(false);
      auditChange_('product-deactivate','Products',String(id),before,after);
      return {success:true,message:'Produk dinonaktifkan (tidak dihapus permanen).'};
    }
  }
  throw new Error('Produk tidak ditemukan.');
}
const KASIRKU_BRIDGE_TOKEN_PROPERTY = 'KASIRKU_BRIDGE_TOKEN';
const KASIRKU_EVENTS_SHEET = 'KasirKuEvents';

function createKasirKuBridgeToken_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty(KASIRKU_BRIDGE_TOKEN_PROPERTY);
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty(KASIRKU_BRIDGE_TOKEN_PROPERTY, token);
  }
  return {
    success: true,
    token: token,
    note: 'Salin token ini ke Script Properties project KasirKu. Jangan bagikan token.'
  };
}

function ensureKasirKuEventsSheet_() {
  const ss = getDatabase_();
  let sh = ss.getSheetByName(KASIRKU_EVENTS_SHEET);
  if (!sh) sh = ss.insertSheet(KASIRKU_EVENTS_SHEET);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Event ID', 'Transaction ID', 'Received At', 'Line Count', 'Revenue', 'Status']);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Endpoint POST yang dipanggil oleh antrean sinkronisasi KasirKu. */
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw) return bridgeJson_({ success: false, message: 'Request body kosong.' });
    const payload = JSON.parse(raw);
    // Hasil login Google yang diteruskan halaman perantara (TEAM_AUTH_REDIRECT_URL) — tanpa cookie akun Chrome.
    if (payload && payload.kind === 'team-auth') {
      teamGoogleCallback_({ code: String(payload.code || ''), state: String(payload.state || ''), error: String(payload.error || '') });
      return bridgeJson_({ success: true });
    }
    // Token per perangkat KasirKu → outlet tujuan. Token lama tetap diterima (masa peralihan).
    const device = kskResolveToken_(payload.token);
    if (!device || device.revoked) {
      return bridgeJson_({ success: false, message: device && device.revoked ? 'Token perangkat sudah dicabut.' : 'Token integrasi tidak valid.' });
    }
    if (payload.eventType !== 'kasirku.sale.created') {
      return bridgeJson_({ success: false, message: 'Jenis event tidak didukung.' });
    }
    const result = receiveKasirKuSale_(payload, device);
    try { kskTouch_(device); } catch (e) {}
    // Stok gudang outlet ikut diperbarui (idempoten); kegagalan stok tidak menggagalkan penerimaan transaksi.
    try { if (typeof stockApplySales_ === 'function') stockApplySales_(); } catch (e) { result.stockWarning = 'Stok belum diperbarui: ' + e.message; }
    return bridgeJson_(result);
  } catch (err) {
    return bridgeJson_({ success: false, message: String(err && err.message || err) });
  }
}

function bridgeJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


function receiveKasirKuSale_(payload, device) {
  const tx = payload.transaction || {};
  const eventId = String(payload.eventId || '').trim();
  const transactionId = String(tx.id || '').trim();

  if (!eventId || !transactionId) {
    throw new Error('Event ID dan ID transaksi wajib ada.');
  }

  if (!Array.isArray(tx.items) || !tx.items.length) {
    throw new Error('Item transaksi kosong.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const ss = getDatabase_();
    const events = ensureKasirKuEventsSheet_();
    const sh = ensureStoreColumn_('Transactions', SHEET_HEADERS.Transactions);
    plMarkDirty_(Utilities.formatDate(new Date(tx.occurredAt), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
    // Toko tujuan transaksi KasirKu baru diatur pemilik (Kelola tim → Toko KasirKu). Kosong = data tanpa toko.
    // Outlet ditentukan oleh token perangkat (bukan oleh isi pesan), sehingga data tidak bisa masuk ke outlet lain.
    const kasirStore = device && device.storeCode !== undefined ? String(device.storeCode || '') : String(PropertiesService.getScriptProperties().getProperty('KASIRKU_STORE_CODE') || '');

    const dateObj = new Date(tx.occurredAt);

    if (isNaN(dateObj.getTime())) {
      throw new Error('Waktu transaksi tidak valid.');
    }

    const date = Utilities.formatDate(
      dateObj,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );

    // Baca ID detail yang sudah pernah masuk.
    const existingIds = {};

    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 1)
        .getValues()
        .forEach(function(r) {
          if (r[0]) existingIds[String(r[0])] = true;
        });
    }

    let revenueCheck = 0;
    let totalUnits = 0;
    const output = [];

    tx.items.forEach(function(item, index) {
      const name = String(item.name || '').trim();
      const sku = String(item.sku || '');
      const qty = Number(item.qty);
      const price = Number(item.price);
      const cost = Number(item.cost);
      const subtotal = Number(item.subtotal);
      const profit = Number(item.profit);

      if (
        !name ||
        !Number.isInteger(qty) ||
        qty <= 0 ||
        ![price, cost, subtotal, profit].every(Number.isFinite) ||
        price < 0 ||
        cost < 0 ||
        subtotal < 0
      ) {
        throw new Error(
          'Data item ke-' + (index + 1) + ' tidak valid.'
        );
      }

      // Pertahankan subtotal dan laba asli dari KasirKu.
      // Tidak memaksa subtotal harus sama dengan harga × qty.
      revenueCheck += subtotal;
      totalUnits += qty;

      const lineId =
        'KASIRKU:' + transactionId + ':' + (index + 1);

      if (existingIds[lineId]) return;

      const notes = [
        'KasirKu',
        'Transaction ID=' + transactionId,
        'SKU=' + sku,
        'Mode=' + String(item.mode || ''),
        'Harga Satuan=' + price,
        'HPP Satuan=' + cost,
        'Uang Diterima=' + Number(tx.paid || 0),
        'Kembalian=' + Number(tx.change || 0),
        'Metode Pembayaran=' + String(tx.paymentMethod || 'Tidak dicatat'),
        'Perangkat=' + String(device && device.deviceId || 'LAMA')
      ].join('; ');

      output.push([
        lineId,
        new Date(),
        date,
        'KasirKu',
        name,
        subtotal,
        index === 0 ? 1 : 0,
        qty,
        0,
        cost * qty,
        0,
        0,
        0,
        0,
        notes,
        profit,
        profit,
        kasirStore
      ]);

      existingIds[lineId] = true;
    });

    const declaredTotal = Number(tx.total);

    if (
      !Number.isFinite(declaredTotal) ||
      Math.abs(revenueCheck - declaredTotal) > 1
    ) {
      throw new Error(
        'Total transaksi tidak cocok dengan jumlah subtotal sumber: ' +
        transactionId
      );
    }

    // Tambahkan hanya detail yang belum ada.
    if (output.length) {
      ensureRoom_(sh, output.length, output[0].length).getRange(sh.getLastRow() + 1, 1, output.length, output[0].length).setValues(output);
    }

    // Perbarui event lama atau catat event baru.
    let eventRow = 0;

    if (events.getLastRow() > 1) {
      const found = events.getRange(
        2, 1, events.getLastRow() - 1, 1
      )
      .createTextFinder(eventId)
      .matchEntireCell(true)
      .findNext();

      if (found) eventRow = found.getRow();
    }

    const eventData = [
      eventId,
      transactionId,
      new Date(),
      tx.items.length,
      revenueCheck,
      'IMPORTED'
    ];

    if (eventRow) {
      events.getRange(eventRow, 1, 1, 6)
        .setValues([eventData]);
    } else {
      events.appendRow(eventData);
    }

    return {
      success: true,
      duplicate: output.length === 0,
      eventId: eventId,
      transactionId: transactionId,
      rowsImported: output.length,
      totalItems: tx.items.length,
      units: totalUnits,
      revenue: revenueCheck,
      message: output.length
        ? 'Detail transaksi berhasil disinkronkan.'
        : 'Semua detail transaksi sudah tersedia.'
    };

  } finally {
    lock.releaseLock();
  }
}


function tampilkanTokenKasirKu_() {
  const token = PropertiesService
    .getScriptProperties()
    .getProperty(KASIRKU_BRIDGE_TOKEN_PROPERTY);

  console.log('TOKEN KASIRKU: ' + token);
}
function gantiTokenKasirKu_() {
  const token = Utilities.getUuid().replace(/-/g, '') +
                Utilities.getUuid().replace(/-/g, '');

  PropertiesService.getScriptProperties()
    .setProperty('KASIRKU_BRIDGE_TOKEN', token);

  Logger.log('TOKEN BARU: ' + token);
}
function cekDatabaseAktif_() {
  const ss = getDatabase_();
  const tx = ss.getSheetByName('Transactions');
  const ev = ss.getSheetByName('KasirKuEvents');

  Logger.log('DATABASE: ' + ss.getId());
  Logger.log('TRANSACTIONS LAST ROW: ' + tx.getLastRow());
  Logger.log('EVENTS LAST ROW: ' + ev.getLastRow());

  if (ev.getLastRow() > 1) {
    Logger.log('EVENT TERAKHIR: ' +
      JSON.stringify(ev.getRange(ev.getLastRow(), 1, 1, 6).getDisplayValues()));
  }

  if (tx.getLastRow() > 1) {
    Logger.log('TRANSAKSI TERAKHIR: ' +
      JSON.stringify(tx.getRange(tx.getLastRow(), 1, 1, 17).getDisplayValues()));
  }
}
function cekIdKasirKu_() {
  const ss = getDatabase_();
  const sh = ss.getSheetByName('Transactions');
  const ev = ss.getSheetByName('KasirKuEvents');

  const event = ev.getRange(ev.getLastRow(), 1, 1, 6).getDisplayValues()[0];
  const transactionId = event[1];
  const expectedId = 'KASIRKU:' + transactionId + ':1';

  Logger.log('TRANSACTION ID: ' + transactionId);
  Logger.log('EXPECTED ROW ID: ' + expectedId);
  Logger.log('TRANSACTIONS LAST ROW: ' + sh.getLastRow());

  if (sh.getLastRow() > 1) {
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
    Logger.log('EXISTING IDS: ' + JSON.stringify(ids));
  } else {
    Logger.log('BELUM ADA ID TRANSAKSI.');
  }
}




/** Pastikan sheet punya cukup baris/kolom sebelum menulis n baris lebar w di bawah baris terakhir (menambah otomatis). Mengembalikan sheet. */
function ensureRoom_(sh, n, w) {
  try {
    const need = sh.getLastRow() + Math.max(1, Number(n) || 1), maxR = sh.getMaxRows();
    if (maxR < need) sh.insertRowsAfter(maxR, need - maxR + 200);
    const maxC = sh.getMaxColumns(), wc = Number(w) || 0;
    if (wc && maxC < wc) sh.insertColumnsAfter(maxC, wc - maxC);
  } catch (e) { if (!/is not a function/.test(e.message)) throw e; }
  return sh;
}
