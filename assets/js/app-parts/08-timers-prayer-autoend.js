//  TIMERS
// ============================================================
function startWT(){
  stopWT();let cnt=0;
  wIv=setInterval(()=>{
    let tot=wAccum;if(wStart)tot+=Math.floor((tzNow()-wStart)/1000);setTV(tot,'tw');
    cnt++;if(cnt%30===0){saveLS();savePartial();}
  },1000);
}
function stopWT(){if(wIv){clearInterval(wIv);wIv=null;}}
function startLT(){
  stopLT();
  lIv=setInterval(()=>{let tot=lAccum;if(lStart)tot+=Math.floor((tzNow()-lStart)/1000);setTV(tot,'tl');updateBreakBar();},1000);
}
function stopLT(){if(lIv){clearInterval(lIv);lIv=null;}}
function startPT(){stopPT();pIv=setInterval(()=>{let tot=prayerAccum;if(prayerStart)tot+=Math.floor((tzNow()-prayerStart)/1000);setTV(tot,'tp');saveLS();},1000);}
function stopPT(){if(pIv){clearInterval(pIv);pIv=null;}}
function setTV(sec,id){const e=document.getElementById(id);if(e)e.textContent=fmtSec(sec);}
function stopAll(){stopWT();stopLT();stopPT();}

function updateBreakBar(){
  const bar=document.getElementById('breakBar');const used=document.getElementById('breakUsed');
  const total=breakSeconds;
  const pct=Math.min(100,(total/BREAK_LIMIT_SEC)*100);
  if(bar){bar.style.width=pct+'%';bar.classList.toggle('over',total>BREAK_LIMIT_SEC);}
  if(used)used.textContent=Math.floor(total/60)+' daq';
}


// ============================================================
//  PRAYER TIMES (Namoz vaqtlari - Ishonchli manbalardan)
// ============================================================
let prayerClockIv = null;
const PRAYER_REGION_SLUG = 'toshkent-shahri';
let prayerTimesState = { date: '', times: null, list: [], next: null, source: '' };

function getPrayerLabel(key) {
  const isUz = (typeof lang !== 'undefined' ? lang : 'uz') === 'uz';
  const labels = {
    fajr: isUz ? 'Bomdod' : 'Фаджр',
    sunrise: isUz ? 'Quyosh' : 'Восход',
    dhuhr: isUz ? 'Peshin' : 'Зухр',
    asr: isUz ? 'Asr' : 'Аср',
    maghrib: isUz ? 'Shom' : 'Магриб',
    isha: isUz ? 'Xufton' : 'Иша'
  };
  return labels[key] || key;
}

function parsePrayerList(timesObj) {
  if (!timesObj) return [];
  const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  return keys
    .filter(k => Boolean(timesObj[k]))
    .map(k => ({
      key: k,
      name: getPrayerLabel(k),
      time: String(timesObj[k]).trim()
    }));
}

function findNextPrayer(list) {
  if (!list || !list.length) return null;
  const nowMin = typeof getTzTotalMinutes === 'function' ? getTzTotalMinutes() : (() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();

  const next = list.find(item => {
    const parts = (item.time || '').split(':').map(Number);
    const mVal = (parts[0] || 0) * 60 + (parts[1] || 0);
    return mVal > nowMin;
  });

  // Agar bugungi barcha 5 vaqt namoz o'tib bo'lgan bo'lsa, ertangi birinchi namoz (Bomdod)
  return next || list[0];
}

async function fetchPrayerSchedule(force = false) {
  const today = typeof todayISO === 'function' ? todayISO() : new Date().toISOString().split('T')[0];
  const cacheKey = `aloqa_prayer_times_${today}`;

  if (!force && prayerTimesState.date === today && prayerTimesState.list.length) {
    prayerTimesState.next = findNextPrayer(prayerTimesState.list);
    return prayerTimesState;
  }

  // 1. LocalStorage keshidan tekshirish
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && cached.date === today && cached.times) {
        const list = parsePrayerList(cached.times);
        prayerTimesState = {
          date: today,
          times: cached.times,
          list,
          next: findNextPrayer(list),
          source: cached.source || 'kesh'
        };
        return prayerTimesState;
      }
    } catch (e) {}
  }

  // 2. Server orqali (O'zbekiston Musulmonlar idorasi taqvimi)
  try {
    const res = await fetch(resolveApiUrl('/api/prayer-times?region=toshkent-shahri'));
    if (res.ok) {
      const json = await res.json();
      if (json && json.ok && json.times) {
        const list = parsePrayerList(json.times);
        prayerTimesState = {
          date: today,
          times: json.times,
          list,
          next: findNextPrayer(list),
          source: json.source || 'namoz-vaqti.uz'
        };
        localStorage.setItem(cacheKey, JSON.stringify(prayerTimesState));
        return prayerTimesState;
      }
    }
  } catch (e) {
    console.warn('[Prayer] Server API dan olishda xatolik:', e.message);
  }

  // 3. To'g'ridan-to'g'ri Aladhan API (Jahon standarti, ochiq CORS)
  try {
    const res = await fetch('https://api.aladhan.com/v1/timingsByCity?city=Tashkent&country=Uzbekistan&method=3&school=1');
    if (res.ok) {
      const json = await res.json();
      const t = json?.data?.timings;
      if (t) {
        const times = {
          fajr: t.Fajr.substring(0, 5),
          sunrise: t.Sunrise.substring(0, 5),
          dhuhr: t.Dhuhr.substring(0, 5),
          asr: t.Asr.substring(0, 5),
          maghrib: t.Maghrib.substring(0, 5),
          isha: t.Isha.substring(0, 5)
        };
        const list = parsePrayerList(times);
        prayerTimesState = {
          date: today,
          times,
          list,
          next: findNextPrayer(list),
          source: 'api.aladhan.com'
        };
        localStorage.setItem(cacheKey, JSON.stringify(prayerTimesState));
        return prayerTimesState;
      }
    }
  } catch (e) {
    console.warn('[Prayer] Aladhan API dan olishda xatolik:', e.message);
  }

  // 4. Oxirgi ishonchli zaxira (Toshkent rasmiy taqvimi)
  const fallbackTimes = {
    fajr: '05:16',
    sunrise: '06:35',
    dhuhr: '12:09',
    asr: '15:59',
    maghrib: '17:46',
    isha: '19:01'
  };
  const list = parsePrayerList(fallbackTimes);
  prayerTimesState = {
    date: today,
    times: fallbackTimes,
    list,
    next: findNextPrayer(list),
    source: 'fallback'
  };
  return prayerTimesState;
}

function getPrayerSchedule() {
  if (prayerTimesState.list && prayerTimesState.list.length) {
    return prayerTimesState.list;
  }
  return parsePrayerList({
    fajr: '05:16',
    dhuhr: '12:09',
    asr: '15:59',
    maghrib: '17:46',
    isha: '19:01'
  });
}

async function updatePrayerInfo() {
  const state = await fetchPrayerSchedule();
  if (state.list && state.list.length) {
    state.list.forEach(p => { p.name = getPrayerLabel(p.key); });
  }
  const next = findNextPrayer(state.list) || state.list[0];
  state.next = next;

  const npn = document.getElementById('nextPrayerName');
  const npt = document.getElementById('nextPrayerTime');
  const tracker = document.getElementById('prayerTracker');

  if (npn) npn.textContent = next ? next.name : '—';
  if (npt) npt.textContent = next ? next.time : '--:--';

  if (tracker && state.times) {
    const isUz = (typeof lang !== 'undefined' ? lang : 'uz') === 'uz';
    const bTxt = isUz ? 'Bomdod' : 'Фаджр';
    const pTxt = isUz ? 'Peshin' : 'Зухр';
    const aTxt = isUz ? 'Asr' : 'Аср';
    const sTxt = isUz ? 'Shom' : 'Магриб';
    const xTxt = isUz ? 'Xufton' : 'Иша';
    tracker.title = `${bTxt}: ${state.times.fajr} | ${pTxt}: ${state.times.dhuhr} | ${aTxt}: ${state.times.asr} | ${sTxt}: ${state.times.maghrib} | ${xTxt}: ${state.times.isha} (${state.source})`;
  }
}

function startPrayerClock() {
  updatePrayerInfo();
  if (prayerClockIv) clearInterval(prayerClockIv);
  prayerClockIv = setInterval(() => {
    updatePrayerInfo().catch(() => {});
  }, 60000);
}

// ============================================================
//  AUTO-END
// ============================================================
function startAutoEndCheck(){
  if(autoEndIv)clearInterval(autoEndIv);
  autoEndIv=setInterval(()=>{
    if(autoEndDone)return;
    if(!['working','lunch','paused','prayer'].includes(empState))return;
    if(getTzTotalMinutes()>=((AUTO_END_HOUR*60)+AUTO_END_MIN))empEnd(true);
  },15000);
  if(!autoEndDone&&['working','lunch','paused','prayer'].includes(empState)&&getTzTotalMinutes()>=((AUTO_END_HOUR*60)+AUTO_END_MIN))empEnd(true);
}

