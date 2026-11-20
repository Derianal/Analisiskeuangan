// Simulasi minimal layanan Google Apps Script untuk pengujian lokal (bukan data produksi).
const crypto = require('crypto');
function makeEnv() {
  const props = {}, cache = {};
  const sheets = {};
  function fmtDate(d, tz, f) {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: tz === 'UTC' ? 'UTC' : 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(d).forEach(p => parts[p.type] = p.value);
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(parts.month) - 1];
    return f.replace("'T'", 'T').replace('yyyy', parts.year).replace('MMM', mon).replace('MM', parts.month).replace('dd', parts.day)
      .replace('HH', parts.hour === '24' ? '00' : parts.hour).replace('mm', parts.minute).replace('ss', parts.second).replace(/\byy\b/, parts.year.slice(2));
  }
  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = this.sh.data[this.r - 1 + i] || []; const o = []; for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined || v === null ? '' : v); } out.push(o); } return out; }
    getDisplayValues() { return this.getValues().map(r => r.map(String)); }
    getValue() { return this.getValues()[0][0]; }
    setValues(v) { if (v.length !== this.nr || v.some(r => r.length !== this.nc)) throw new Error('Ukuran setValues tidak cocok'); v.forEach((row, i) => { const t = this.sh.data[this.r - 1 + i] || (this.sh.data[this.r - 1 + i] = []); row.forEach((x, j) => { if (typeof x === 'number' && !isFinite(x)) throw new Error('NaN/Infinity ditulis ke sheet'); t[this.c - 1 + j] = x; }); }); return this; }
    setValue(x) { return this.setValues([[x]]); }
    clearContent() { for (let i = 0; i < this.nr; i++) { const t = this.sh.data[this.r - 1 + i]; if (t) for (let j = 0; j < this.nc; j++) t[this.c - 1 + j] = ''; } this.sh.trim(); return this; }
    setFontWeight() { return this; } setBackground() { return this; }
    createTextFinder(t) { const self = this; return { matchEntireCell() { return this; }, findNext() { const v = self.getValues(); for (let i = 0; i < v.length; i++) if (String(v[i][0]) === t) return { getRow: () => self.r + i }; return null; } }; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.maxR = 1000; this.maxC = 26; }
    getMaxRows() { return Math.max(this.maxR, this.data.length); } getMaxColumns() { return this.maxC; }
    insertRowsAfter(a, n) { this.maxR = this.getMaxRows() + n; } insertColumnsAfter(a, n) { this.maxC += n; }
    deleteRows(a, n) { this.data.splice(a - 1, n); this.maxR -= n; } deleteColumns(a, n) { this.maxC -= n; }
    trim() { while (this.data.length && this.data[this.data.length - 1].every(v => v === '' || v == null)) this.data.pop(); }
    getLastRow() { this.trim(); return this.data.length; }
    getLastColumn() { return this.data.reduce((m, r) => { let n = r.length; while (n && (r[n - 1] === '' || r[n - 1] == null)) n--; return Math.max(m, n); }, 0); }
    getRange(r, c, nr, nc) { if (r + (nr || 1) - 1 > this.getMaxRows() || c + (nc || 1) - 1 > this.maxC) throw new Error('Those rows/columns are out of bounds (' + this.name + ')'); return new Range(this, r, c, nr || 1, nc || 1); }
    getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    appendRow(row) { this.data[this.getLastRow()] = row.slice(); if (this.data.length > this.maxR) this.maxR = this.data.length; if (row.length > this.maxC) this.maxC = row.length; }
    deleteRow(i) { this.data.splice(i - 1, 1); }
    setFrozenRows() {} autoResizeColumns() {}
    getName() { return this.name; }
  }
  const ss = { getSheets: () => Object.values(sheets), getName: () => 'analasis marketplace', getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), getUrl: () => 'mock://db', getId: () => 'MOCKDB' };
  const others = {};
  function makeSS(id, name) { const sh = {}; return { name, sheets: sh, getSheetByName: n => sh[n] || null, insertSheet: n => (sh[n] = new Sheet(n)), getUrl: () => 'mock://' + id, getId: () => id }; }
  props.ECOMMERCE_ANALYTICS_SPREADSHEET_ID = 'MOCKDB';
  const lock = () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true });
  const g = {
    console, Logger: { log: () => {} },
    DriveApp: (() => { const files = [], folders = {}; let n = 0;
      const mkFile = (name, created) => { const f = { id: 'F' + (++n), name, created: created || new Date(Date.now() + n * 1000), trashed: false, getName: () => f.name, getUrl: () => 'mock://drive/' + f.id, getId: () => f.id, getDateCreated: () => f.created, setTrashed: v => { f.trashed = v; } }; return f; };
      const mkFolder = name => { const fo = { id: 'D' + (++n), name, files: [], parent: null, isTrashed: () => false, getId: () => fo.id, getUrl: () => 'mock://folder/' + fo.id, createFolder: nm => { const c = mkFolder(nm); c.parent = fo.id; return c; }, moveTo: d => { fo.parent = d.id; }, getFiles: () => { const l = fo.files.filter(f => !f.trashed); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; } }; folders[fo.id] = fo; return fo; };
      const DA = { _folders: folders, getStorageUsed: () => 2 * 1073741824, getStorageLimit: () => 15 * 1073741824, createFolder: mkFolder, getFolderById: id => { if (!folders[id]) throw new Error('no folder'); return folders[id]; },
        _moves: [], getFileById: id => ({ moveTo: d => { DA._moves.push([id, d.id]); }, makeCopy: (name, folder) => { const f = mkFile(name); folder.files.push(f); return f; } }) }; return DA; })(),
    SpreadsheetApp: { openById: id => others[id] || ss, create: name => { const id = 'SS' + (Object.keys(others).length + 1); return (others[id] = makeSS(id, name)); } },
    PropertiesService: { getScriptProperties: () => ({ getKeys: () => Object.keys(props), getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: lock, getUserLock: lock },
    CacheService: { getScriptCache: () => cacheApi, getUserCache: () => cacheApi },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta', getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => 'owner@gmail.com' }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(), formatDate: fmtDate,
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (a, s) => Array.from(crypto.createHash('sha256').update(String(s)).digest()).map(b => b > 127 ? b - 256 : b),
      base64EncodeWebSafe: b => Buffer.from(b.map(x => x < 0 ? x + 256 : x)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', key).update(value, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      sleep: () => {}
    },
    HtmlService: {
      createHtmlOutput: html => { const o = { content: html, addMetaTag: () => o, setTitle: () => o, getContent: () => html }; return o; },
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
      createHtmlOutputFromFile: f => { const o = { file: f, addMetaTag: () => o, setTitle: () => o, setXFrameOptionsMode: m => { o.xframe = m; return o; } }; return o; }
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => { const o = { text: t, setMimeType: () => o }; return o; } },
    UrlFetchApp: { fetch: (url, opt) => { if (!env.fetchHandler) throw new Error('UrlFetchApp tidak disimulasikan'); return env.fetchHandler(url, opt || {}); } },
    ScriptApp: {
      getScriptId: () => 'SCRIPT1', _t: [], getProjectTriggers() { return this._t; }, deleteTrigger(t) { this._t = this._t.filter(x => x !== t); },
      newTrigger(fn) { const self = this, b = { timeBased: () => b, everyDays: () => b, atHour: () => b, inTimezone: () => b, create: () => { const t = { getHandlerFunction: () => fn }; self._t.push(t); return t; } }; return b; }
    }
  };
  const cacheApi = { get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } };
  const env = { globals: g, sheets, props, cache, ss, others, fetchHandler: null };
  return env;
}
module.exports = { makeEnv };
