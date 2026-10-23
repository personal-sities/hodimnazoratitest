//  EMP UI HELPERS
// ============================================================
function setActionBtnContent(btn, iconName, labelText){
  if(!btn)return;
  const icon = typeof getLucideIcon === 'function' ? getLucideIcon(iconName, 'abtn-ico', 18) : '';
  btn.innerHTML = `${icon}<span>${labelText}</span>`;
}

function updateEmpBtns(){
  const bsE=document.getElementById('bs'),blE=document.getElementById('bl'),bpE=document.getElementById('bp'),beE=document.getElementById('be'),bcE=document.getElementById('bc');
  const dis=(b,d)=>{if(b)b.disabled=d;};
  if(bcE){
    bcE.classList.toggle('hidden',empState!=='paused');
    setActionBtnContent(bcE, 'play-circle', t('bc'));
  }
  if(bsE) setActionBtnContent(bsE, 'play', t('bs'));
  if(beE) setActionBtnContent(beE, 'power', t('be'));

  if(empState==='not_started'){
    dis(bsE,false);dis(blE,true);dis(bpE,true);dis(beE,true);
    if(blE){setActionBtnContent(blE, 'utensils', t('bl'));blE.onclick=empLunch;}
    if(bpE){setActionBtnContent(bpE, 'compass', t('prayer_btn'));bpE.onclick=empPrayer;}
  }
  else if(empState==='working'){
    dis(bsE,true);dis(blE,false);dis(bpE,false);dis(beE,false);
    if(blE){setActionBtnContent(blE, 'utensils', t('bl'));blE.onclick=empLunch;}
    if(bpE){setActionBtnContent(bpE, 'compass', t('prayer_btn'));bpE.onclick=empPrayer;}
  }
  else if(empState==='lunch'){
    dis(bsE,true);dis(blE,false);dis(bpE,true);dis(beE,true);
    if(blE){setActionBtnContent(blE, 'arrow-left', t('bb'));blE.onclick=empBackLunch;}
    if(bpE){setActionBtnContent(bpE, 'compass', t('prayer_btn'));bpE.onclick=empPrayer;}
  }
  else if(empState==='prayer'){
    dis(bsE,true);dis(blE,true);dis(bpE,false);dis(beE,true);
    if(bpE){setActionBtnContent(bpE, 'arrow-left', t('prayer_back'));bpE.onclick=empBackPrayer;}
  }
  else if(empState==='paused'){
    dis(bsE,true);dis(blE,true);dis(bpE,true);dis(beE,false);
    if(blE)setActionBtnContent(blE, 'utensils', t('bl'));
    if(bpE)setActionBtnContent(bpE, 'compass', t('prayer_btn'));
  }
  else if(empState==='ended'){
    dis(bsE,true);dis(blE,true);dis(bpE,true);dis(beE,true);
    if(bsE)bsE.title="Bugungi ish kuni yakunlangan (qayta boshlash mumkin emas)";
    if(blE)setActionBtnContent(blE, 'utensils', t('bl'));
    if(bpE)setActionBtnContent(bpE, 'compass', t('prayer_btn'));
  }
}
function updateEmpStatusTag(){
  const map={not_started:t('st0'),working:t('st1'),lunch:t('st2'),prayer:t('prayer_btn'),paused:t('paused'),ended:t('st4')};
  const el=document.getElementById('e_stag');if(el)el.textContent=t('st_pre')+' '+(map[empState]||'');
}
function setEmpMonth(){document.getElementById('e_month').value=curM();loadHist();}

async function loadHist(){
  if(!CU)return;
  const m=document.getElementById('e_month').value||curM();
  const[y,mo]=m.split('-').map(Number);const dim=new Date(y,mo,0).getDate();
  let recs = null;
  try {
    const sRes = await serverApi(`/api/attendance?employee_id=${CU.id}&month=${m}`);
    if (sRes.ok && Array.isArray(sRes.data)) recs = sRes.data;
  }catch(e){}
  if (!recs) {
    try {
      const res = await sb.from('attendance').select('*').eq('employee_id',CU.id).gte('work_date',`${m}-01`).lte('work_date',`${m}-${String(dim).padStart(2,'0')}`).order('work_date');
      recs = res.data;
    }catch(e){}
  }
  const tbody=document.getElementById('hbody');tbody.innerHTML='';
  let lc=0,totalAfkSec=0;
  if(!recs||recs.length===0){tbody.innerHTML=`<tr><td colspan="11" style="text-align:center;color:var(--text3);padding:20px">${t('no_data')}</td></tr>`;st('e_lc','0');st('e_afk_total','0 '+t('daqiqa'));return;}
  recs.forEach((r,i)=>{
    if(r.late_minutes>0)lc++;
    totalAfkSec+=r.afk_seconds||0;
    const wh=Math.floor((r.work_seconds||0)/3600),wm=Math.floor(((r.work_seconds||0)%3600)/60);
    const lh=Math.floor((r.lunch_seconds||0)/3600),lm2=Math.floor(((r.lunch_seconds||0)%3600)/60);
    const afkMin=Math.floor((r.afk_seconds||0)/60);
    const status=computeStatusByTimes(
      r.start_time?r.start_time.substring(0,5):null,
      r.end_time?r.end_time.substring(0,5):null,
      r.late_minutes||0,
      r.work_seconds||0
    );
    let bdg='';
    if(status==='keldi')bdg=`<span class="badge bg">${t('b_came')}</span>`;
    else if(status==='kechikkan')bdg=`<span class="badge by">${t('b_late')}</span>`;
    else if(status==='yarim_kun')bdg=`<span class="badge bauto">${t('b_half')}</span>`;
    else bdg=`<span class="badge br">${t('b_abs')}</span>`;
    if(r.auto_ended)bdg+=` <span class="badge bauto" style="font-size:10px;display:inline-flex;align-items:center;gap:3px;">${getLucideIcon('settings', '', 11)} ${t('auto_label')}</span>`;
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${i+1}</td><td style="font-family:var(--mono)">${r.work_date}</td><td style="font-family:var(--mono)">${r.start_time?r.start_time.substring(0,5):'-'}</td><td>${r.lunch_start?r.lunch_start.substring(0,5):'-'}</td><td>${r.lunch_end?r.lunch_end.substring(0,5):'-'}</td><td>${r.end_time?r.end_time.substring(0,5):'-'}</td><td>${r.late_minutes?r.late_minutes+' '+t('daq'):'-'}</td><td style="font-family:var(--mono)">${wh} ${t('soat')} ${wm} ${t('daqiqa')}</td><td>${lh} ${t('soat')} ${lm2} ${t('daqiqa')}</td><td style="color:${afkMin>0?'var(--danger)':'inherit'};font-family:var(--mono)">${afkMin>0?afkMin+' '+t('daq'):'—'}</td><td>${bdg}</td>`;
    tbody.appendChild(tr);
  });
  st('e_lc',''+lc);st('e_afk_total',Math.floor(totalAfkSec/60)+' '+t('daqiqa'));
}

// ============================================================
//  INIT (F5 DA SILLIQ VA TEZKOR QAYTA YUKLASH)
// ============================================================
(async function(){
  applyTheme(localStorage.getItem('aloqa_theme')||'light');

  // 1. Keshdagi sessiyani tekshirib, DARHOL o'z sahifasini ochish (kutishsiz va login oynasini ko'rsatmasdan)
  try{
    const cached = localStorage.getItem('aloqa_u');
    if(cached){
      CU = JSON.parse(cached);
      const isKnownAdmin = (val) => {
        const l = String(val || '').trim().toLowerCase();
        return l === 'admin' ||
               l === 'admin@aloqapro.uz' ||
               l === 'umirbekovdiyorbek@gmail.com' ||
               l.startsWith('admin@') ||
               l.includes('admin');
      };
      if (CU && isKnownAdmin(CU.login) && CU.role !== 'admin') {
        CU.role = 'admin';
        localStorage.setItem('aloqa_u', JSON.stringify(CU));
      }
      if(CU && (CU.role === 'admin' || CU.role === 'employee')){
        showPage(CU.role === 'admin' ? 'admin' : 'employee');
      }
    }
  }catch(e){
    console.warn('cached user parse error:', e);
  }

  // 2. IP va joylashuvni fon rejimida tezkor aniqlash
  getUserIP().then(ip => {
    userPublicIP = ip;
    const myIPEl=document.getElementById('ipb_val');
    if(myIPEl) myIPEl.textContent = ip || '—';
  }).catch(()=>{});

  // 3. Agar foydalanuvchi bo'lmasa, login oynasini ko'rsatish
  if (!CU) {
    showPage('login');
  }

  // 4. Fon rejimida sessiyani yangilash (foydalanuvchini chiqarib yubormagan holda)
  try{
    if (CU && CU.role === 'employee') {
      const isKnownAdmin = (val) => {
        const l = String(val || '').trim().toLowerCase();
        return l === 'admin' ||
               l === 'admin@aloqapro.uz' ||
               l === 'umirbekovdiyorbek@gmail.com' ||
               l.startsWith('admin@') ||
               l.includes('admin');
      };
      if (isKnownAdmin(CU.login)) {
        CU.role = 'admin';
        localStorage.setItem('aloqa_u', JSON.stringify(CU));
        showPage('admin');
        return;
      }
      const sEmps = await serverApi(`/api/employees?active_only=true`);
      if (sEmps.ok && Array.isArray(sEmps.data)) {
        const found = sEmps.data.find(e => e.id === CU.id || e.login === CU.login);
        if (found) {
          CU = { ...CU, ...found, role: 'employee' };
          localStorage.setItem('aloqa_u', JSON.stringify(CU));
          if(typeof renderEmployeeHeaderInfo==='function') renderEmployeeHeaderInfo();
        }
      }
    }
  }catch(e){
    console.warn('background session refresh:', e);
  }

  // 5. Auth holat o'zgarishi: Faqat foydalanuvchi O'ZI "Chiqish" tugmasini bosganda ishlaydi
  sb.auth.onAuthStateChange((event) => {
    if(event==='SIGNED_OUT' && window._manualLogoutInitiated){
      CU = null;
      localStorage.removeItem('aloqa_u');
      localStorage.removeItem('aloqa_emp_state');
      stopRealtimeSubscriptions();
      showPage('login');
    }
  });

  const loginForm = document.getElementById('loginForm');
  if(loginForm){
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      await doLogin();
    });
  }

  window.addEventListener('pagehide',()=>{syncWorkWhileAway({saveRemote:true});});
  window.addEventListener('beforeunload',()=>{syncWorkWhileAway({saveRemote:true});});
  window.addEventListener('blur',()=>{
    if(platformPauseTimer)clearTimeout(platformPauseTimer);
    platformPauseTimer=setTimeout(()=>{
      if(document.hidden||!document.hasFocus())syncWorkWhileAway({saveRemote:true});
    },1200);
  });
  window.addEventListener('focus',()=>{
    if(platformPauseTimer){clearTimeout(platformPauseTimer);platformPauseTimer=null;}
  });

  // ✅ FIX 3: Tab qaytganda — faceHitCount reset, video qayta yoqiladi
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      syncWorkWhileAway({saveRemote:true});
      return;
    }
    syncWorkWhileAway();
    if(!document.hidden && CU && CU.role==='employee'){ loadNotificationsEmp(true); }
    if(!document.hidden && CU && CU.role==='employee' && empState==='working' && faceControlEnabled){
      if(!faceStream){
        // Stream yo'q — to'liq qayta boshlash
        maybeStartFaceDetection();
      } else {
        // Stream bor — faqat video ni qayta yoqish va counterlarni reset
        const video=document.getElementById('faceVideo');
        if(video && video.paused){
          try{ video.play(); }catch(e){}
        }
        // ✅ MUHIM: Tab qaytganda ketma-ket detection yangilansin
        faceHitCount=0;
        faceMissCount=0;
        faceUnknownCount=0;
        isDetecting=false;
        isDetectingStartTime=0;
        scheduleFaceCheck(FACE_RETRY_INTERVAL);
      }
    }else if(!document.hidden && CU && CU.role==='employee' && empState==='working'){
      updateFaceControlEmployeeUI();
    }
  });

})();
