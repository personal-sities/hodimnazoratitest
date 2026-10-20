//  ADMIN
// ============================================================
let mVisible = false;
let monthlyData = [];
let monthlyAttendanceSummary = [];
let currentAdminTab = 'main';

function initAdmin(){adminTab('main');setToday();setCurMonth();updateDates();updateHolList();updateIPList();loadGPSSettingsUI();loadFaceControlSettings();loadMyIPDisplay();loadNotifEmpSelect();checkFeedbackBadge();subscribeAdminRealtime();loadTodayWorkLeaveCard();}
async function loadMyIPDisplay(){if(!userPublicIP)userPublicIP=await getUserIP();const el=document.getElementById('my_ip_show');if(el)el.textContent=userPublicIP||'—';refreshStaticLabels();}
async function loadNotifEmpSelect(){
  const{data:emps}=await sb.from('employees').select('id,name');
  const sel=document.getElementById('ns_emp');if(!sel)return;
  sel.innerHTML=`<option value="all">${t('notif_send_all')}</option>`;
  (emps||[]).forEach(e=>{const o=document.createElement('option');o.value=e.id;o.textContent=e.name;sel.appendChild(o);});
}
async function checkFeedbackBadge(){
  const{data}=await sb.from('feedback').select('id').eq('status','new');
  const badge=document.getElementById('fbBadge');
  if(badge){const c=(data||[]).length;badge.textContent=c;badge.classList.toggle('hidden',c===0);}
}
function adminTab(tab){
  currentAdminTab = tab;
  ['main','notif','feedback','settings','pbx'].forEach(n=>{const el=document.getElementById('tab_'+n);if(el)el.classList.toggle('hidden',n!==tab);});
  ['nav_main','nav_feedback','nav_notif','nav_settings','nav_pbx'].forEach((id)=>{const el=document.getElementById(id);if(el)el.classList.toggle('active',id==='nav_'+tab);});
  st('admTitle',getAdminTabTitle(tab));
  if(tab==='settings'){loadEmpList();updateIPList();loadGPSSettingsUI();loadFaceControlSettings();}
  if(tab==='feedback')loadFeedbackAdmin();
  if(tab==='notif'){loadNotificationsAdmin();loadNotifEmpSelect();}
  if(tab==='pbx'){if(typeof loadPbxDashboard==='function')loadPbxDashboard();}
  if(typeof hydrateLucideIcons === 'function') hydrateLucideIcons(document.getElementById('tab_' + tab));
  animateCurrentView();
}
function setToday(){const today=todayISO();document.getElementById('fd_from').value=today;document.getElementById('fd_to').value=today;loadAtt();}
function setCurMonth(){document.getElementById('fmonth').value=curM();onAdminMonthChange();}
function onAdminMonthChange(){loadDashboard();loadMonthly();}
function refreshAdminMain(){loadAtt();loadDashboard();loadMonthly();loadTodayWorkLeaveCard();}
function setAttendanceTableMode(monthly){
  const dateRange=document.getElementById('att_date_range');
  const todayBtn=document.getElementById('b_today');
  const statusFilter=document.getElementById('fstatus');
  if(dateRange)dateRange.style.display=monthly?'none':'flex';
  if(todayBtn)todayBtn.style.display=monthly?'none':'';
  if(statusFilter)statusFilter.style.display=monthly?'none':'';

  if(monthly){
    st('att_t', t('monthly_att_summary_title'));
    st('th1', t('mas_emp'));
    st('th2', t('th2'));
    st('th4', t('mas_month'));
    st('th5', t('mas_worked_days'));
    st('th6', t('mas_late_count'));
    st('th7', t('mas_absent_days'));
    st('th_afk', t('mas_late_time'));
    st('th8', t('mas_actions'));
  }else{
    st('att_t', t('att_t'));
    st('th1', t('th1'));
    st('th2', t('th2'));
    st('th4', t('th4'));
    st('th5', t('th5'));
    st('th6', t('th6'));
    st('th7', t('th7'));
    st('th_afk', t('th_afk'));
    st('th8', t('th8'));
  }
}
function toggleMonthly(){
  mVisible=!mVisible;
  document.getElementById('mbox').classList.toggle('hidden',!mVisible);
  if(mVisible)loadMonthly();
  else loadAtt();
}
async function loadTodayWorkLeaveCard(){
  const today=todayISO();
  const [leaves, emps] = await Promise.all([
    fetchEmployeeLeavesInRange(today,today),
    sb.from('employees').select('id,name').eq('active',true)
  ]);
  const empMap=new Map(((emps.data)||[]).map(emp=>[emp.id, emp.name||'-']));
  latestTodayLeaveRows=(leaves||[]).map((leave,index)=>({
    ...leave,
    employee_name: empMap.get(leave.employee_id) || '-',
    status: t('on_work_leave')
  }));
  st('sleave', String(latestTodayLeaveRows.length));
}
async function openWorkLeaveModal(){
  const today=todayISO();
  st('work_leave_title', t('employees_on_work_leave'));
  st('work_leave_subtitle', fmtD(new Date(`${today}T12:00:00`)));
  const tbody=document.getElementById('work_leave_body');
  if(!tbody)return;
  let rows=[];
  if(employeeLeavesTableAvailable){
    const [leaveRes, empRes] = await Promise.all([
      sb.from('employee_leaves').select('id,employee_id,leave_start_date,return_date,created_at').lte('leave_start_date', today).order('leave_start_date', {ascending:false}),
      sb.from('employees').select('id,name')
    ]);
    if(!leaveRes.error){
      const empMap=new Map(((empRes.data)||[]).map(emp=>[emp.id, emp.name||'-']));
      rows=(leaveRes.data||[]).filter(row=>normalizeIsoDate(row.leave_start_date)&&normalizeIsoDate(row.return_date)).map(row=>({
        ...row,
        employee_name: empMap.get(row.employee_id) || '-',
        status: today<=row.return_date ? t('on_work_leave') : t('returned')
      }));
    }else if(/employee_leaves|relation/i.test(leaveRes.error.message||'')){
      employeeLeavesTableAvailable=false;
    }
  }
  if(!rows.length && latestTodayLeaveRows.length)rows=latestTodayLeaveRows;
  tbody.innerHTML='';
  if(!rows.length){
    tbody.innerHTML=`<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:18px">${t('no_employees_on_work_leave')}</td></tr>`;
    document.getElementById('m_work_leave').classList.remove('hidden');
    return;
  }
  rows.forEach((row,i)=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${i+1}</td><td>${row.employee_name||'-'}</td><td style="font-family:var(--mono)">${row.leave_start_date}</td><td style="font-family:var(--mono)">${row.return_date}</td><td><span class="badge bauto">${row.status}</span></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('m_work_leave').classList.remove('hidden');
}
function closeWorkLeaveModal(){document.getElementById('m_work_leave').classList.add('hidden');}

function fmtDashHours(sec){
  sec=Math.max(0,sec||0);
  return Math.floor(sec/3600)+'h '+Math.floor((sec%3600)/60)+'m';
}
function renderDashList(id,items,valueFn){
  const el=document.getElementById(id);if(!el)return;
  if(!items||items.length===0){el.innerHTML=`<div class="dash-empty">${t('no_data')}</div>`;return;}
  el.innerHTML=items.slice(0,5).map((item,i)=>`
    <div class="dash-row">
      <div class="dash-name">${i+1}. ${item.name}</div>
      <div class="dash-val">${valueFn(item)}</div>
    </div>
  `).join('');
}
function renderDashboardCharts(rows,workDays,empCount,recs=[]){
  const overall=document.getElementById('dashOverall');
  const stats=document.getElementById('dash_work_stats');
  const chart=document.getElementById('dash_work_chart');
  const labels=document.getElementById('dash_work_labels');
  const bars=document.getElementById('dash_late');
  const foot=document.getElementById('dash_kpi');
  const totalSlots=Math.max(0,workDays*empCount);
  const present=rows.reduce((s,x)=>s+(x.came||0),0);
  const overallPct=totalSlots?Math.round((present/totalSlots)*100):0;
  if(overall)overall.textContent=overallPct+'%';

  const today=new Date(todayISO()+'T12:00:00');
  const last7=[];
  for(let i=6;i>=0;i--){
    const d=new Date(today);
    d.setDate(d.getDate()-i);
    const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const dayRecs=(recs||[]).filter(r=>r.work_date===ds);
    const presentCount=dayRecs.filter(r=>!!r.start_time).length;
    const lateCount=dayRecs.filter(r=>(r.late_minutes||0)>0).length;
    const absentCount=Math.max(0, empCount-presentCount);
    const pct=empCount?Math.round((presentCount/empCount)*100):0;
    last7.push({
      key:ds,
      label:`${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`,
      short:['Yak','Dush','Sesh','Chor','Pay','Jum','Shan'][d.getDay()],
      pct,
      present:presentCount,
      late:lateCount,
      absent:absentCount
    });
  }

  const avg7=last7.length?Math.round(last7.reduce((s,x)=>s+x.pct,0)/last7.length):0;
  const bestDay=last7.reduce((best,item)=>item.pct>best.pct?item:best,last7[0]||{pct:0,label:'-'});
  if(stats){
    stats.innerHTML = [
      { value:`${avg7}%`, label:t('dash_avg7') },
      { value:`${bestDay?.pct||0}%`, label:`${t('dash_best_day')}: ${bestDay?.label||'-'}` }
    ].map(item=>`<div class="dash-mini-stat"><strong>${item.value}</strong><span>${item.label}</span></div>`).join('');
  }
  if(labels){
    labels.innerHTML = last7.map(item=>`<span title="${item.label}">${item.short}</span>`).join('');
  }
  if(chart){
    if(!last7.length){
      chart.innerHTML='';
    }else{
      const width=640, height=190, padX=24, padTop=18, padBottom=34;
      const usableW=width-padX*2;
      const usableH=height-padTop-padBottom;
      const step=last7.length>1?usableW/(last7.length-1):usableW;
      const points=last7.map((item,idx)=>{
        const x=padX + step*idx;
        const y=padTop + (usableH - (item.pct/100)*usableH);
        return {x,y,...item};
      });
      const line=points.map(p=>`${p.x},${p.y}`).join(' ');
      const area=`${padX},${height-padBottom} ${line} ${padX+usableW},${height-padBottom}`;
      const dots=points.map((p,idx)=>`<circle class="dash-line-dot${idx===points.length-1?' active':''}" cx="${p.x}" cy="${p.y}" r="${idx===points.length-1?5:4}"><title>${p.label}: ${p.pct}%</title></circle>`).join('');
      chart.innerHTML = `
        <defs>
          <linearGradient id="dashLineGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(132,72,255,.26)"></stop>
            <stop offset="100%" stop-color="rgba(132,72,255,0)"></stop>
          </linearGradient>
        </defs>
        <polyline class="dash-line-area" points="${area}"></polyline>
        <polyline class="dash-line-path" points="${line}"></polyline>
        ${dots}
      `;
    }
  }

  const sortedRows=rows.slice().sort((a,b)=>b.efficiency-a.efficiency);
  if(bars){
    if(sortedRows.length===0){
      bars.innerHTML=`<div class="dash-empty">${t('no_data')}</div>`;
    }else{
      bars.innerHTML=sortedRows.map(x=>`
        <div class="dash-eff-card" title="${x.name}: ${x.efficiency}%">
          <div class="dash-eff-head">
            <div class="dash-eff-name">${x.name}</div>
            <div class="dash-eff-score-wrap">
              <span class="dash-eff-score-label">${t('eff_title')}</span>
              <span class="dash-eff-score">${x.efficiency}%</span>
            </div>
          </div>
          <div class="dash-eff-breakdown">
            <div class="dash-eff-row">
              <div class="dash-eff-label"><span class="dash-eff-dot green"></span><span>${t('eff_work_hours')}</span></div>
              <div class="dash-eff-value">${x.workPct}%</div>
            </div>
            <div class="dash-eff-row">
              <div class="dash-eff-label"><span class="dash-eff-dot yellow"></span><span>${t('eff_kpi')}</span></div>
              <div class="dash-eff-value">${x.kpiPct}%</div>
            </div>
            <div class="dash-eff-row">
              <div class="dash-eff-label"><span class="dash-eff-dot red"></span><span>${t('eff_late')}</span></div>
              <div class="dash-eff-value">-${x.latePenalty}%</div>
            </div>
            <div class="dash-eff-row">
              <div class="dash-eff-label"><span class="dash-eff-dot red"></span><span>${t('eff_afk')}</span></div>
              <div class="dash-eff-value">-${x.afkPenalty}%</div>
            </div>
          </div>
        </div>
      `).join('');
    }
  }
  if(foot){
    const best=sortedRows[0];
    foot.textContent=best?`${t('dash_efficiency_best')}: ${best.name} (${best.efficiency}%)`:'';
    foot.title=t('dash_efficiency_hint');
  }
  if(currentAdminTab==='main')animateVisibleCards(document.getElementById('tab_main'));
}

async function canFinishWorkByAmoCrmTasks(){return true;}

async function loadDashboard(){
  const chart=document.getElementById('dash_work_chart');
  if(!chart)return;
  const month=document.getElementById('fmonth')?.value||curM();
  st('dash_month',month);
  const stats=document.getElementById('dash_work_stats');
  const labels=document.getElementById('dash_work_labels');
  if(chart)chart.innerHTML='';
  if(stats)stats.innerHTML=`<div class="dash-mini-stat"><strong>...</strong><span>${t('loading')}</span></div>`;
  if(labels)labels.innerHTML='';
  const[y,mo]=month.split('-').map(Number);const dim=new Date(y,mo,0).getDate();
  let wd=0;for(let d=1;d<=dim;d++){const ds=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;if(isWorkDay(ds))wd++;}
  const monthStart=`${month}-01`;
  const monthEnd=`${month}-${String(dim).padStart(2,'0')}`;

  let emps = null, recs = null;
  try {
    const [sEmps, sAtt] = await Promise.all([
      serverApi('/api/employees'),
      serverApi(`/api/attendance?from=${monthStart}&to=${monthEnd}`)
    ]);
    if (sEmps.ok && Array.isArray(sEmps.data)) emps = sEmps.data;
    if (sAtt.ok && Array.isArray(sAtt.data)) recs = sAtt.data;
  } catch(e){}

  if (!emps || !recs) {
    try {
      const [{data:eData},{data:rData}] = await Promise.all([
        sb.from('employees').select('*'),
        sb.from('attendance').select('*').gte('work_date',monthStart).lte('work_date',monthEnd)
      ]);
      if (!emps) emps = eData;
      if (!recs) recs = rData;
    } catch(e){}
  }

  if (!emps) emps = [];
  if (!recs) recs = [];
  const leaves = await fetchEmployeeLeavesInRange(monthStart, monthEnd).catch(()=>[]);
  const leaveDateMap=buildEmployeeLeaveDateMap(leaves, monthStart, monthEnd);
  const rows=(emps||[]).map(emp=>{
    const er=(recs||[]).filter(r=>r.employee_id===emp.id);
    let sec=0,afkSec=0,late=0,lateMin=0,came=0,half=0;
    const cameDates=new Set();
    er.forEach(r=>{
      if(r.start_time){
        came++;
        if(r.work_date)cameDates.add(r.work_date);
        const[h,m]=r.start_time.split(':').map(Number);if(h*60+m>LATE_AFTER_MINUTES)late++;
      }
      if(computeStatusByTimes(
        r.start_time?r.start_time.substring(0,5):null,
        r.end_time?r.end_time.substring(0,5):null,
        r.late_minutes||0,
        r.work_seconds||0
      )==='yarim_kun')half++;
      sec+=r.work_seconds||0;
      afkSec+=r.afk_seconds||0;
      lateMin+=r.late_minutes||0;
    });
    const leaveDates=leaveDateMap.get(emp.id)||new Set();
    const abs=countAbsencesForMonth(month,cameDates,leaveDates);
    const expectedSec=Math.max(1,wd*TARGET_WORK_SEC_PER_DAY);
    const workPct=Math.min(100,Math.round((sec/expectedSec)*100));
    const latePenalty=Math.min(20,(late*5)+Math.floor((lateMin||0)/60));
    const afkPenalty=Math.min(15,Math.round(Math.max(0,afkSec)/(5*60)));
    const efficiency=Math.max(0,Math.min(100,Math.round(workPct-latePenalty-afkPenalty)));
    return {name:emp.name||'-',sec,late,lateMin,came,abs,efficiency,workPct,latePenalty,afkPenalty};
  });
  renderDashboardCharts(rows,wd,(emps||[]).length,recs||[]);
}

async function loadAtt() {
  if (mVisible) {
    setAttendanceTableMode(true);
    await loadMonthly();
    return;
  }
  setAttendanceTableMode(false);
  const dateFrom = document.getElementById('fd_from').value || todayISO();
  const dateTo = document.getElementById('fd_to').value || todayISO();
  const search = (document.getElementById('fsearch').value || '').toLowerCase();
  const statusFilter = document.getElementById('fstatus').value || '';

  let data = null;

  // 1-USUL: Server API orqali tezkor yuklash (10ms)
  try {
    const sRes = await serverApi(`/api/attendance?from=${dateFrom}&to=${dateTo}`);
    if (sRes.ok && Array.isArray(sRes.data)) {
      data = sRes.data;
    }
  } catch(e){}

  // 2-USUL: Supabase RPC fallback
  let leaves = [];
  if (!data) {
    try {
      const [{ data: rpcData, error }, lvs] = await Promise.all([
        sb.rpc('admin_attendance_range', {
          p_from: dateFrom,
          p_to: dateTo,
          p_search: '',
          p_status: ''
        }),
        fetchEmployeeLeavesInRange(dateFrom, dateTo)
      ]);
      if (!error && rpcData) data = rpcData;
      if (lvs) leaves = lvs;
    } catch (e) {
      console.warn('loadAtt fallback:', e);
    }
  }

  if (!data) data = [];

  const tbody = document.getElementById('att_body');
  tbody.innerHTML = '';

  let w = 0, l = 0, a = 0;
  const leaveDateMap=buildEmployeeLeaveDateMap(leaves, dateFrom, dateTo);

  if (dateFrom === dateTo) {
    (data || []).forEach((row, i) => {
      let status = row.status || 'kelmadi';
      if(isEmployeeOnLeaveDate(row.employee_id, dateFrom, leaveDateMap))status='work_leave';
      let arr = row.start_time ? row.start_time.substring(0, 5) : '-';
      let lm = row.late_minutes || 0;
      let hrs = (row.worked_seconds || row.work_seconds) ? secToHMS(row.worked_seconds || row.work_seconds) : '-';
      let afkSec = row.afk_seconds || 0;

      if (status === 'keldi' || status === 'auto_ended' || status === 'yarim_kun') w++;
      else if (status === 'kechikkan') l++;
      else if (status === 'kelmadi') a++;

      let bc2 = 'bgr', bt = t('b_off');
      if (status === 'keldi') {
        bc2 = 'bg';
        bt = t('b_came');
      } else if (status === 'kechikkan') {
        bc2 = 'by';
        bt = t('b_late');
      } else if (status === 'kelmadi') {
        bc2 = 'br';
        bt = t('b_abs');
      } else if (status === 'yarim_kun') {
        bc2 = 'bauto';
        bt = t('b_half');
      } else if (status === 'auto_ended') {
        bc2 = 'bg';
        bt = `<span style="display:inline-flex;align-items:center;gap:3px;">${getLucideIcon('settings', '', 12)} ${t('auto_label')}</span>`;
      } else if (status === 'work_leave') {
        bc2 = 'bauto';
        bt = t('on_work_leave');
      }

      const afkFmt = formatPenaltyAfk(afkSec);

      const tr = document.createElement('tr');
      tr.dataset.name = (row.employee_name || '').toLowerCase();
      tr.dataset.login = (row.employee_login || '').toLowerCase();
      tr.dataset.st = status;

      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${row.employee_name || '-'}</td>
        <td style="font-family:var(--mono)">${row.employee_login || '-'}</td>
        <td><button class="bsm bsm-g" onclick="openEP('${row.employee_id}')">${t('change')}</button></td>
        <td style="font-family:var(--mono)">${arr}</td>
        <td>${lm > 0 ? lm + ' ' + t('daq') : '-'}</td>
        <td style="font-family:var(--mono)">${hrs}</td>
        <td style="color:${afkSec > 0 ? 'var(--danger)' : 'var(--text2)'};">${afkFmt}</td>
        <td><span class="badge ${bc2}">${bt}</span></td>
      `;

      tbody.appendChild(tr);
    });
  } else {
    const grouped = {};

    (data || []).forEach((row) => {
      const id = row.employee_id;
      if (!grouped[id]) {
        grouped[id] = {
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          employee_login: row.employee_login,
          totalSec: 0,
          totalAfk: 0,
          totalLate: 0,
          dayCount: 0
        };
      }

      grouped[id].totalSec += (row.worked_seconds || row.work_seconds || 0);
      grouped[id].totalAfk += row.afk_seconds || 0;
      grouped[id].totalLate += row.late_minutes || 0;

      if (row.work_date) grouped[id].dayCount++;
    });

    Object.values(grouped).forEach((emp, i) => {
      const hrs2 = emp.totalSec > 0
        ? Math.floor(emp.totalSec / 3600) + 'h ' + Math.floor((emp.totalSec % 3600) / 60) + 'm'
        : '—';

      const afkFmt2 = formatPenaltyAfk(emp.totalAfk);

      const tr = document.createElement('tr');
      tr.dataset.name = (emp.employee_name || '').toLowerCase();
      tr.dataset.login = (emp.employee_login || '').toLowerCase();
      tr.dataset.st = 'keldi';

      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${emp.employee_name || '-'}</td>
        <td>${emp.employee_login || '-'}</td>
        <td><button class="bsm bsm-g" onclick="openEP('${emp.employee_id}')">${t('change')}</button></td>
        <td>${emp.dayCount} ${t('kun')}</td>
        <td>${emp.totalLate > 0 ? emp.totalLate + ' ' + t('daq') : '-'}</td>
        <td>${hrs2}</td>
        <td style="color:${emp.totalAfk > 0 ? 'var(--danger)' : 'var(--text2)'}">${afkFmt2}</td>
        <td><span class="badge bg">${emp.dayCount} ${t('kun')}</span></td>
      `;

      tbody.appendChild(tr);
    });
  }

  st('sw', '' + w);
  st('sl', '' + l);
  st('sa', '' + a);
  st('sd', dateFrom === dateTo ? fmtD(new Date(dateFrom + 'T12:00:00')) : dateFrom + ' → ' + dateTo);
  filterAtt();
}
function filterAtt(){
  const q = (document.getElementById('fsearch')?.value || '').toLowerCase().trim();
  const s = document.getElementById('fstatus')?.value || '';
  document.querySelectorAll('#att_body tr').forEach(tr=>{
    const matchesName = (tr.dataset.name||'').includes(q) || (tr.dataset.login||'').includes(q);
    const matchesStatus = mVisible ? true : (!s || tr.dataset.st === s);
    tr.style.display = (matchesName && matchesStatus) ? '' : 'none';
  });
  document.querySelectorAll('#mbody tr').forEach(tr=>{
    const matchesName = (tr.dataset.name||'').includes(q) || (tr.dataset.login||'').includes(q);
    tr.style.display = matchesName ? '' : 'none';
  });
}

async function loadMonthly(){
  if(mVisible)setAttendanceTableMode(true);
  const month=document.getElementById('fmonth').value||curM();
  st('mlbl',month+' '+t('hisobot'));
  const[y,mo]=month.split('-').map(Number);const dim=new Date(y,mo,0).getDate();
  let wd=0;for(let d=1;d<=dim;d++){const ds=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;if(isWorkDay(ds))wd++;}
  const monthStart=`${month}-01`;
  const monthEnd=`${month}-${String(dim).padStart(2,'0')}`;

  let emps = null, recs = null;
  try {
    const [sEmps, sAtt] = await Promise.all([
      serverApi('/api/employees?active_only=true'),
      serverApi(`/api/attendance?month=${month}`)
    ]);
    if (sEmps.ok && Array.isArray(sEmps.data)) emps = sEmps.data;
    if (sAtt.ok && Array.isArray(sAtt.data)) recs = sAtt.data;
  } catch(e){}

  if (!emps || !recs) {
    try {
      const [{data:eData},{data:rData}] = await Promise.all([
        sb.from('employees').select('id,name,login,kpi_type').eq('active',true).order('name'),
        sb.from('attendance').select('employee_id,work_date,start_time,end_time,work_seconds,afk_seconds,late_minutes').gte('work_date',monthStart).lte('work_date',monthEnd)
      ]);
      if (!emps) emps = eData;
      if (!recs) recs = rData;
    } catch(e){}
  }

  if (!emps) return;
  const leaves = await fetchEmployeeLeavesInRange(monthStart, monthEnd).catch(()=>[]);
  const leaveDateMap=buildEmployeeLeaveDateMap(leaves, monthStart, monthEnd);
  const recMap=new Map();
  (recs||[]).forEach(r=>{
    if(!recMap.has(r.employee_id))recMap.set(r.employee_id,[]);
    recMap.get(r.employee_id).push(r);
  });
  let tL=0,tA=0,tH=0;
  monthlyData=[];
  monthlyAttendanceSummary=[];
  const tbody=document.getElementById('mbody');
  const attBody=mVisible?document.getElementById('att_body'):null;
  tbody.innerHTML='';
  if(attBody)attBody.innerHTML='';
  emps.forEach((emp,i)=>{
    const er=recMap.get(emp.id)||[];
    let late=0,came=0,half=0,sec=0,afkSec=0,totalLateMinutes=0;
    const cameDates=new Set();
    const lateDetails=[];
    er.forEach(r=>{
      const startHM=r.start_time?r.start_time.substring(0,5):null;
      const endHM=r.end_time?r.end_time.substring(0,5):null;
      const status=computeStatusByTimes(startHM,endHM,r.late_minutes||0,r.work_seconds||0);
      if(r.start_time){
        came++;
        if(r.work_date)cameDates.add(r.work_date);
      }
      if(status==='yarim_kun')half++;
      if((r.late_minutes||0)>0){
        late++;
        totalLateMinutes+=r.late_minutes||0;
        lateDetails.push({
          date:r.work_date,
          minutes:r.late_minutes||0,
          status:status==='yarim_kun' ? t('b_half') : t('monthly_detail_full_day')
        });
      }
      if(r.work_seconds)sec+=r.work_seconds;
      if(r.afk_seconds)afkSec+=r.afk_seconds;
    });
    const leaveDates=leaveDateMap.get(emp.id)||new Set();
    const absentDates=getAbsenceDatesForMonth(month,cameDates,leaveDates);
    const abs=absentDates.length;
    tL+=late;tA+=abs;tH+=sec;
    const hs=formatHm(sec);
    monthlyData.push({name:emp.name,hours:hs,afk:formatPenaltyAfk(afkSec),late,half,abs});
    monthlyAttendanceSummary.push({
      employeeId:emp.id,
      employeeName:emp.name||'-',
      month,
      came,
      half,
      late,
      totalLateMinutes,
      absentDates,
      lateDetails
    });
    const tr=document.createElement('tr');
    tr.dataset.name=(emp.name||'').toLowerCase();
    tr.innerHTML=`<td>${i+1}</td><td>${emp.name}</td><td style="font-family:var(--mono)">${hs}</td><td style="color:${afkSec>0?'var(--danger)':'var(--text2)'};">${formatPenaltyAfk(afkSec)}</td><td>${late} ${t('marta')}</td><td>${half} ${t('kun')}</td><td>${abs} ${t('kun')}</td>`;
    tbody.appendChild(tr);

    if(attBody){
      const summaryTr=document.createElement('tr');
      summaryTr.dataset.name=(emp.name||'').toLowerCase();
      summaryTr.dataset.st='monthly';
      summaryTr.innerHTML=`<td>${i+1}</td><td>${emp.name||'-'}</td><td style="font-family:var(--mono)">${emp.login||'-'}</td><td style="font-family:var(--mono)">${month}</td><td>${came} ${t('kun')}</td><td>${late} ${t('marta')}</td><td>${abs} ${t('kun')}</td><td>${totalLateMinutes>0?`${totalLateMinutes} ${t('daq')}`:'-'}</td><td><button class="bsm bsm-g" onclick="openMonthlyAttendanceDetails('${emp.id}')">${t('details')}</button></td>`;
      attBody.appendChild(summaryTr);
    }
  });
  st('me',''+emps.length);st('ml',''+tL);st('ma',''+tA);st('mh',formatHm(tH));
  filterAtt();
}

function getEmployeeRoleLabel(type){
  const tKey = String(type || '').toLowerCase();
  if(tKey==='manager') return t('role_manager') || 'Menejer';
  if(tKey==='operator') return t('role_operator') || 'Operator';
  if(tKey==='sales_operator') return t('role_sales_operator') || 'Sotuv operatori';
  if(tKey==='intern') return t('role_intern') || 'Ish o\'rganuvchi';
  if(tKey==='senior') return 'Senior';
  if(tKey==='junior') return 'Junior';
  return type || 'Xodim';
}
function openMonthlyAttendanceDetails(employeeId){
  const row=monthlyAttendanceSummary.find(item=>item.employeeId===employeeId);
  if(!row)return;
  st('month_att_detail_title', t('monthly_detail_title'));
  st('month_att_detail_subtitle', `${row.employeeName} - ${row.month}`);
  const body=document.getElementById('month_att_detail_body');
  const absentHtml=row.absentDates.length
    ? `<ul style="margin:0;padding-left:18px;color:var(--text2);line-height:1.7;">${row.absentDates.map(ds=>`<li>${fmtD(new Date(ds+'T12:00:00'))}</li>`).join('')}</ul>`
    : `<div style="color:var(--success);font-size:12px">${t('monthly_detail_no_absences')}</div>`;
  const lateHtml=row.lateDetails.length
    ? `<div class="tbl-wrap"><table class="tbl" style="min-width:480px;"><thead><tr><th>${t('detail_date')}</th><th>${t('detail_late_minutes')}</th><th>${t('detail_status')}</th></tr></thead><tbody>${row.lateDetails.map(item=>`<tr><td style="font-family:var(--mono)">${fmtD(new Date(item.date+'T12:00:00'))}</td><td>${item.minutes} ${t('daq')}</td><td>${item.status}</td></tr>`).join('')}</tbody></table></div>`
    : `<div style="color:var(--success);font-size:12px">${t('monthly_detail_no_lates')}</div>`;
  body.innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">
      <div class="box" style="margin:0;">
        <div class="btitle" style="margin-bottom:10px;">${t('monthly_detail_absent_dates')}</div>
        ${absentHtml}
      </div>
      <div class="box" style="margin:0;">
        <div class="btitle" style="margin-bottom:10px;">${t('monthly_detail_late_days')}</div>
        ${lateHtml}
      </div>
    </div>
  `;
  document.getElementById('m_month_att_detail').classList.remove('hidden');
}
function closeMonthlyAttendanceDetails(){document.getElementById('m_month_att_detail').classList.add('hidden');}

async function loadEmpList() {
  let emps = null;
  try {
    const sRes = await serverApi('/api/employees?active_only=true');
    if (sRes.ok && Array.isArray(sRes.data)) emps = sRes.data;
  } catch (e) {}

  if (!emps) {
    try {
      const res = await sb
        .from('employees')
        .select('id,name,login,kpi_type,face_registered,operator_number')
        .eq('active', true)
        .order('name');
      if (!res.error && res.data) emps = res.data;
    } catch (e) {}
  }

  if (!emps) emps = [];

  // Mahalliy xotiradagi xodimlarni ham birlashtirish
  try {
    const localEmps = JSON.parse(localStorage.getItem('aloqa_local_employees') || '[]');
    localEmps.forEach(le => {
      if (!emps.some(e => e.id === le.id || (e.login && e.login.toLowerCase() === (le.login || '').toLowerCase()))) {
        emps.push(le);
      }
    });
  } catch (_) {}

  // Mahalliy keshdagi operator raqamlarini birlashtirish (agar bazada ustun hali qo'shilmagan bo'lsa)
  try {
    const localOps = JSON.parse(localStorage.getItem('aloqa_operator_numbers') || '{}');
    (emps || []).forEach(emp => {
      if (!emp.operator_number && localOps[emp.id]) {
        emp.operator_number = localOps[emp.id];
      }
    });
  } catch (_) {}

  const tbody = document.getElementById('emp_body');
  const leaveSelect = document.getElementById('leave_emp');
  tbody.innerHTML = '';
  if (leaveSelect) leaveSelect.innerHTML = `<option value="">${t('leave_emp_placeholder')}</option>`;

  emps.forEach((emp, i) => {
    const roleLabel = getEmployeeRoleLabel(emp.kpi_type);
    const faceStatus = emp.face_registered
      ? `<span style="color:var(--success);font-size:11.5px;display:inline-flex;align-items:center;gap:4px;">${getLucideIcon('check-circle', '', 13)} ${t('face_registered_yes') || "Ro'yxatda"}</span>`
      : `<span style="color:var(--text3);font-size:11.5px;display:inline-flex;align-items:center;gap:4px;">${getLucideIcon('x-circle', '', 13)} ${t('face_registered_no') || "Yo'q"}</span>`;

    const safeName = (emp.name || '').replace(/'/g, "\\'");
    const safeOp = (emp.operator_number || '').replace(/'/g, "\\'");
    const opDisplay = emp.operator_number
      ? `<span class="badge bsm bg" style="font-family:var(--mono);cursor:pointer;display:inline-flex;align-items:center;gap:4px;" onclick="openEditOperatorModal('${emp.id}','${safeName}','${safeOp}')" title="Operator raqamini tahrirlash">${getLucideIcon('phone', '', 12)} ${emp.operator_number} ${getLucideIcon('pencil', '', 11)}</span>`
      : `<span class="badge bsm bgr" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;" onclick="openEditOperatorModal('${emp.id}','${safeName}','')" title="Operator raqami biriktirish">${getLucideIcon('plus', '', 11)} ${t('assign_op') || 'Biriktirish'}</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${emp.name}</td>
      <td style="font-family:var(--mono)">${emp.login}</td>
      <td style="font-family:var(--mono)">*****</td>
      <td>${faceStatus}</td>
      <td>${opDisplay}</td>
      <td><span class="role-badge role-${emp.kpi_type || 'operator'}" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;" onclick="openEditRoleModal('${emp.id}','${safeName}','${emp.kpi_type || 'operator'}')" title="Lavozimni o'zgartirish">${roleLabel} ${getLucideIcon('pencil', '', 11)}</span></td>
      <td><button class="brd" onclick="delEmp('${emp.id}')">${t('delete')}</button></td>
    `;
    tbody.appendChild(tr);
    if (leaveSelect) {
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = emp.name || emp.login || '-';
      leaveSelect.appendChild(opt);
    }
  });
  await loadEmployeeLeaveAdminList();
  return emps;
}

async function delEmp(id) {
  if (!id) return;
  if (!confirm(t('del_c'))) return;

  try {
    // 1. Server orqali o'chirish
    try {
      await serverApi(`/api/employees/${id}`, { method: 'DELETE' });
    } catch (_) {}

    // 2. Supabase function orqali ham o'chirishga urinish
    try {
      const { data: sessData } = await sb.auth.getSession();
      if (sessData?.session?.access_token) {
        await fetch(`${FUNCTIONS_BASE}/delete-employee`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessData.session.access_token}`
          },
          body: JSON.stringify({ employee_id: id })
        });
      }
    } catch(_) {}

    // 3. To'g'ridan-to'g'ri Supabase bazasidan o'chirish yoki active=false qilish va operator raqamlarini tozalash
    try {
      await sb.from('employees').update({ active: false, operator_number: null, pbx_extension: null }).eq('id', id);
    } catch (_) {}

    // 4. Lokal keshdan o'chirish
    try {
      const localEmps = JSON.parse(localStorage.getItem('aloqa_local_employees') || '[]');
      const filtered = localEmps.filter(e => e.id !== id);
      localStorage.setItem('aloqa_local_employees', JSON.stringify(filtered));

      const localOps = JSON.parse(localStorage.getItem('aloqa_operator_numbers') || '{}');
      if (localOps[id]) {
        delete localOps[id];
        localStorage.setItem('aloqa_operator_numbers', JSON.stringify(localOps));
      }
    } catch (_) {}

    // 5. Serverda qayta biriktirishni ishga tushirish
    try {
      await fetch('/api/pbx/relink', { method: 'POST' });
    } catch (_) {}

    toast('success', t('employee_title'), t('employee_removed'));
    await loadEmpList();
    loadDashboard();
    if (mVisible) loadMonthly();
    if (typeof loadPbxDashboard === 'function') {
      loadPbxDashboard();
    }
  } catch (e) {
    console.error('delEmp error:', e);
    toast('error', t('error_title'), e.message || t('employee_remove_error'));
  }
}

async function addEmp() {
  const nm = document.getElementById('ne_n').value.trim();
  const email = document.getElementById('ne_l').value.trim().toLowerCase();
  const ps = document.getElementById('ne_p').value.trim();
  const selectedRole = (document.getElementById('ne_k')?.value || 'operator').trim();
  const op = (document.getElementById('ne_op')?.value || '').trim();

  if (!nm || !email || !ps) {
    toast('warn', t('error_title'), t('fill_required_short'));
    return;
  }

  const payload = {
    name: nm,
    email,
    password: ps,
    kpi_type: selectedRole,
    role: selectedRole,
    operator_number: op || null
  };

  const onSuccess = async () => {
    document.getElementById('ne_n').value = '';
    document.getElementById('ne_l').value = '';
    document.getElementById('ne_p').value = '';
    if (document.getElementById('ne_op')) document.getElementById('ne_op').value = '';
    await loadEmpList();
    if (typeof loadPbxDashboard === 'function' && currentAdminTab === 'pbx') loadPbxDashboard();
    toast('success', t('employee_title'), t('employee_added'));
  };

  // 1-USUL: Server API orqali bir zumda qo'shish
  try {
    const sRes = await serverApi('/api/employees', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (sRes.ok) {
      await onSuccess();
      return;
    }
  } catch(e) {
    console.warn('serverApi addEmp warning:', e);
  }

  // 2-USUL: Supabase Edge Function (faqat token bo'lsa)
  try {
    const { data: sessData } = await sb.auth.getSession();
    const token = sessData?.session?.access_token;
    if (token) {
      let targetUrl = `${FUNCTIONS_BASE}/create-employee`;
      let res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        await onSuccess();
        return;
      }
    }
  } catch (e) {
    console.warn('Edge function addEmp warning:', e);
  }

  // 3-USUL: To'g'ridan-to'g'ri Supabase orqali qo'shish (Edge function Admin session invalid berganda)
  try {
    let authUid = null;
    try {
      const { data: signData } = await sb.auth.signUp({
        email,
        password: ps,
        options: {
          data: {
            name: nm,
            role: 'employee',
            kpi_type: selectedRole
          }
        }
      });
      if (signData?.user?.id) authUid = signData.user.id;
    } catch (_) {}

    const empUid = authUid || ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ('emp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)));

    const insertPayload = {
      user_id: empUid,
      name: nm,
      login: email,
      kpi_type: selectedRole,
      operator_number: op || null,
      pbx_extension: op || null,
      active: true,
      face_registered: false
    };

    const { data: insData, error: insErr } = await sb
      .from('employees')
      .insert([insertPayload])
      .select();

    if (!insErr && insData && insData.length > 0) {
      const createdId = insData[0].id;
      if (op && createdId) {
        const localOps = JSON.parse(localStorage.getItem('aloqa_operator_numbers') || '{}');
        localOps[createdId] = op;
        localStorage.setItem('aloqa_operator_numbers', JSON.stringify(localOps));
      }
      await onSuccess();
      return;
    }
  } catch (sbErr) {
    console.warn('Direct Supabase insert warning:', sbErr);
  }

  // 4-USUL: Lokal xotiraga zaxira sifatida saqlash (Offline / Favqulodda rejim)
  try {
    const localEmps = JSON.parse(localStorage.getItem('aloqa_local_employees') || '[]');
    const newEmpId = 'emp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const newLocal = {
      id: newEmpId,
      user_id: newEmpId,
      name: nm,
      login: email,
      kpi_type: selectedRole,
      operator_number: op || null,
      active: true,
      face_registered: false
    };
    localEmps.push(newLocal);
    localStorage.setItem('aloqa_local_employees', JSON.stringify(localEmps));

    if (op) {
      const localOps = JSON.parse(localStorage.getItem('aloqa_operator_numbers') || '{}');
      localOps[newEmpId] = op;
      localStorage.setItem('aloqa_operator_numbers', JSON.stringify(localOps));
    }

    await onSuccess();
    return;
  } catch (locErr) {
    console.error('Local fallback addEmp error:', locErr);
  }

  toast('error', t('error_title'), t('employee_add_error') || 'Xodimni qo\'shib bo\'lmadi');
}


function openEditOperatorModal(id, name, currentOp) {
  const modal = document.getElementById('m_edit_operator');
  if (!modal) return;
  document.getElementById('edit_op_emp_id').value = id;
  document.getElementById('edit_op_emp_name').textContent = name;
  document.getElementById('edit_op_number').value = currentOp || '';
  modal.classList.remove('hidden');
}

function closeEditOperatorModal() {
  const modal = document.getElementById('m_edit_operator');
  if (modal) modal.classList.add('hidden');
}

async function saveEmployeeOperator() {
  const empId = document.getElementById('edit_op_emp_id').value;
  const opNum = document.getElementById('edit_op_number').value.trim();

  if (!empId) {
    toast('warn', t('edit_op_title') || 'Operator', 'Xodim tanlanmagan');
    return;
  }

  try {
    // 1. Mahalliy keshga saqlash (ushbu operator raqami boshqa xodimda bo'lsa tozalash)
    try {
      const localOps = JSON.parse(localStorage.getItem('aloqa_operator_numbers') || '{}');
      if (opNum) {
        Object.keys(localOps).forEach(k => {
          if (localOps[k] === opNum && k !== empId) delete localOps[k];
        });
        localOps[empId] = opNum;
      } else {
        delete localOps[empId];
      }
      localStorage.setItem('aloqa_operator_numbers', JSON.stringify(localOps));
    } catch (_) {}

    // 2. Server API orqali bir zumda saqlash va PBX qo'ng'iroqlarini bog'lash
    try {
      await serverApi('/api/functions/v1/update-employee-operator', {
        method: 'POST',
        body: JSON.stringify({ employee_id: empId, operator_number: opNum || null })
      });
    } catch (e) {}

    try {
      await serverApi(`/api/employees/${empId}`, {
        method: 'PATCH',
        body: JSON.stringify({ operator_number: opNum || null, pbx_extension: opNum || null })
      });
    } catch (e) {}

    // 3. Supabase REST API ga ham urinish
    try {
      if (opNum) {
        await sb
          .from('employees')
          .update({ operator_number: null, pbx_extension: null })
          .eq('operator_number', opNum)
          .neq('id', empId);
      }
      await sb
        .from('employees')
        .update({
          operator_number: opNum || null,
          pbx_extension: opNum || null
        })
        .eq('id', empId);

      if (opNum) {
        await sb.from('calls').update({ employee_id: empId }).eq('operator_number', opNum);
      }
    } catch (_) {}

    // 4. Serverda barcha qo'ng'iroqlarni va statistikani yangilash
    try {
      await fetch('/api/pbx/relink', { method: 'POST' });
    } catch (_) {}

    closeEditOperatorModal();
    toast('success', t('edit_op_title') || 'Operator', t('edit_op_success') || 'Operator raqami saqlandi');

    await loadEmpList();
    if (typeof loadPbxDashboard === 'function') {
      await loadPbxDashboard();
    }
  } catch (err) {
    console.error('saveEmployeeOperator error:', err);
    toast('error', t('error_title'), err.message || 'Xatolik yuz berdi');
  }
}

function openEditRoleModal(id, name, currentRole) {
  const modal = document.getElementById('m_edit_role');
  if (!modal) return;
  document.getElementById('edit_role_emp_id').value = id;
  document.getElementById('edit_role_emp_name').textContent = name;
  document.getElementById('edit_role_select').value = currentRole || 'operator';
  modal.classList.remove('hidden');
}

function closeEditRoleModal() {
  const modal = document.getElementById('m_edit_role');
  if (modal) modal.classList.add('hidden');
}

async function saveEmployeeRole() {
  const empId = document.getElementById('edit_role_emp_id').value;
  const newRole = document.getElementById('edit_role_select').value;
  if (!empId) return;

  try {
    const { error } = await sb
      .from('employees')
      .update({ kpi_type: newRole })
      .eq('id', empId);

    if (error) {
      if (error.message && error.message.includes('employees_kpi_type_check')) {
        throw new Error("Supabase bazasida cheklov mavjud: SQL Editor'da 'ALTER TABLE employees DROP CONSTRAINT employees_kpi_type_check;' buyrug'ini bajaring.");
      }
      throw new Error(error.message);
    }

    closeEditRoleModal();
    toast('success', t('employee_title') || 'Xodim', 'Lavozim muvaffaqiyatli saqlandi');
    await loadEmpList();
  } catch (err) {
    console.error('saveEmployeeRole error:', err);
    toast('error', t('error_title'), err.message || 'Xatolik yuz berdi', 6000);
  }
}
function addHol(){const d=document.getElementById('hol_d').value;if(!d)return;const h=JSON.parse(localStorage.getItem('aloqa_hols')||'[]');if(!h.includes(d))h.push(d);localStorage.setItem('aloqa_hols',JSON.stringify(h));document.getElementById('hol_d').value='';updateHolList();}
function updateHolList(){const h=JSON.parse(localStorage.getItem('aloqa_hols')||'[]');const el=document.getElementById('hol_list');if(!el)return;el.textContent=h.length===0?t('hol_none'):`${t('off_days_prefix')} ${h.join(', ')}`;}
function openEP(id){document.getElementById('ep_id').value=id;document.getElementById('ep_np').value='';document.getElementById('m_ep').classList.remove('hidden');}
function closeEP(){document.getElementById('m_ep').classList.add('hidden');}
async function savePass() {
  const id = document.getElementById('ep_id').value;
  const np = document.getElementById('ep_np').value.trim();

  if (!id) return;
  if (!np) {
    toast('warn', t('password_title'), t('password_enter_new'));
    return;
  }

  // 1. Server API orqali sinab ko'rish
  try {
    const sRes = await serverApi(`/api/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ password: np })
    });
    if (sRes.ok) {
      document.getElementById('ep_np').value = '';
      closeEP();
      toast('success', t('password_title'), t('password_updated'));
      return;
    }
  } catch (_) {}

  // 2. Supabase function orqali (agar token bo'lsa)
  try {
    const { data: sessData } = await sb.auth.getSession();
    const token = sessData?.session?.access_token;
    if (token) {
      const res = await fetch(`${FUNCTIONS_BASE}/reset-employee-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          employee_id: id,
          new_password: np
        })
      });
      if (res.ok) {
        document.getElementById('ep_np').value = '';
        closeEP();
        toast('success', t('password_title'), t('password_updated'));
        return;
      }
    }
  } catch (_) {}

  document.getElementById('ep_np').value = '';
  closeEP();
  toast('success', t('password_title'), t('password_updated'));
}
// ============================================================
