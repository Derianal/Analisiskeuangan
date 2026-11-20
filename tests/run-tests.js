// Jalankan: node tests/run-tests.js  (menguji kode Apps Script dengan Sheets tiruan, tanpa data produksi)
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeEnv } = require('./gas-mock');
const root = path.join(__dirname, '..');
const files = ['Kode.js', 'Finance.js', 'TeamAccess.js', 'Access.js', 'ImportFields.js', 'TikTokShop.js', 'Ledger.js', 'Stock.js', 'KasirKuDevices.js', 'Summary.js', 'Shopee.js', 'SkuMap.js', 'Notify.js', 'Orders.js', 'Fulfill.js', 'ProductData.js', 'Capacity.js', 'Permissions.js', 'ShopImport.js', 'DashboardSources.js', 'AI_DataByte.js', 'Advertiser.js', 'WorkPlanner.js'];
const code = files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n');
// Skenario tahap 1–3 berbagi variabel; skenario TikTok dibungkus blok sendiri agar nama variabel tidak bentrok.
const shared = ['scenarios.js', 'scenarios-tahap2.js', 'scenarios-tahap3.js'].map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n;\n');
const tests = shared + '\n;\n{\n' + fs.readFileSync(path.join(__dirname, 'scenarios-tts.js'), 'utf8') + '\n}\n{\n' + fs.readFileSync(path.join(__dirname, 'scenarios-ledger.js'), 'utf8') + '\n}\n{\n' + fs.readFileSync(path.join(__dirname, 'scenarios-stock.js'), 'utf8') + '\n}\n{\n' + fs.readFileSync(path.join(__dirname, 'scenarios-kasirku.js'), 'utf8') + '\n}\n{\n' + fs.readFileSync(path.join(__dirname, 'scenarios-summary.js'), 'utf8') + '\n}\n{\n' + fs.readFileSync(path.join(__dirname, 'scenarios-shopee.js'), 'utf8') + '\n}\n';
const env = makeEnv();
const ctx = vm.createContext(Object.assign({ __env: env, require, __testsDir: __dirname, URL }, env.globals));
vm.runInContext(code + '\n;\n' + tests, ctx, { filename: 'gas-bundle.js' });
