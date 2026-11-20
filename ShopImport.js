/** Shop detail dan ringkasan. Satu snapshot aktif, tidak menggabungkan kedua laporan. */
function importShopFlexibleRows_(payload) {
  if(!payload||!Array.isArray(payload.rows)||!payload.rows.length)throw new Error('File hanya berisi header atau tidak memiliki baris pesanan. Data lama tetap disimpan.');
  if(payload.rows.length>20000)throw new Error('Maksimal 20.000 baris per file. Ekspor periode lebih pendek.');
  const store=requireStoreCode_(payload.storeCode);
  const mapped=applyColumnMap_(payload.rows,payload.kind==='orders'?'shopOrders':'shopSummary',payload.columnMap);
  const prepared=prepareShopFlexible_(mapped,payload.kind);
  if(payload.dryRun){const preview=importShopAnalyticsRows_({fileName:payload.fileName,rows:prepared.rows,storeCode:store.code,dryRun:true});preview.kind=prepared.kind;preview.prepareNote=prepared.message;preview.columns=detectColumns_(payload.rows,prepared.kind==='orders'?'shopOrders':'shopSummary',payload.columnMap);preview.headers=payload.headers||[];return preview;}

  return withScriptLock_(()=>{
    if(typeof archiveCurrentWorkData_==='function')archiveCurrentWorkData_('shop',store.code);
    const result=importShopAnalyticsRows_({fileName:payload.fileName,rows:prepared.rows,storeCode:store.code});
    PropertiesService.getScriptProperties().setProperty('SHOP_IMPORT_META:'+store.code,JSON.stringify({kind:prepared.kind,storeCode:store.code,importId:result.importId,fileName:String(payload.fileName||'File Excel').slice(0,200),note:prepared.message,unitsAvailable:payload.rows.every(r=>pickImport_(r,['quantity','jumlah','qty','jumlah produk'])!=='')}));
    result.message=prepared.message+' '+result.message+' Tanggal yang sama di toko ini diperbarui, bukan dijumlahkan; toko lain tidak tersentuh.';
    if(typeof archiveWorkImport_==='function'){try{archiveWorkImport_(payload,prepared,result);}catch(e){result.message+=' Data aktif tersimpan, tetapi arsip gagal: '+e.message;}}
    return result;
  });
}
function prepareShopFlexible_(rows,kind) {
  const pick=(r,a)=>pickImport_(r,a),norm=v=>String(v==null?'':v).trim();
  const ids=aliasesOf_('shopOrders','orderId');
  const dates=aliasesOf_('shopOrders','date');
  const totals=aliasesOf_('shopOrders','total');
  const amounts=aliasesOf_('shopOrders','line');
  const qtys=aliasesOf_('shopOrders','qty');
  const number=v=>{if(v===''||v==null)return null;if(typeof v==='number'){if(!isFinite(v))throw new Error('Nominal tidak valid.');return v;}let s=String(v).trim().replace(/(?:IDR|Rp)\s*/gi,'').replace(/\s/g,'');if(!/^-?[\d.,]+$/.test(s))throw new Error('Nominal atau jumlah tidak dikenali.');if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');else if(s.includes(','))s=/^\d{1,3}(,\d{3})+$/.test(s)?s.replace(/,/g,''):s.replace(',','.');const n=Number(s);if(!isFinite(n))throw new Error('Angka tidak valid.');return n;};
  if(kind!=='orders') {
    const out=rows.map((r,i)=>{const d=normalizeImportDate_(pick(r,aliasesOf_('shopSummary','date')));if(!d)throw new Error('Tanggal ringkasan tidak valid pada baris data '+(i+1)+'. Data lama tetap disimpan.');const gmv=pick(r,aliasesOf_('shopSummary','gmv'));const count=pick(r,aliasesOf_('shopSummary','orders'));if(gmv===''&&count==='')throw new Error('Kolom GMV atau jumlah pesanan tidak ditemukan.');const o=Object.assign({},r,{date:d});if(gmv!=='')o.gmv=number(gmv);if(count!=='')o.orders=number(count);return o;});
    return {kind:'summary',rows:out,message:'Laporan ringkasan dikenali.'};
  }
  let descriptionRows=0;
  rows=rows.filter((r,i)=>{const explanation=i===0&&/order created time/i.test(String(pick(r,dates)))&&/order.*(?:id|identifier)|unique.*order/i.test(String(pick(r,ids)));if(explanation)descriptionRows++;return !explanation;});
  if(!rows.length)throw new Error('File hanya memiliki header dan penjelasan kolom, belum ada pesanan.');
  const orderDate=v=>{const text=norm(v),m=text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);if(!m)return normalizeImportDate_(v);const y=Number(m[3]),mo=Number(m[2]),d=Number(m[1]),check=new Date(Date.UTC(y,mo-1,d));return check.getUTCFullYear()===y&&check.getUTCMonth()===mo-1&&check.getUTCDate()===d?m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'):'';};
  const orders=Object.create(null);let duplicates=0,excluded=0,unknownStatus=0;
  rows.forEach((r,i)=>{
    const id=norm(pick(r,ids));if(!id)throw new Error('Nomor pesanan kosong pada baris data '+(i+1)+'. Impor dibatalkan.');
    const status=norm(pick(r,aliasesOf_('shopOrders','status'))).toLowerCase();
    const currency=norm(pick(r,aliasesOf_('shopOrders','currency'))).toUpperCase();if(currency&&!['IDR','RP','RUPIAH'].includes(currency))throw new Error('Shop saat ini hanya mendukung IDR. Mata uang lain tidak dikonversi otomatis.');
    const date=orderDate(pick(r,dates));if(!date)throw new Error('Tanggal dibuat tidak valid pada baris data '+(i+1)+'. Nomor pesanan saja belum cukup untuk grafik.');
    const omit=/cancel|batal|unpaid|belum bayar|belum dibayar|awaiting payment/.test(status);
    const total=number(pick(r,totals)),line=number(pick(r,amounts)),qty=number(pick(r,qtys));
    if(total==null&&line==null)throw new Error('Kolom nilai pesanan/subtotal produk tidak ditemukan. Harga satuan tidak dianggap total pesanan.');
    if((total!=null&&total<0)||(line!=null&&line<0)||(qty!=null&&(qty<0||!Number.isInteger(qty))))throw new Error('Nilai pesanan atau kuantitas tidak valid.');
    if(!orders[id])orders[id]={date:date,status:status,total:total,lines:0,qty:0,seen:Object.create(null),omit:omit};
    const o=orders[id];if(o.date!==date||o.status!==status||(o.total!=null&&total!=null&&o.total!==total))throw new Error('Data satu pesanan tidak konsisten. Impor dibatalkan agar total tidak salah.');
    if(o.total==null&&total!=null)o.total=total;
    // Tanpa identitas baris, jangan menebak apakah dua produk identik adalah duplikat.
    const lineId=norm(pick(r,aliasesOf_('shopOrders','lineId')));
    if(!lineId&&o.count)throw new Error('Pesanan memiliki beberapa baris tanpa ID item/SKU. Tambahkan kolom ID item dari ekspor asli.');
    const signature=JSON.stringify([line,qty]);if(lineId&&o.seen[lineId]){if(o.seen[lineId]!==signature)throw new Error('SKU berulang dengan nilai berbeda; gunakan ekspor dengan ID item unik.');duplicates++;return;}
    if(lineId)o.seen[lineId]=signature;o.count=(o.count||0)+1;o.lines+=line||0;o.qty+=qty||0;
  });
  const days=Object.create(null);
  Object.keys(orders).forEach(id=>{const o=orders[id];if(o.omit){excluded++;return;}if(!o.status)unknownStatus++;if(!days[o.date])days[o.date]={date:o.date,gmv:0,orders:0,'units sold':0};const d=days[o.date];d.gmv+=o.total==null?o.lines:o.total;d.orders++;d['units sold']+=o.qty;});
  const out=Object.keys(days).sort().map(d=>days[d]);if(!out.length)throw new Error('Tidak ada pesanan yang dapat dihitung setelah status batal/belum bayar dikecualikan. Data lama tetap disimpan.');
  return {kind:'orders',rows:out,message:descriptionRows+' baris penjelasan kolom dilewati. Detail pesanan: '+Object.keys(orders).length+' ID unik; '+duplicates+' baris duplikat dilewati; '+excluded+' pesanan batal/belum bayar dikecualikan. '+unknownStatus+' pesanan tanpa status. Nilai ini nilai pesanan, bukan pencairan atau profit. Retur/refund belum direkonsiliasi.'};
}

function getShopFlexibleAnalytics_(opts){
  const data=getImportedAnalytics_('shop',opts);
  const code=data.storeCode;
  if(code&&code!=='UNASSIGNED'){let meta=null;try{meta=JSON.parse(PropertiesService.getScriptProperties().getProperty('SHOP_IMPORT_META:'+code)||'null');}catch(e){}
    if(meta)data.importMeta=meta;}
  return data;
}
