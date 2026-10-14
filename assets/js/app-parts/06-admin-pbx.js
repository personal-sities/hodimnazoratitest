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
  ['main','notif','feedback','settings'].forEach(n=>{const el=document.getElementById('tab_'+n);if(el)el.classList.toggle('hidden',n!==tab);});
  ['nav_main','nav_feedback','nav_notif','nav_settings'].forEach((id,i)=>{const el=document.getElementById(id);if(el)el.classList.toggle('active',['main','feedback','notif','settings'][i]===tab);});
  st('admTitle',getAdminTabTitle(tab));
  if(tab==='settings'){loadEmpList();updateIPList();loadGPSSettingsUI();loadFaceControlSettings();}
  if(tab==='feedback')loadFeedbackAdmin();
  if(tab==='notif'){loadNotificationsAdmin();loadNotifEmpSelect();}
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
  const month=document.getElementById('fmonth')?.value||curM();
  st('dash_month',month);
  const chart=document.getElementById('dash_work_chart');
  const stats=document.getElementById('dash_work_stats');
  const labels=document.getElementById('dash_work_labels');
  if(chart)chart.innerHTML='';
  if(stats)stats.innerHTML=`<div class="dash-mini-stat"><strong>...</strong><span>${t('loading')}</span></div>`;
  if(labels)labels.innerHTML='';
  const[y,mo]=month.split('-').map(Number);const dim=new Date(y,mo,0).getDate();
  let wd=0;for(let d=1;d<=dim;d++){const ds=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;if(isWorkDay(ds))wd++;}
  const monthStart=`${month}-01`;
  const monthEnd=`${month}-${String(dim).padStart(2,'0')}`;
  const [{data:emps,error:empErr},{data:recs,error:recErr},leaves] = await Promise.all([
    sb.from('employees').select('*'),
    sb.from('attendance').select('*').gte('work_date',monthStart).lte('work_date',monthEnd),
    fetchEmployeeLeavesInRange(monthStart, monthEnd)
  ]);
  if(empErr||recErr){toast('error','Dashboard',(empErr||recErr).message||t('dashboard_error'));return;}
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
  const search = document.getElementById('fsearch').value || '';
  const statusFilter = document.getElementById('fstatus').value || '';

  const [{ data, error }, leaves] = await Promise.all([
    sb.rpc('admin_attendance_range', {
      p_from: dateFrom,
      p_to: dateTo,
      p_search: search,
      p_status: statusFilter
    }),
    fetchEmployeeLeavesInRange(dateFrom, dateTo)
  ]);

  if (error) {
    console.error('loadAtt rpc error:', error);
    toast('error', t('error_title'), error.message || t('attendance_load_error'));
    return;
  }

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
      let hrs = row.worked_seconds ? secToHMS(row.worked_seconds) : '-';
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
        bt = `⚙️ ${t('auto_label')}`;
      } else if (status === 'work_leave') {
        bc2 = 'bauto';
        bt = t('on_work_leave');
      }

      const afkFmt = formatPenaltyAfk(afkSec);

      const tr = document.createElement('tr');
      tr.dataset.name = (row.employee_name || '').toLowerCase();
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

      grouped[id].totalSec += row.worked_seconds || 0;
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
}
function filterAtt(){
  const q=document.getElementById('fsearch').value.toLowerCase();
  const s=document.getElementById('fstatus').value;
  document.querySelectorAll('#att_body tr').forEach(tr=>{
    const matchesName=(tr.dataset.name||'').includes(q);
    const matchesStatus=mVisible?true:(!s||tr.dataset.st===s);
    tr.style.display=(matchesName&&matchesStatus)?'':'none';
  });
  document.querySelectorAll('#mbody tr').forEach(tr=>{
    tr.style.display=((tr.dataset.name||'').includes(q))?'':'none';
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
  const [{data:emps,error:empErr},{data:recs,error:recErr},leaves] = await Promise.all([
    sb.from('employees').select('id,name,login,kpi_type').eq('active',true).order('name'),
    sb.from('attendance').select('employee_id,work_date,start_time,end_time,work_seconds,afk_seconds,late_minutes').gte('work_date',monthStart).lte('work_date',monthEnd),
    fetchEmployeeLeavesInRange(monthStart, monthEnd)
  ]);
  if(empErr||recErr||!emps)return;
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
  if(type==='manager'||type==='senior') return t('role_manager');
  if(type==='operator') return t('role_operator');
  if(type==='intern'||type==='junior') return t('role_intern');
  return type || '-';
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
  const { data: emps, error } = await sb
    .from('employees')
    .select('id,name,login,kpi_type,face_registered')
    .eq('active', true)
    .order('name');

  if (error || !emps) {
    toast('error', t('error_title'), error?.message || t('employees_load_error'));
    return [];
  }

  const tbody = document.getElementById('emp_body');
  const leaveSelect = document.getElementById('leave_emp');
  tbody.innerHTML = '';
  if (leaveSelect) leaveSelect.innerHTML = `<option value="">${t('leave_emp_placeholder')}</option>`;

  emps.forEach((emp, i) => {
    const roleLabel = getEmployeeRoleLabel(emp.kpi_type);
    const faceStatus = emp.face_registered
      ? '<span style="color:var(--success);font-size:11px">✅ Ro\'yxatda</span>'
      : '<span style="color:var(--text3);font-size:11px">❌ Yo\'q</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${emp.name}</td>
      <td style="font-family:var(--mono)">${emp.login}</td>
      <td style="font-family:var(--mono)">*****</td>
      <td>${faceStatus}</td>
      <td><span class="role-badge role-${emp.kpi_type || 'operator'}">${roleLabel}</span></td>
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
  Array.from(tbody.querySelectorAll('tr td:nth-child(5) span')).forEach(el=>{
    if(/Ro'yxatda|Зарегистрировано|registered/i.test(el.textContent)) el.textContent=`✅ ${t('face_registered_yes')}`;
    else el.textContent=`❌ ${t('face_registered_no')}`;
  });
  await loadEmployeeLeaveAdminList();
  return emps;
}
async function delEmp(id) {
  if (!id) return;
  if (!confirm(t('del_c'))) return;

  try {
    const { data: sessData, error: sessErr } = await sb.auth.getSession();
    if (sessErr || !sessData?.session?.access_token) {
      throw new Error(t('admin_session_missing'));
    }

    const res = await fetch(`${FUNCTIONS_BASE}/delete-employee`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessData.session.access_token}`
      },
      body: JSON.stringify({ employee_id: id })
    });

    const raw = await res.text();
    let result = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = { error: raw || 'Noma’lum xato' };
    }

    if (!res.ok) {
      throw new Error(result.error || t('employee_remove_error'));
    }

    toast('success', t('employee_title'), t('employee_removed'));
    await loadEmpList();
    loadDashboard();
    if (mVisible) loadMonthly();
  } catch (e) {
    console.error('delEmp error:', e);
    toast('error', t('error_title'), e.message || t('employee_remove_error'));
  }
}
async function addEmp() {
  const nm = document.getElementById('ne_n').value.trim();
  const email = document.getElementById('ne_l').value.trim().toLowerCase();
  const ps = document.getElementById('ne_p').value.trim();
  const kp = document.getElementById('ne_k').value;

  if (!nm || !email || !ps) {
    toast('warn', t('error_title'), t('fill_required_short'));
    return;
  }

  try {
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) {
      toast('error', t('error_title'), t('auth_session_invalid'));
      return;
    }

    const { data: sessData, error: sessErr } = await sb.auth.getSession();
    const token = sessData?.session?.access_token;

    if (!token) {
      toast('error', t('error_title'), t('admin_session_missing'));
      return;
    }

    const payload = {
      name: nm,
      email,
      password: ps,
      kpi_type: kp
    };

    const res = await fetch(`${FUNCTIONS_BASE}/create-employee`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const raw = await res.text();

    let result = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = { error: raw || 'Noma’lum xato' };
    }

    if (!res.ok) {
      toast('error', t('error_title'), result.error || result.message || t('employee_add_error'));
      return;
    }

    document.getElementById('ne_n').value = '';
    document.getElementById('ne_l').value = '';
    document.getElementById('ne_p').value = '';
    await loadEmpList();

    toast('success', t('employee_title'), t('employee_added'));
  } catch (e) {
    console.error('addEmp CATCH ERROR:', e);
    toast('error', t('error_title'), e.message || t('system_error'));
  }
}
function addHol(){const d=document.getElementById('hol_d').value;if(!d)return;const h=JSON.parse(localStorage.getItem('aloqa_hols')||'[]');if(!h.includes(d))h.push(d);localStorage.setItem('aloqa_hols',JSON.stringify(h));document.getElementById('hol_d').value='';updateHolList();}
function updateHolList(){const h=JSON.parse(localStorage.getItem('aloqa_hols')||'[]');const el=document.getElementById('hol_list');if(!el)return;el.textContent=h.length===0?t('hol_none'):`${t('off_days_prefix')} ${h.join(', ')}`;}
function openEP(id){document.getElementById('ep_id').value=id;document.getElementById('ep_np').value='';document.getElementById('m_ep').classList.remove('hidden');}
function closeEP(){document.getElementById('m_ep').classList.add('hidden');}
async function savePass() {
  const id = document.getElementById('ep_id').value;
  const np = document.getElementById('ep_np').value.trim();

  if (!np) {
    toast('warn', t('password_title'), t('password_enter_new'));
    return;
  }

  try {
    const { data: sessData, error: sessErr } = await sb.auth.getSession();
    if (sessErr || !sessData?.session?.access_token) {
      throw new Error('Admin sessiyasi topilmadi');
    }

    const token = sessData.session.access_token;

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

    const raw = await res.text();
    let result = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = { error: raw || 'Noma’lum xato' };
    }

    if (!res.ok) {
      throw new Error(result.error || t('password_not_updated'));
    }

    document.getElementById('ep_np').value = '';
    closeEP();
    toast('success', t('password_title'), t('password_updated'));
  } catch (err) {
    console.error('savePass error:', err);
    toast('error', t('error_title'), err.message || t('password_update_error'));
  }
}
// ============================================================
