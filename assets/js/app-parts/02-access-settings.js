// ============================================================
//  IP CHECK & FAST SETTINGS
// ============================================================
let userPublicIP = sessionStorage.getItem('aloqa_ip') || '';
let userGeoPosition = null;

async function getUserIP(){
  if (userPublicIP) return userPublicIP;
  // 1. Avval o'z serverimizdan so'raymiz (1ms, tashqi internetga bog'liq emas)
  try {
    const sRes = await fetch('/api/my-ip');
    if (sRes.ok) {
      const data = await sRes.json();
      if (data && data.ip) {
        userPublicIP = data.ip;
        sessionStorage.setItem('aloqa_ip', data.ip);
        return userPublicIP;
      }
    }
  } catch (_) {}

  // 2. Tashqi xizmat orqali tekshirish
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
    clearTimeout(timeout);
    const d = await r.json();
    if (d && d.ip) {
      userPublicIP = d.ip;
      sessionStorage.setItem('aloqa_ip', d.ip);
    }
    return userPublicIP || '';
  } catch (e) {
    return userPublicIP || '';
  }
}

async function getAllowedIPs(){
  try{
    const sRes = await serverApi('/api/settings?key=allowed_ips');
    if(sRes.ok && sRes.data?.value){
      return JSON.parse(sRes.data.value || '[]');
    }
  }catch(e){}
  try{
    const{data,error}=await sb.from('settings').select('value').eq('key','allowed_ips').maybeSingle();
    if(error||!data)return [];
    return JSON.parse(data.value||'[]');
  }catch(e){return [];}
}

async function saveAllowedIPs(arr){
  try{
    const json=JSON.stringify(arr);
    await serverApi('/api/settings', { method:'POST', body: JSON.stringify({ key:'allowed_ips', value: json }) });
    try { await sb.from('settings').upsert({key:'allowed_ips',value:json},{onConflict:'key'}); }catch(e){}
    await updateIPList();
  }catch(e){console.error('saveAllowedIPs error:',e);}
}

async function checkIPAccess(role){
  if(role==='admin')return true;
  const allowed=await getAllowedIPs();
  if(!allowed || allowed.length===0)return true;
  if(!userPublicIP)userPublicIP=await getUserIP();
  if(!userPublicIP)return false;

  // Aniq moslik yoki maska (masalan, 84.54.* yoki 192.168.1.*)
  const isAllowed = allowed.some(pattern => {
    const p = String(pattern || '').trim();
    if (!p) return false;
    if (p === userPublicIP) return true;
    if (p.endsWith('*') && userPublicIP.startsWith(p.slice(0, -1))) return true;
    if (p === '127.0.0.1' && (userPublicIP === '127.0.0.1' || userPublicIP === '::1' || userPublicIP === 'localhost')) return true;
    return false;
  });
  return isAllowed;
}

async function getGPSRegionSettings(){
  try{
    const sRes = await serverApi('/api/settings?key=allowed_gps_region');
    if(sRes.ok && sRes.data?.value){
      const parsed = JSON.parse(sRes.data.value || '{}');
      return {
        enabled:Boolean(parsed.enabled),
        latitude:parsed.latitude===null||parsed.latitude===undefined?null:Number(parsed.latitude),
        longitude:parsed.longitude===null||parsed.longitude===undefined?null:Number(parsed.longitude),
        radius_m:parsed.radius_m===null||parsed.radius_m===undefined?200:Number(parsed.radius_m)
      };
    }
  }catch(e){}
  try{
    const{data,error}=await sb.from('settings').select('value').eq('key','allowed_gps_region').maybeSingle();
    if(error||!data)return {enabled:false,latitude:null,longitude:null,radius_m:200};
    const parsed=JSON.parse(data.value||'{}');
    return {
      enabled:Boolean(parsed.enabled),
      latitude:parsed.latitude===null||parsed.latitude===undefined?null:Number(parsed.latitude),
      longitude:parsed.longitude===null||parsed.longitude===undefined?null:Number(parsed.longitude),
      radius_m:parsed.radius_m===null||parsed.radius_m===undefined?200:Number(parsed.radius_m)
    };
  }catch(e){
    return {enabled:false,latitude:null,longitude:null,radius_m:200};
  }
}

async function saveGPSRegionSettings(cfg){
  try{
    const json = JSON.stringify(cfg);
    await serverApi('/api/settings', { method:'POST', body: JSON.stringify({ key:'allowed_gps_region', value: json }) });
    try { await sb.from('settings').upsert({key:'allowed_gps_region',value:json},{onConflict:'key'}); }catch(e){}
    await loadGPSSettingsUI();
  }catch(e){
    console.error('saveGPSRegionSettings error:',e);
    toast('error','GPS',t('gps_save_error'));
  }
}

const FACE_CONTROL_SETTING_KEY='face_control_enabled';
let faceControlEnabled = localStorage.getItem('aloqa_face_control_enabled') !== 'false';

function normalizeFaceControlValue(raw){
  if(raw===null||raw===undefined||raw==='')return true;
  if(typeof raw==='boolean')return raw;
  if(typeof raw==='object')return raw.enabled!==false;
  const text=String(raw).trim();
  try{
    const parsed=JSON.parse(text);
    if(typeof parsed==='boolean')return parsed;
    if(parsed&&typeof parsed==='object')return parsed.enabled!==false;
  }catch(e){}
  return !/^(false|0|off|disabled)$/i.test(text);
}

async function getFaceControlSettings(){
  try{
    const sRes = await serverApi(`/api/settings?key=${FACE_CONTROL_SETTING_KEY}`);
    if(sRes.ok && sRes.data?.value !== undefined){
      return normalizeFaceControlValue(sRes.data.value);
    }
  }catch(e){}
  const {data,error}=await sb.from('settings').select('value').eq('key',FACE_CONTROL_SETTING_KEY).maybeSingle();
  if(error)throw error;
  return normalizeFaceControlValue(data?.value);
}
function updateFaceControlSettingsUI(){
  const checkbox=document.getElementById('face_control_enabled');
  const state=document.getElementById('face_control_state');
  const switchLabel=document.getElementById('face_control_switch_label');
  if(checkbox)checkbox.checked=!!faceControlEnabled;
  if(state)state.textContent=faceControlEnabled?t('face_control_on'):t('face_control_off');
  if(switchLabel)switchLabel.textContent=t('face_control_switch');
  st('face_control_title', t('face_control_title'));
  st('face_control_label', t('face_control_label'));
  st('face_control_desc', t('face_control_desc'));
}
function updateFaceControlEmployeeUI(){
  const employeeVisible=document.getElementById('employeePage')&&getComputedStyle(document.getElementById('employeePage')).display!=='none';
  const widget=document.getElementById('faceWidget');
  if(widget&&CU?.role==='employee')widget.classList.toggle('hidden', !employeeVisible || !faceControlEnabled);
  if(faceControlEnabled)return;
  stopFaceDetection();
  const statusEl=document.getElementById('face_status_inline');
  if(statusEl)statusEl.textContent=t('face_control_disabled_employee');
  setFaceDot('gray', t('face_control_off'));
  const regBox=document.getElementById('faceRegBox');
  if(regBox)regBox.style.display='none';
  const liveText=document.getElementById('livenessText');
  if(liveText)liveText.textContent=t('face_control_off');
  const liveWidget=document.getElementById('livenessWidgetTxt');
  if(liveWidget)liveWidget.textContent=t('face_control_off');
}
async function loadFaceControlSettings(){
  try{
    faceControlEnabled=await getFaceControlSettings();
    localStorage.setItem('aloqa_face_control_enabled', String(faceControlEnabled));
  }catch(e){
    console.warn('loadFaceControlSettings:', e.message||e);
    faceControlEnabled=localStorage.getItem('aloqa_face_control_enabled') !== 'false';
  }
  updateFaceControlSettingsUI();
  updateFaceControlEmployeeUI();
  return faceControlEnabled;
}
async function saveFaceControlToggle(){
  const checkbox=document.getElementById('face_control_enabled');
  const enabled=!!checkbox?.checked;
  try{
    await serverApi('/api/settings', { method:'POST', body: JSON.stringify({ key:FACE_CONTROL_SETTING_KEY, value: JSON.stringify({enabled}) }) });
    try { await sb.from('settings').upsert({key:FACE_CONTROL_SETTING_KEY,value:JSON.stringify({enabled})},{onConflict:'key'}); }catch(e){}
    faceControlEnabled=enabled;
    localStorage.setItem('aloqa_face_control_enabled', String(enabled));
    updateFaceControlSettingsUI();
    updateFaceControlEmployeeUI();
    toast('success', t('face_control_title'), t('face_control_saved'));
  }catch(e){
    console.error('saveFaceControlToggle error:', e);
    if(checkbox)checkbox.checked=faceControlEnabled;
    toast('error', t('face_control_title'), e.message||t('gps_save_error'));
  }
}
function maybeStartFaceDetection(){
  if(faceControlEnabled)startFaceDetection();
  else updateFaceControlEmployeeUI();
}
function startFaceControlPolling(){
  stopFaceControlPolling();
  faceControlPollTimer=setInterval(async()=>{
    if(!CU||CU.role!=='employee')return;
    const wasEnabled=faceControlEnabled;
    const enabled=await loadFaceControlSettings();
    if(enabled&&!wasEnabled&&empState==='working')maybeStartFaceDetection();
  },30000);
}
function stopFaceControlPolling(){
  if(faceControlPollTimer){
    clearInterval(faceControlPollTimer);
    faceControlPollTimer=null;
  }
}
function formatCoords(lat,lng){
  if(lat===null||lng===null||lat===undefined||lng===undefined)return 'aniqlanmagan';
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}
function haversineMeters(lat1,lng1,lat2,lng2){
  const R=6371000;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
async function getCurrentPosition(){
  if(userGeoPosition)return userGeoPosition;
  if(!navigator.geolocation)throw new Error('GPS qo\'llab-quvvatlanmaydi');
  const pos=await new Promise((resolve,reject)=>{
    navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
  });
  userGeoPosition={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy||null};
  const el=document.getElementById('gps_now_show');
  if(el)el.textContent=`${formatCoords(userGeoPosition.lat,userGeoPosition.lng)}${userGeoPosition.accuracy?` (±${Math.round(userGeoPosition.accuracy)}m)`:''}`;
  return userGeoPosition;
}
async function checkGPSAccess(role){
  if(role==='admin')return {ok:true};
  const cfg=await getGPSRegionSettings();
  if(!cfg.enabled||cfg.latitude===null||cfg.longitude===null||!cfg.radius_m)return {ok:true};
  try{
    const pos=await getCurrentPosition();
    const dist=haversineMeters(pos.lat,pos.lng,cfg.latitude,cfg.longitude);
    return {
      ok:dist<=cfg.radius_m,
      distance_m:Math.round(dist),
      radius_m:cfg.radius_m,
      coords:pos
    };
  }catch(e){
    return {ok:false,error:e.message||'GPS aniqlanmadi'};
  }
}
async function checkRegionAccess(role){
  const ipOk=await checkIPAccess(role);
  if(!ipOk){
    return {ok:false,mode:'ip',title:t('access_denied_title'),message:t('access_denied_msg'),value:userPublicIP||'—'};
  }
  const gps=await checkGPSAccess(role);
  if(!gps.ok){
    const detail=gps.distance_m?`${t('access_distance')}: ${gps.distance_m}m / ${t('access_radius')}: ${gps.radius_m}m`:(gps.error||t('gps_unknown'));
    return {ok:false,mode:'gps',title:t('access_gps_title'),message:`${t('access_gps_msg')} ${detail}`,value:userGeoPosition?formatCoords(userGeoPosition.lat,userGeoPosition.lng):t('gps_unknown')};
  }
  return {ok:true};
}
async function addAllowedIP(){
  const val=document.getElementById('ip_inp').value.trim();
  if(!val){toast('warn','IP',t('ip_enter'));return;}
  const arr=await getAllowedIPs();
  if(!arr.includes(val))arr.push(val);
  await saveAllowedIPs(arr);
  document.getElementById('ip_inp').value='';
  toast('success','IP',t('ip_added'));
}
async function addMyIP(){
  if(!userPublicIP)userPublicIP=await getUserIP();
  if(!userPublicIP){toast('error',t('error_title'),t('ip_detect_failed'));return;}
  const arr=await getAllowedIPs();
  if(!arr.includes(userPublicIP))arr.push(userPublicIP);
  await saveAllowedIPs(arr);
  toast('success','IP',t('ip_self_added'));
}
async function removeIP(ip){
  const arr=await getAllowedIPs();
  await saveAllowedIPs(arr.filter(x=>x!==ip));
}
async function updateIPList(){
  const el=document.getElementById('ip_list');if(!el)return;
  el.innerHTML=`<span style="color:var(--text3);font-size:12px">${t('ip_loading')}</span>`;
  const arr=await getAllowedIPs();
  if(arr.length===0){el.innerHTML=`<span style="color:var(--text3);font-size:12px">${t('ip_empty')}</span>`;return;}
  el.innerHTML=arr.map(ip=>`<span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg3);border-radius:6px;padding:3px 9px;font-size:12px;margin:2px;font-family:var(--mono)"><strong>${ip}</strong><button onclick="removeIP('${ip}')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;line-height:1">×</button></span>`).join(' ');
}
async function loadGPSSettingsUI(){
  const cfg=await getGPSRegionSettings();
  const lat=document.getElementById('gps_lat');
  const lng=document.getElementById('gps_lng');
  const radius=document.getElementById('gps_radius');
  const enabled=document.getElementById('gps_enabled');
  const info=document.getElementById('gps_saved_info');
  if(lat)lat.value=cfg.latitude??'';
  if(lng)lng.value=cfg.longitude??'';
  if(radius)radius.value=cfg.radius_m||200;
  if(enabled)enabled.checked=cfg.enabled;
  if(info){
    info.textContent=cfg.enabled&&cfg.latitude!==null&&cfg.longitude!==null
      ? `${t('gps_saved_region')}: ${formatCoords(cfg.latitude,cfg.longitude)} | ${t('access_radius')} ${cfg.radius_m}m`
      : t('gps_disabled');
  }
  refreshStaticLabels();
}
async function fillCurrentGPS(){
  try{
    userGeoPosition=null;
    const pos=await getCurrentPosition();
    const lat=document.getElementById('gps_lat');
    const lng=document.getElementById('gps_lng');
    if(lat)lat.value=pos.lat.toFixed(6);
    if(lng)lng.value=pos.lng.toFixed(6);
    toast('success','GPS',t('gps_current_success'));
  }catch(e){
    toast('error','GPS',e.message||t('gps_current_error'));
  }
}
async function saveGPSRegion(){
  const latitude=Number(document.getElementById('gps_lat').value);
  const longitude=Number(document.getElementById('gps_lng').value);
  const radius_m=Number(document.getElementById('gps_radius').value||200);
  const enabled=document.getElementById('gps_enabled').checked;
  if(enabled&&(Number.isNaN(latitude)||Number.isNaN(longitude)||Number.isNaN(radius_m))){
    toast('warn','GPS',t('gps_fill_error'));
    return;
  }
  await saveGPSRegionSettings({
    enabled,
    latitude:enabled?latitude:null,
    longitude:enabled?longitude:null,
    radius_m:enabled?radius_m:200
  });
  toast('success','GPS',t('gps_saved_success'));
}
function showIPBlock(value,title,msg){
  ['loginPage','adminPage','employeePage'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';});
  document.getElementById('ipBlockPage').style.display='flex';
  if(title)st('ipb_t',title);
  if(msg)st('ipb_p',msg);
  animateCurrentView();
  st('ipb_val',value||'—');
}

// ============================================================
