// ============================================================
//  CONFIG
// ============================================================
const SUPABASE_URL  = 'https://hdbhdddekjjjtwtyocfa.supabase.co';
const SUPABASE_ANON = 'sb_publishable_CZUB0mOSzmmCvviNzWykzw_B3_0-5bE';
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
const PROJECT_NAME = 'AloqaPro ISFT Instituti';
const TELEGRAM_ERROR_BOT_TOKEN = '8905038089:AAFB-ptADnMpnksrs2MwbqwV5MvrjvzBM2M';
const TELEGRAM_ERROR_CHAT_ID = '2031871840';

const TASHKENT_TIMEZONE = 'Asia/Tashkent';
const WORKDAY_START_MINUTES = 9 * 60;
const WORKDAY_END_MINUTES = 18 * 60;
const FACE_CHECK_INTERVAL = 25000;
const FACE_FOUND_COOLDOWN_INTERVAL = 60000;
const FACE_SEARCH_INTERVAL = 1000;
const FACE_MONITOR_INTERVAL = FACE_FOUND_COOLDOWN_INTERVAL;
const FACE_RETRY_INTERVAL = FACE_SEARCH_INTERVAL;
const STABLE_HIT_REQUIRED = 3;
const FACE_MIN_VISIBLE_AREA = 0.015;
const FACE_MISS_REQUIRED = 3;
const FACE_LOSS_WARNING_DELAY_SEC = 120;
const AFK_GRACE_SEC       = 600;
const BREAK_LIMIT_SEC     = 1800;
const AUTO_END_HOUR       = 18;
const AUTO_END_MIN        = 0;
const AUTO_END_TASK_WARNING_INTERVAL_MS = 5 * 60 * 1000;
const LATE_AFTER_MINUTES  = WORKDAY_START_MINUTES;
const HALF_DAY_START_MINUTES = 11 * 60;
const HALF_DAY_END_MINUTES   = 15 * 60;
const TARGET_WORK_SEC_PER_DAY = (WORKDAY_END_MINUTES - WORKDAY_START_MINUTES) * 60;
const NOTIF_POLL_INTERVAL = 30000;
const REALTIME_SCHEMA = 'public';
const ABSENCE_START_KEY = 'aloqa_absence_start_date';

// ============================================================
//  ERROR REPORTING
// ============================================================
const errorReportState = {
  sent: new Map(),
  maxTextLength: 3500
};

function safeErrorText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name || 'Error'}: ${value.message || ''}\n${value.stack || ''}`;
  try {
    return JSON.stringify(value, Object.getOwnPropertyNames(value));
  } catch {
    return String(value);
  }
}
function classifyPlatformError(type) {
  if (type === 'supabase_edge_function') return 'Supabase Edge Function xatolik';
  if (type === 'supabase_table') return 'Supabase table xatolik';
  if (type === 'frontend') return 'Frontend xatolik';
  return 'Platforma xatolik';
}
function buildErrorReportText(type, error, context = {}) {
  const source = classifyPlatformError(type);
  const page = `${location.pathname}${location.search}${location.hash}`;
  const user = typeof CU !== 'undefined' && CU ? `${CU.role || '-'} | ${CU.name || CU.login || CU.id || '-'}` : 'login qilmagan';
  const lines = [
    `Loyiha: ${PROJECT_NAME}`,
    `Xato turi: ${source}`,
    `Vaqt: ${new Date().toLocaleString('uz-UZ', { timeZone: TASHKENT_TIMEZONE })}`,
    `Sahifa: ${page}`,
    `Foydalanuvchi: ${user}`
  ];
  if (context.table) lines.push(`Table: ${context.table}`);
  if (context.action) lines.push(`Amal: ${context.action}`);
  if (context.url) lines.push(`URL: ${context.url}`);
  if (context.status) lines.push(`Status: ${context.status}`);
  if (context.file) lines.push(`Fayl: ${context.file}`);
  if (context.line) lines.push(`Qator: ${context.line}`);
  if (context.extra) lines.push(`Qo'shimcha: ${safeErrorText(context.extra).slice(0, 500)}`);
  const details = safeErrorText(error).slice(0, errorReportState.maxTextLength);
  lines.push('', `Tafsilot: ${details || 'Tafsilot yoq'}`);
  return lines.join('\n')
    .replace('Loyiha:', '🏫 Loyiha:')
    .replace('Xato turi:', '🚨 Xato turi:')
    .replace('Vaqt:', '🕒 Vaqt:')
    .replace('Sahifa:', '📍 Sahifa:')
    .replace('Foydalanuvchi:', '👤 Foydalanuvchi:')
    .replace('Table:', '🗃️ Table:')
    .replace('Amal:', '⚙️ Amal:')
    .replace('URL:', '🔗 URL:')
    .replace('Status:', '📡 Status:')
    .replace('Fayl:', '📄 Fayl:')
    .replace('Qator:', '🔢 Qator:')
    .replace('Qo\'shimcha:', '📝 Qo\'shimcha:')
    .replace('Tafsilot:', '🧾 Tafsilot:');
}
function shouldSendErrorReport(key) {
  const now = Date.now();
  const last = errorReportState.sent.get(key) || 0;
  if (now - last < 60000) return false;
  errorReportState.sent.set(key, now);
  return true;
}
function sendTelegramErrorReport(text) {
  if (!TELEGRAM_ERROR_BOT_TOKEN || !TELEGRAM_ERROR_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_ERROR_BOT_TOKEN}/sendMessage`;
  const body = new URLSearchParams({
    chat_id: TELEGRAM_ERROR_CHAT_ID,
    text
  });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body.toString()], { type: 'application/x-www-form-urlencoded;charset=UTF-8' });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {}
  fetch(url, { method:'POST', mode:'no-cors', body, keepalive:true }).catch(() => {});
}
function reportPlatformError(type, error, context = {}) {
  try {
    const text = buildErrorReportText(type, error, context);
    const key = `${type}|${context.table || ''}|${context.url || ''}|${safeErrorText(error).slice(0, 220)}`;
    if (shouldSendErrorReport(key)) sendTelegramErrorReport(text);
  } catch (reportErr) {
    console.warn('Telegram error report failed:', reportErr);
  }
}
function watchSupabaseBuilder(builder, table, action = '') {
  if (!builder || typeof builder !== 'object' || builder.__errorReporterWrapped) return builder;
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop === '__errorReporterWrapped') return true;
      if (prop === 'then') {
        return (resolve, reject) => target.then(result => {
          if (result?.error) reportPlatformError('supabase_table', result.error, { table, action });
          return resolve(result);
        }, err => {
          reportPlatformError('supabase_table', err, { table, action });
          return reject(err);
        });
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const next = value.apply(target, args);
        return next && typeof next === 'object' ? watchSupabaseBuilder(next, table, String(prop)) : next;
      };
    }
  });
}
const originalSupabaseFrom = sb.from.bind(sb);
sb.from = table => watchSupabaseBuilder(originalSupabaseFrom(table), table);

const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const input = args[0];
  const url = typeof input === 'string' ? input : input?.url || '';
  try {
    const res = await originalFetch(...args);
    if (url.startsWith(FUNCTIONS_BASE) && !res.ok) {
      let body = '';
      try { body = await res.clone().text(); } catch {}
      reportPlatformError('supabase_edge_function', body || res.statusText, { url, status: res.status });
    }
    return res;
  } catch (err) {
    if (url.startsWith(FUNCTIONS_BASE)) reportPlatformError('supabase_edge_function', err, { url });
    else if (!url.includes('api.telegram.org')) reportPlatformError('frontend', err, { url });
    throw err;
  }
};
window.addEventListener('error', event => {
  reportPlatformError('frontend', event.error || event.message, {
    file: event.filename,
    line: event.lineno,
    extra: event.message
  });
});
window.addEventListener('unhandledrejection', event => {
  reportPlatformError('frontend', event.reason || 'Unhandled promise rejection');
});

// ============================================================
//  THEME
// ============================================================
let currentTheme = localStorage.getItem('aloqa_theme') || 'light';
function applyTheme(th) {
  document.documentElement.setAttribute('data-theme', th);
  ['themeToggle','themeToggle2','themeToggle3','themeToggle4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = th === 'light';
  });
  localStorage.setItem('aloqa_theme', th);
  currentTheme = th;
}
function toggleTheme() {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  ['themeToggle','themeToggle2','themeToggle3','themeToggle4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = currentTheme === 'light';
  });
}
applyTheme(currentTheme);

// ============================================================
//  TOAST
// ============================================================
function toast(type, title, msg, duration = 3500) {
  const icons = { success:'✅', error:'❌', warn:'⚠️', info:'ℹ️' };
  const c = document.getElementById('toast-container');
  const d = document.createElement('div');
  d.className = `toast ${type}`;
  d.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><div class="toast-body"><div class="toast-title">${title}</div><div class="toast-msg">${msg||''}</div></div>`;
  c.appendChild(d);
  setTimeout(() => {
    d.classList.add('removing');
    setTimeout(() => d.remove(), 320);
  }, duration);
}

// ============================================================
//  BLOCKING LOADER
// ============================================================
function showBlockingLoader(message) {
  let el = document.getElementById('blockingLoader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'blockingLoader';
    el.className = 'blocking-loader hidden';
    el.innerHTML = `
      <div class="blocking-loader-box" role="status" aria-live="polite">
        <span class="blocking-loader-spinner"></span>
        <div class="blocking-loader-text" id="blockingLoaderText">Iltimos kuting...</div>
      </div>
    `;
    document.body.appendChild(el);
  }
  const text = document.getElementById('blockingLoaderText');
  if (text) text.textContent = message || 'Iltimos kuting...';
  el.classList.remove('hidden');
}
function hideBlockingLoader() {
  const el = document.getElementById('blockingLoader');
  if (el) el.classList.add('hidden');
}

// ============================================================
//  PWA
// ============================================================
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredPrompt = e;
  const b = document.getElementById('installBanner');
  if (b && !localStorage.getItem('pwa_dismissed')) b.style.display = 'block';
});
function installPWA() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => { deferredPrompt = null; dismissInstall(); });
}
function dismissInstall() {
  localStorage.setItem('pwa_dismissed','1');
  const b = document.getElementById('installBanner');
  if (b) b.style.display = 'none';
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ============================================================
//  SIDEBAR
// ============================================================
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('sb_overlay').classList.toggle('open');}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('sb_overlay').classList.remove('open');}
