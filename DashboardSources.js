/** Sumber dashboard dipilih, tidak dijumlahkan lintas laporan. */
function getSelectedDashboardData_(filters) {
  const f=filters||{},source=f.dashboardSource;
  if(!['shop','ads','tts'].includes(source))throw new Error('Sumber dashboard tidak dikenali.');
  ['startDate','endDate'].forEach(k=>{if(f[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(f[k]))throw new Error('Format tanggal tidak valid.');});
  if(f.startDate&&f.endDate&&f.startDate>f.endDate)throw new Error('Urutan tanggal tidak valid.');
  const opt={storeCode:String(f.storeCode||'')};const data=source==='shop'?getShopFlexibleAnalytics_(opt):source==='tts'?ttsDashboardRows_(opt):getImportedAnalytics_('gmvmax',opt);
  return buildSelectedDashboard_(data,source,f);
}
function buildSelectedDashboard_(data,source,f) {
  let excludedDates=0;const rows=(data.rows||[]).filter(r=>{const date=normalizeImportDate_(r.date);if(!date){excludedDates++;return false;}r.date=date;return (!f.startDate||date>=f.startDate)&&(!f.endDate||date<=f.endDate);});
  const groups=Object.create(null);
  rows.forEach(r=>{const raw=String(r.currency||'').toUpperCase();const currency=source==='shop'?'IDR':['RP','RUPIAH'].includes(raw)?'IDR':raw||'UNKNOWN';
    if(!groups[currency])groups[currency]={currency:currency,revenue:0,orders:0,units:0,spend:0,count:0,days:Object.create(null)};
    const g=groups[currency],revenue=num_(source==='ads'?r.grossIncome:r.gmv),spend=source==='ads'?num_(r.spend):0;
    g.revenue+=revenue;g.spend+=spend;g.orders+=num_(r.orders);g.units+=num_(r.units);g.count++;
    if(!g.days[r.date])g.days[r.date]={date:r.date,revenue:0,spend:0,orders:0};g.days[r.date].revenue+=revenue;g.days[r.date].spend+=spend;g.days[r.date].orders+=num_(r.orders);
  });
  return {source:source,excludedDates:excludedDates,meta:data.importMeta||null,groups:Object.keys(groups).sort().map(k=>{const g=groups[k];g.roas=g.spend?g.revenue/g.spend:null;g.daily=Object.keys(g.days).sort().map(d=>g.days[d]);delete g.days;return g;}),note:source==='tts'?'Sumber: TikTok Shop API (TTS_Orders). Nilai pesanan = subtotal produk setelah diskon, tanpa ongkir; pesanan UNPAID/CANCELLED tidak dihitung'+(data.excludedNonSale?' ('+data.excludedNonSale+' pesanan dikecualikan)':'')+'. Bukan dana cair atau profit. Tidak dijumlahkan dengan impor Excel.':source==='shop'?'Sumber: snapshot Shop Analytic. Nilai pesanan/GMV bukan dana cair atau profit. Filter marketplace transaksi tidak berlaku.':'Sumber: GMV Max / Ads. Penghasilan atribusi bukan seluruh omzet toko atau profit. Filter marketplace transaksi tidak berlaku.'};
}

