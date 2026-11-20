/** Grafik advertiser dari data tersimpan. Tidak mengubah iklan atau transaksi. */
function getAdvertiserInsights_(filters) {
  aiAuthorize_();
  const f=filters||{},start=String(f.startDate||''),end=String(f.endDate||'');
  [start,end].forEach(v=>{if(v&&!/^\d{4}-\d{2}-\d{2}$/.test(v))throw new Error('Format tanggal tidak valid.');});
  if(start&&end&&start>end)throw new Error('Urutan tanggal tidak valid.');
  const dateKey_=v=>{const d=parseDate_(v);return d&&!isNaN(d.getTime())?Utilities.formatDate(d,Session.getScriptTimeZone(),'yyyy-MM-dd'):'';};
  const inside=d=>d&&(!start||d>=start)&&(!end||d<=end);
  const ss=getDatabase_(),sh=ss.getSheetByName('Transactions');
  if(!sh)throw new Error('Sheet Transactions tidak ditemukan.');
  const values=sh.getDataRange().getValues(),headers=values[0]||[];
  const required=['Transaction Date','Marketplace','Revenue','Ad Spend','COGS','Marketplace Fees','Affiliate Commission','Voucher Cost','Other Costs'];
  required.forEach(k=>{if(headers.indexOf(k)<0)throw new Error('Kolom transaksi belum sesuai: '+k);});
  const ix=k=>headers.indexOf(k),days=Object.create(null),totals={revenue:0,spend:0,cogs:0,fees:0,affiliate:0,voucher:0,other:0,profit:0},quality={rows:0,blankCostRows:0,zeroCostRows:0,invalidDates:0,storedProfit:0};
  const storeOk=transactionStoreFilter_(f.storeCode);values.slice(1).forEach(r=>{if(!storeOk(r))return;
    const app=String(r[ix('Marketplace')]||'').trim(),want=String(f.sourceApp||'Semua Aplikasi').trim();
    if(want!=='Semua Aplikasi'&&app.toLowerCase()!==want.toLowerCase())return;
    const d=dateKey_(r[ix('Transaction Date')]);if(!d){quality.invalidDates++;return;}if(!inside(d))return;
    const item={revenue:num_(r[ix('Revenue')]),spend:num_(r[ix('Ad Spend')]),cogs:num_(r[ix('COGS')]),fees:num_(r[ix('Marketplace Fees')]),affiliate:num_(r[ix('Affiliate Commission')]),voucher:num_(r[ix('Voucher Cost')]),other:num_(r[ix('Other Costs')])};
    const costNames=['Ad Spend','COGS','Marketplace Fees','Affiliate Commission','Voucher Cost','Other Costs'];
    if(costNames.some(k=>r[ix(k)]===''||r[ix(k)]==null))quality.blankCostRows++;
    if(costNames.some(k=>num_(r[ix(k)])===0))quality.zeroCostRows++;
    quality.storedProfit+=headers.indexOf('Net Profit')>=0?num_(r[ix('Net Profit')]):0;
    item.profit=item.revenue-item.spend-item.cogs-item.fees-item.affiliate-item.voucher-item.other;
    if(!days[d])days[d]={date:d,revenue:0,spend:0,cogs:0,fees:0,affiliate:0,voucher:0,other:0,profit:0};
    Object.keys(totals).forEach(k=>{totals[k]+=item[k];days[d][k]+=item[k];});quality.rows++;
  });
  const imports=getImportedAnalytics_('gmvmax',{storeCode:String(f.storeCode||'')}),groups=Object.create(null);let invalidImportDates=0;
  (imports.rows||[]).forEach(r=>{
    const d=dateKey_(r.date);if(!d){invalidImportDates++;return;}if(!inside(d))return;
    const raw=String(r.currency||'').trim().toUpperCase(),currency=['RP','RUPIAH'].includes(raw)?'IDR':raw||'UNKNOWN';
    if(!groups[currency])groups[currency]={currency:currency,days:Object.create(null),products:Object.create(null),rows:0};
    const g=groups[currency];g.rows++;
    if(!g.days[d])g.days[d]={date:d,spend:0,revenue:0,orders:0};
    const sku=String(r.sku||'Tanpa SKU');if(!g.products[sku])g.products[sku]={sku:sku,spend:0,revenue:0,orders:0};
    ['spend','revenue','orders'].forEach(k=>{const n=num_(r[k==='revenue'?'grossIncome':k]);g.days[d][k]+=n;g.products[sku][k]+=n;});
  });
  return {filters:{sourceApp:f.sourceApp||'Semua Aplikasi',startDate:start,endDate:end,storeCode:String(f.storeCode||'')},transactions:{currency:'IDR',totals:totals,quality:quality,daily:Object.keys(days).sort().map(k=>days[k])},gmvmax:{invalidDates:invalidImportDates,currencies:Object.keys(groups).sort().map(k=>{const g=groups[k];return {currency:k,rows:g.rows,daily:Object.keys(g.days).sort().map(d=>g.days[d]),products:Object.keys(g.products).map(s=>g.products[s]).sort((a,b)=>b.spend-a.spend).slice(0,30)};})},notes:['Profit dihitung dari omzet dikurangi biaya yang tercatat; belum memverifikasi kelengkapan biaya.','Nol biaya belum membuktikan biaya lengkap.','GMV Max mengikuti tanggal dan mencakup seluruh aplikasi. Data tidak digabung dengan transaksi.','Tanggal tanpa catatan tidak dianggap nol. Impor yang tumpang tindih bisa menggandakan hasil; periksa sumber impor.','Tidak ada alokasi biaya iklan GMV Max ke profit produk tanpa pemetaan yang memadai.']};
}

