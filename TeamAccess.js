/** Login Google server-side OAuth, allowlist <=5, semua data melalui teamRpc. */
let TEAM_REQUEST_CONTEXT_=null;
function teamProperties_(){return PropertiesService.getScriptProperties();}
function teamRandom_(){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');}
function teamHash_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s),Utilities.Charset.UTF_8).map(b=>(b<0?b+256:b).toString(16).padStart(2,'0')).join('');}
function teamConfig_(){const p=teamProperties_(),client=p.getProperty('TEAM_GOOGLE_CLIENT_ID'),secret=p.getProperty('TEAM_GOOGLE_CLIENT_SECRET'),url=p.getProperty('TEAM_APP_URL');if(!client||!secret||!url||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))throw new Error('Pemilik perlu mengisi TEAM_GOOGLE_CLIENT_ID, TEAM_GOOGLE_CLIENT_SECRET dan TEAM_APP_URL terlebih dahulu.');const redirect=p.getProperty('TEAM_AUTH_REDIRECT_URL')||url;if(!/^https:\/\/[a-z0-9.-]+\/[^\s?#]*$/i.test(redirect))throw new Error('TEAM_AUTH_REDIRECT_URL tidak valid.');return {client:client,secret:secret,url:url,redirect:redirect};}
function teamMembers_(){let raw;try{raw=JSON.parse(teamProperties_().getProperty('TEAM_MEMBERS_JSON')||'{}');}catch(e){throw new Error('Daftar anggota belum valid.');}if(!raw||Array.isArray(raw)||typeof raw!=='object')throw new Error('Daftar anggota harus objek JSON.');const result={};Object.keys(raw).forEach(email=>{const key=email.trim().toLowerCase(),role=raw[email];if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)||!TEAM_ROLES_.includes(role))throw new Error('Daftar tim harus email dengan peran yang dikenal.');result[key]=role;});const keys=Object.keys(result);if(!keys.length||keys.length>TEAM_MAX_||keys.filter(e=>result[e]==='owner').length!==1)throw new Error('Isi 1–'+TEAM_MAX_+' email tim, dengan tepat satu owner.');return result;}
function siapkanAksesTim(){
 const active=String(Session.getActiveUser().getEmail()||'').toLowerCase(),effective=String(Session.getEffectiveUser().getEmail()||'').toLowerCase();
 if(!active||active!==effective)throw new Error('Jalankan dari editor Apps Script memakai akun pemilik project.');
 if(!/^[^@\s]+@gmail\.com$/.test(active))throw new Error('Paket tim ini menggunakan Gmail. Akun pemilik belum dikenali sebagai Gmail.');
 teamConfig_();
 const props=teamProperties_(),raw=props.getProperty('TEAM_MEMBERS_JSON');let parsed={};
 if(raw){try{parsed=JSON.parse(raw);}catch(e){throw new Error('Daftar lama bukan JSON valid. Hapus hanya TEAM_MEMBERS_JSON lalu jalankan fungsi ini lagi.');}}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Daftar lama bukan objek anggota. Hapus hanya TEAM_MEMBERS_JSON lalu jalankan fungsi ini lagi.');
 const members={};Object.keys(parsed).forEach(email=>{const key=email.trim().toLowerCase(),role=parsed[email];if(!/^[^@\s]+@gmail\.com$/.test(key)||!TEAM_ROLES_.includes(role))throw new Error('Ada email/peran tidak valid pada daftar lama. Hapus hanya TEAM_MEMBERS_JSON bila daftar itu belum dipakai tim.');members[key]=role;});
 if(Object.keys(members).some(email=>email!==active&&members[email]==='owner'))throw new Error('Ada owner lain dalam daftar. Tidak diubah otomatis; periksa akun pemilik project.');
 members[active]='owner';if(Object.keys(members).length>5)throw new Error('Anggota melebihi lima orang. Daftar tidak diubah.');
 const updated=JSON.stringify(members);if(raw&&raw!==updated)props.setProperty('TEAM_MEMBERS_JSON_BACKUP',raw);
 props.setProperty('TEAM_MEMBERS_JSON',updated);teamMembers_();
 const message='BERHASIL: akun editor terdaftar sebagai pemilik. '+Object.keys(members).length+' anggota aktif. Selanjutnya deployment Versi baru dan buka ulang aplikasi.';
 Logger.log(message);return message;
}
function teamBeginLogin(proofHash){teamConfig_();teamMembers_();if(!/^[a-f0-9]{64}$/.test(String(proofHash)))throw new Error('Permintaan login tidak valid.');const cfg=teamConfig_(),state=teamRandom_(),verifier=teamRandom_(),challenge=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,verifier,Utilities.Charset.UTF_8)).replace(/=+$/,'');CacheService.getScriptCache().put('team:pending:'+state,JSON.stringify({proof:proofHash,verifier:verifier,issued:Date.now()}),600);const q={client_id:cfg.client,redirect_uri:cfg.redirect,response_type:'code',scope:'openid email profile',state:state,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'};return {state:state,url:'https://accounts.google.com/o/oauth2/v2/auth?'+Object.keys(q).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(q[k])).join('&')};}
function teamGoogleCallback_(parameters){const state=String(parameters.state||'');if(!/^[a-f0-9]{64}$/i.test(state))return teamCallbackPage_('Permintaan login tidak valid.');const cache=CacheService.getScriptCache(),raw=cache.get('team:pending:'+state);if(!raw)return teamCallbackPage_('Login kedaluwarsa. Mulai ulang dari aplikasi.');let pending=JSON.parse(raw);if(pending.used)return teamCallbackPage_('Callback login sudah diproses. Kembali ke aplikasi.');pending.used=true;cache.put('team:pending:'+state,JSON.stringify(pending),600);
 try{if(parameters.error||!parameters.code)throw new Error('Login dibatalkan atau ditolak Google.');const cfg=teamConfig_();const tokenResponse=UrlFetchApp.fetch('https://oauth2.googleapis.com/token',{method:'post',payload:{client_id:cfg.client,client_secret:cfg.secret,code:String(parameters.code),redirect_uri:cfg.redirect,grant_type:'authorization_code',code_verifier:pending.verifier},muteHttpExceptions:true});if(tokenResponse.getResponseCode()!==200)throw new Error('Google belum menerima konfigurasi login. Periksa Client ID, secret dan redirect URI.');const token=JSON.parse(tokenResponse.getContentText());if(!token.access_token||String(token.token_type).toLowerCase()!=='bearer')throw new Error('Respons token Google tidak valid.');const identityResponse=UrlFetchApp.fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token},muteHttpExceptions:true});if(identityResponse.getResponseCode()!==200)throw new Error('Identitas Google tidak dapat diverifikasi.');const profile=JSON.parse(identityResponse.getContentText()),email=String(profile.email||'').toLowerCase();if(profile.email_verified!==true||!profile.sub||!/^[^@\s]+@gmail\.com$/.test(email))throw new Error('Akun Google ini belum diizinkan bergabung ke tim.');const sub=String(profile.sub),lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw new Error('Server sibuk. Mulai ulang login.');try{const pinned=JSON.parse(teamProperties_().getProperty('TEAM_GOOGLE_SUBJECTS_JSON')||'{}');if(pinned[email]&&pinned[email]!==sub)throw new Error('Identitas akun berubah. Hubungi pemilik.');if(teamMembers_()[email]){pinned[email]=sub;teamProperties_().setProperty('TEAM_GOOGLE_SUBJECTS_JSON',JSON.stringify(pinned));}else teamJoinRequest_(email,sub);}finally{lock.releaseLock();}cache.put('team:result:'+state,JSON.stringify({email:email,sub:sub}),600);return teamCallbackPage_('Login berhasil. Kembali ke tab aplikasi; proses akan dilanjutkan otomatis.');
 }catch(e){const reason=e.message||'Login belum berhasil.';cache.put('team:result:'+state,JSON.stringify({error:reason}),600);return teamCallbackPage_(reason);}}
function teamCallbackPage_(message){return HtmlService.createHtmlOutput('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login Tim</title><div style="font:16px/1.7 system-ui;max-width:540px;margin:60px auto;padding:25px"><h2>Login tim</h2><p>'+String(message).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</p><p>Tab ini boleh ditutup.</p></div>');}
function teamFinishLogin(state,proof){const cache=CacheService.getScriptCache();if(!/^[a-f0-9]{64}$/i.test(String(state))||! /^[a-f0-9]{64}$/i.test(String(proof)))throw new Error('Permintaan login tidak valid.');const raw=cache.get('team:pending:'+state);if(!raw)throw new Error('Login kedaluwarsa. Silakan mulai ulang.');const pending=JSON.parse(raw);if(pending.proof!==teamHash_(proof))throw new Error('Login bukan berasal dari sesi ini.');const result=cache.get('team:result:'+state);if(!result)return {pending:true};const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {pending:true};try{if(!cache.get('team:result:'+state))throw new Error('Login telah digunakan.');cache.remove('team:pending:'+state);cache.remove('team:result:'+state);const user=JSON.parse(result);if(user.error)throw new Error(user.error);const role=teamMembers_()[user.email]||'pending';const session=teamRandom_();cache.put('team:session:'+teamHash_(session),JSON.stringify({email:user.email,sub:user.sub,expires:Date.now()+4*3600000}),14400);return {session:session,user:{email:user.email,role:role,status:role==='pending'?(teamJoinRows_().find(r=>String(r[0])===user.email)||[])[2]:'approved'},expires:Date.now()+4*3600000};}finally{lock.releaseLock();}}
function teamRequire_(session){if(!/^[a-f0-9]{64}$/i.test(String(session)))throw new Error('LOGIN_REQUIRED: Masuk dengan akun Google tim.');const raw=CacheService.getScriptCache().get('team:session:'+teamHash_(session));if(!raw)throw new Error('LOGIN_REQUIRED: Sesi habis. Masuk lagi.');const user=JSON.parse(raw),role=teamMembers_()[user.email];if(!role||user.expires<=Date.now())throw new Error('LOGIN_REQUIRED: Akses telah dicabut atau sesi habis.');const pinned=JSON.parse(teamProperties_().getProperty('TEAM_GOOGLE_SUBJECTS_JSON')||'{}');if(String(user.sub).indexOf('pw:')===0){const rec=teamPwGet_(user.email);if(!rec||'pw:'+rec.v!==user.sub)throw new Error('LOGIN_REQUIRED: Kata sandi sudah diganti. Masuk lagi.');}else if(pinned[user.email]!==user.sub)throw new Error('LOGIN_REQUIRED: Identitas sesi tidak berlaku.');return {email:user.email,sub:user.sub,role:role};}
function teamGetSession(session){const user=teamIdentity_(session),role=teamMembers_()[user.email];if(role){teamRequire_(session);return {email:user.email,role:role};}const request=teamJoinRows_().find(r=>String(r[0])===user.email&&String(r[1])===user.sub);return {email:user.email,role:'pending',status:request?String(request[2]):'unknown'};}
function teamLogout(session){if(/^[a-f0-9]{64}$/i.test(String(session)))CacheService.getScriptCache().remove('team:session:'+teamHash_(session));return {ok:true};}
function teamAuthorize_(){if(TEAM_REQUEST_CONTEXT_)return TEAM_REQUEST_CONTEXT_;const active=Session.getActiveUser().getEmail(),owner=Session.getEffectiveUser().getEmail();if(active&&active===owner&&teamMembers_()[active.toLowerCase()]==='owner')return {email:active.toLowerCase(),role:'owner'};throw new Error('LOGIN_REQUIRED: Jalankan melalui aplikasi setelah login.');}
function teamRpc(session,method,args){const user=teamRequire_(session);if(typeof method!=='string'||!Array.isArray(args)||args.length>3)throw new Error('Permintaan tidak valid.');const reads=['prodList','ordersList','ordersRefresh','getDashboardData','getRecentTransactions','getImportedAnalytics','getAdsPerformanceData','listProducts','getAdvertiserInsights','getShopFlexibleAnalytics','getSelectedDashboardData','getWorkDay','getWorkHistory','getWorkCampaigns','listWorkArchives','readWorkArchive','readWorkChat','finGetReport','plReport','plReportText','finListStores','finListCosts','finReportText','getMyAccess','listImportLog','getImportFields','plGetData','plListCosts','plListSku','stockGet'];
const staffWrites=['askAnalyticsAI','saveWorkTask','seedDailyWorkTasks','recordWorkActivity','recordWorkChat'];
const storeAdminWrites=['ordShipInfo','ordShip','ordLabel','stockSave','stockApply','plSaveCost','plSaveSku','plSkuBulk','addTransaction','importShopFlexibleRows','importGmvMaxWithHistory','saveWorkCampaign','finImportSales','finSaveCost','finDeleteCost'];
const financeWrites=['skuGudangList','skuGudangSave','skuMapList','skuMapSave','skuMapFetchNames','spGetConnections','spSyncNow','plRebuild','kasirkuDevices','stockSave','stockApply','plSaveCost','plSaveSku','plSkuBulk','ttsGetConnections','ttsSyncNow','addTransaction','saveProduct','saveWorkCampaign','finImportSales','finSaveCost','finDeleteCost','listMigrations','getKasirKuStore'];
const ownerWrites=['capacityAction','prodAction','notifySetWa','notifyConfig','notifySetToken','notifyFindChats','notifySetChat','notifyTest','notifyEnable','skuEditApply','skuEditPreview','finDeleteStore','clearImportedAnalytics','deleteProduct','finSaveStore','importShopFlexibleRows','importGmvMaxWithHistory','migrateLegacy','setKasirKuStore','ttsGetAuthUrl','ttsUpdateShop','kasirkuAddDevice','kasirkuRevokeDevice','archiveOldData','spGetAuthUrl','spUpdateShop'];
const byRole={viewer:[],member:staffWrites,admin:staffWrites.concat(storeAdminWrites),finance:staffWrites.concat(financeWrites),owner:staffWrites.concat(storeAdminWrites,financeWrites,ownerWrites)};
const allowed=user.role==='owner'?reads.concat(byRole.owner,PERM_CATALOG_.reduce((a,p)=>a.concat(p.methods),[])):permMethods_(user.email,user.role);
if(!allowed.includes(method))throw new Error('Peran '+user.role+' tidak diizinkan menjalankan tindakan ini.');TEAM_REQUEST_CONTEXT_=user;try{const routes=teamRoutes_();if(!routes[method])throw new Error('Fungsi tidak tersedia dalam paket.');const result=routes[method].apply(null,args);if(!reads.includes(method))teamAudit_(user,method,'SUCCESS');return result;}finally{TEAM_REQUEST_CONTEXT_=null;}}
const TEAM_AUDIT_HEADERS_=['Time WIB','Email','Role','Action','Status','Entity','Record ID','Before','After'];
function teamAuditSheet_(){const ss=getDatabase_();let s=ss.getSheetByName('TeamAudit')||ss.insertSheet('TeamAudit');if(!s.getLastRow())s.appendRow(TEAM_AUDIT_HEADERS_);else if(s.getLastColumn()<TEAM_AUDIT_HEADERS_.length)s.getRange(1,1,1,TEAM_AUDIT_HEADERS_.length).setValues([TEAM_AUDIT_HEADERS_]);return s;}
/** Nilai sebelum/sesudah dibatasi panjangnya; kolom rahasia tidak pernah dikirim ke fungsi ini. */
function teamAuditJson_(v){if(v===null||v===undefined)return '';const t=JSON.stringify(v,(k,x)=>x instanceof Date?Utilities.formatDate(x,'Asia/Jakarta',"yyyy-MM-dd'T'HH:mm:ss"):x);return t.length>45000?t.slice(0,45000)+'…':t;}
function teamAudit_(user,method,status,detail){try{const d=detail||{};teamAuditSheet_().appendRow([Utilities.formatDate(new Date(),'Asia/Jakarta',"yyyy-MM-dd'T'HH:mm:ss"),user.email,user.role,method,status,d.entity||'',d.id||'',teamAuditJson_(d.before),teamAuditJson_(d.after)]);
}catch(e){throw new Error('Tindakan selesai tetapi audit belum tersimpan. Jangan ulangi otomatis; periksa spreadsheet.');
}}
/** Catat perubahan data: siapa, kapan, apa, nilai sebelum dan sesudah. */
function auditChange_(action,entity,id,before,after){const user=(typeof TEAM_REQUEST_CONTEXT_!=='undefined'&&TEAM_REQUEST_CONTEXT_)||{email:'(editor/sistem)',role:'system'};teamAudit_(user,action,'CHANGED',{entity:entity,id:id,before:before,after:after});}

function teamRoutes_(){return {askAnalyticsAI:askAnalyticsAI_,getDashboardData:getDashboardData_,getRecentTransactions:getRecentTransactions_,getImportedAnalytics:getImportedAnalytics_,getAdsPerformanceData:getAdsPerformanceData_,listProducts:listProducts_,getAdvertiserInsights:getAdvertiserInsights_,getShopFlexibleAnalytics:getShopFlexibleAnalytics_,getSelectedDashboardData:getSelectedDashboardData_,getWorkDay:getWorkDay_,getWorkHistory:getWorkHistory_,getWorkCampaigns:getWorkCampaigns_,listWorkArchives:listWorkArchives_,readWorkArchive:readWorkArchive_,readWorkChat:readWorkChat_,saveWorkTask:saveWorkTask_,seedDailyWorkTasks:seedDailyWorkTasks_,recordWorkActivity:recordWorkActivity_,recordWorkChat:recordWorkChat_,addTransaction:addTransaction_,importShopFlexibleRows:importShopFlexibleRows_,importGmvMaxWithHistory:importGmvMaxWithHistory_,saveProduct:saveProduct_,saveWorkCampaign:saveWorkCampaign_,clearImportedAnalytics:clearImportedAnalytics_,deleteProduct:deleteProduct_,finGetReport:finGetReport_,plReport:plReport_,plReportText:plReportText_,finListStores:finListStores_,finListCosts:finListCosts_,finReportText:finReportText_,finSaveStore:finSaveStore_,finDeleteStore:finDeleteStore_,finSaveCost:finSaveCost_,finDeleteCost:finDeleteCost_,finImportSales:finImportSales_,getMyAccess:getMyAccess_,listImportLog:listImportLog_,getImportFields:getImportFields_,plGetData:plGetData_,spGetConnections:spGetConnections_,spGetAuthUrl:spAuthUrl_,spUpdateShop:spUpdateShop_,spSyncNow:spSyncNow_,plRebuild:plRebuildSummary_,archiveOldData:archiveOldData_,kasirkuDevices:kasirkuDevices_,kasirkuAddDevice:kasirkuAddDevice_,kasirkuRevokeDevice:kasirkuRevokeDevice_,stockGet:stockGet_,stockSave:stockSave_,stockApply:stockApplySales_,plListCosts:plListCosts_,plListSku:plListSku_,plSaveCost:plSaveCost_,plSaveSku:plSaveSkuCost_,plSkuBulk:plSkuBulk_,skuMapList:skuMapList_,notifyConfig:notifyConfig_,ordersList:ordersList_,ordersRefresh:ordersRefresh_,ordShipInfo:ordShipInfo_,ordShip:ordShip_,ordLabel:ordLabel_,prodList:prodList_,capacityAction:capacityAction_,prodAction:prodAction_,notifySetWa:notifySetWa_,notifySetToken:notifySetToken_,notifyFindChats:notifyFindChats_,notifySetChat:notifySetChat_,notifyTest:notifyTest_,notifyEnable:notifyEnable_,skuGudangList:skuGudangList_,skuGudangSave:skuGudangSave_,skuMapSave:skuMapSave_,skuMapFetchNames:skuMapFetchNames_,skuEditPreview:skuEditPreview_,skuEditApply:skuEditApply_,ttsGetConnections:ttsGetConnections_,ttsGetAuthUrl:ttsAuthUrl_,ttsUpdateShop:ttsUpdateShop_,ttsSyncNow:ttsSyncNow_,migrateLegacy:migrateLegacy_,listMigrations:listMigrations_,getKasirKuStore:getKasirKuStore_,setKasirKuStore:setKasirKuStore_};}

function teamIdentity_(session){if(!/^[a-f0-9]{64}$/i.test(String(session)))throw new Error('LOGIN_REQUIRED: Masuk dahulu.');const raw=CacheService.getScriptCache().get('team:session:'+teamHash_(session));if(!raw)throw new Error('LOGIN_REQUIRED: Sesi habis.');const user=JSON.parse(raw);if(user.expires<=Date.now())throw new Error('LOGIN_REQUIRED: Sesi habis.');return user;}
function teamJoinSheet_(){const ss=getDatabase_();let sheet=ss.getSheetByName('TeamJoinRequests');if(!sheet)sheet=ss.insertSheet('TeamJoinRequests');if(!sheet.getLastRow())sheet.appendRow(['Email','Google Subject','Status','Requested WIB','Reviewed WIB','Reviewed By']);return sheet;}
function teamJoinRows_(){const s=teamJoinSheet_();return s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,6).getValues():[];}
function teamJoinRequest_(email,sub){const s=teamJoinSheet_(),rows=teamJoinRows_(),old=rows.find(r=>String(r[0])===email);if(old){if(String(old[1])!==sub)throw new Error('Identitas pengaju berubah. Hubungi pemilik.');return;}if(rows.length>=50)throw new Error('Daftar pengajuan penuh. Hubungi pemilik.');s.appendRow([email,sub,'pending',Utilities.formatDate(new Date(),'Asia/Jakarta',"yyyy-MM-dd'T'HH:mm:ss"),'','']);}
function teamManage(session,action,payload){const actor=teamRequire_(session);if(actor.role!=='owner')throw new Error('Hanya pemilik yang boleh mengelola anggota.');if(action==='list')return {perm:permCatalogPublic_(),members:teamScopeList_(),roles:TEAM_ROLES_.filter(r=>r!=='owner').map(r=>({value:r,label:TEAM_ROLE_LABELS_[r]})),stores:finStoresFromRows_(finRows_('FinStores')).map(s=>({code:s.code,name:s.name,platform:s.platform,active:s.active})),requests:teamJoinRows_().map(r=>({email:String(r[0]),status:String(r[2]),requested:String(r[3])}))};if(!['approve','reject','remove','role','scope','add','setpw','perms'].includes(action))throw new Error('Tindakan tidak dikenali.');const p=payload||{},email=String(p.email||'').trim().toLowerCase(),role=String(p.role||'member');if(action==='scope')return withScriptLock_(()=>teamSetScope_(actor,email,p.stores),5000);if(action==='perms')return withScriptLock_(()=>permSet_(actor,email,p.perms,p.reset),5000);if(action==='add'||action==='setpw')return withScriptLock_(()=>teamAddOrPw_(actor,action,email,role,p.password),5000);
if(!TEAM_ROLES_.includes(role)||role==='owner')throw new Error('Peran tidak valid.');const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw new Error('Server sibuk, coba lagi.');try{const members=teamMembers_();if(email===actor.email||members[email]==='owner')throw new Error('Pemilik tidak bisa dihapus atau diubah di halaman ini.');const rows=teamJoinRows_(),index=rows.findIndex(r=>String(r[0])===email);if(action==='approve'){if(index<0)throw new Error('Pengajuan login Google belum ditemukan.');if(!members[email]&&Object.keys(members).length>=TEAM_MAX_)throw new Error('Tim sudah berisi '+TEAM_MAX_+' orang, termasuk pemilik.');const pinned=JSON.parse(teamProperties_().getProperty('TEAM_GOOGLE_SUBJECTS_JSON')||'{}');pinned[email]=String(rows[index][1]);teamProperties_().setProperty('TEAM_GOOGLE_SUBJECTS_JSON',JSON.stringify(pinned));members[email]=role;}else if(action==='role'){if(!members[email])throw new Error('Anggota belum aktif.');members[email]=role;}else{delete members[email];teamProperties_().deleteProperty(teamPwKey_(email));}teamProperties_().setProperty('TEAM_MEMBERS_JSON',JSON.stringify(members));if(index>=0){const row=rows[index].slice();row[2]=action==='approve'||action==='role'?'approved':'rejected';row[4]=Utilities.formatDate(new Date(),'Asia/Jakarta',"yyyy-MM-dd'T'HH:mm:ss");row[5]=actor.email;teamJoinSheet_().getRange(index+2,1,1,6).setValues([row]);}teamAudit_(actor,'team-'+action,'SUCCESS');return {ok:true};}finally{lock.releaseLock();}}


/** Info peran & toko untuk tampilan (menu disesuaikan; penegakan tetap di server). */
function getMyAccess_(){const sc=currentScope_();const u=TEAM_REQUEST_CONTEXT_||{};return {email:u.email||'',role:u.role||'',roleLabel:TEAM_ROLE_LABELS_[u.role]||u.role,allStores:sc.all,stores:sc.stores,perms:permOf_(u.email,u.role)};}


/* ======================= Login email + kata sandi =======================
 * Kata sandi tidak disimpan: hanya salt + turunan HMAC-SHA256 berulang (TEAM_PW_ITER kali) di Script Properties.
 * Sesi kata sandi memakai sub "pw:<versi>"; ganti kata sandi → versi berubah → sesi lama tidak berlaku.
 * Salah 5 kali → akun dikunci 15 menit. Pesan gagal tidak membedakan "email tidak ada" vs "sandi salah".
 */
const TEAM_MAX_ = 10;
const TEAM_PW_ITER = 2000;
function teamPwKey_(email) { return 'TEAM_PW_' + teamHash_(String(email).trim().toLowerCase()).slice(0, 40); }
function teamPwGet_(email) { try { return JSON.parse(teamProperties_().getProperty(teamPwKey_(email)) || 'null'); } catch (e) { return null; } }
function teamPwDerive_(password, salt, iter) {
  let h = salt;
  for (let i = 0; i < iter; i++) h = Utilities.computeHmacSha256Signature(salt + ':' + i + ':' + h, String(password)).map(function(b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
  return h;
}
function teamPwSame_(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function teamPwCheckStrength_(pw) {
  pw = String(pw || '');
  if (pw.length < 8) throw new Error('Kata sandi minimal 8 karakter.');
  if (pw.length > 128) throw new Error('Kata sandi terlalu panjang.');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new Error('Kata sandi harus berisi huruf dan angka.');
}
function teamPwSet_(email, pw) {
  teamPwCheckStrength_(pw);
  const salt = teamRandom_().slice(0, 32), v = Date.now().toString(36) + teamRandom_().slice(0, 6);
  teamProperties_().setProperty(teamPwKey_(email), JSON.stringify({ s: salt, h: teamPwDerive_(pw, salt, TEAM_PW_ITER), i: TEAM_PW_ITER, v: v, t: new Date().toISOString() }));
}
function teamAddOrPw_(actor, action, email, role, password) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email tidak valid.');
  const members = teamMembers_();
  if (action === 'add') {
    if (members[email]) throw new Error('Email ini sudah anggota tim.');
    if (!TEAM_ROLES_.includes(role) || role === 'owner') throw new Error('Peran tidak valid.');
    if (Object.keys(members).length >= TEAM_MAX_) throw new Error('Tim sudah berisi ' + TEAM_MAX_ + ' orang, termasuk pemilik.');
    teamPwSet_(email, password);
    members[email] = role;
    teamProperties_().setProperty('TEAM_MEMBERS_JSON', JSON.stringify(members));
    teamAudit_(actor, 'team-add-password', 'SUCCESS');
    return { ok: true, message: email + ' ditambahkan sebagai ' + (TEAM_ROLE_LABELS_[role] || role) + '. Berikan email & kata sandi ini kepadanya secara pribadi (jangan lewat grup).' };
  }
  if (!members[email]) throw new Error('Email ini bukan anggota tim.');
  if (members[email] === 'owner' && email !== actor.email) throw new Error('Kata sandi pemilik hanya bisa diatur oleh pemilik sendiri.');
  teamPwSet_(email, password);
  teamAudit_(actor, 'team-set-password', 'SUCCESS');
  return { ok: true, message: 'Kata sandi ' + email + ' diatur ulang. Sesi lama akun ini otomatis keluar.' };
}
/** Login dengan email + kata sandi. */
function teamPasswordLogin(email, password) {
  email = String(email || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache(), failKey = 'team:pwfail:' + teamHash_(email), allKey = 'team:pwfail:all';
  const fails = Number(cache.get(failKey) || 0), allFails = Number(cache.get(allKey) || 0);
  if (fails >= 5) throw new Error('Terlalu banyak percobaan untuk akun ini. Tunggu 15 menit lalu coba lagi.');
  if (allFails >= 60) throw new Error('Terlalu banyak percobaan login. Tunggu 15 menit lalu coba lagi.');
  const members = teamMembers_(), rec = teamPwGet_(email);
  const ok = !!(members[email] && rec && teamPwSame_(teamPwDerive_(password, rec.s, rec.i || TEAM_PW_ITER), rec.h));
  if (!ok) {
    cache.put(failKey, String(fails + 1), 900); cache.put(allKey, String(allFails + 1), 900);
    throw new Error('Email atau kata sandi salah.' + (fails + 1 >= 3 ? ' Sisa ' + Math.max(0, 4 - fails) + ' percobaan sebelum dikunci 15 menit.' : ''));
  }
  cache.remove(failKey);
  const session = teamRandom_(), expires = Date.now() + 8 * 3600000;
  cache.put('team:session:' + teamHash_(session), JSON.stringify({ email: email, sub: 'pw:' + rec.v, expires: expires }), 21600);
  return { session: session, user: { email: email, role: members[email], status: 'approved' }, expires: expires };
}
/** Ganti kata sandi sendiri (perlu kata sandi lama bila sudah punya). */
function teamChangePassword(session, oldPw, newPw) {
  const user = teamRequire_(session), rec = teamPwGet_(user.email);
  if (rec && String(user.sub).indexOf('pw:') === 0 && !teamPwSame_(teamPwDerive_(oldPw, rec.s, rec.i || TEAM_PW_ITER), rec.h)) throw new Error('Kata sandi lama salah.');
  teamPwSet_(user.email, newPw);
  const fresh = teamPwGet_(user.email);
  if (String(user.sub).indexOf('pw:') === 0) {   // perbarui sesi yang sedang dipakai supaya tidak ikut keluar
    CacheService.getScriptCache().put('team:session:' + teamHash_(session), JSON.stringify({ email: user.email, sub: 'pw:' + fresh.v, expires: Date.now() + 8 * 3600000 }), 21600);
  }
  return { ok: true, message: 'Kata sandi diganti. Mulai sekarang kamu bisa masuk dengan email + kata sandi ini.' };
}
