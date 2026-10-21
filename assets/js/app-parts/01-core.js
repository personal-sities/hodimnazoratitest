// ============================================================
//  CONFIG (Lokal PostgreSQL va Server API)
// ============================================================
const _cfg = window.ALOQA_CONFIG || {};
const FUNCTIONS_BASE = _cfg.FUNCTIONS_BASE || '/api/functions/v1';
const sb = window.supabase ? window.supabase.createClient() : null;

// ============================================================
//  SERVER API HELPER (Serverdagi ma'lumotlar bazasi bilan tezkor ishlash)
// ============================================================
function resolveApiUrl(endpoint) {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) return endpoint;
  const clean = endpoint.startsWith('/') ? endpoint : ('/' + endpoint);
  const serverBase = window.ALOQA_SERVER_URL || (window.ALOQA_CONFIG && window.ALOQA_CONFIG.SERVER_URL) || localStorage.getItem('aloqa_server_url');
  if (serverBase) {
    return serverBase.replace(/\/+$/, '') + clean;
  }
  const loc = window.location;
  if (!loc || loc.protocol === 'file:' || (loc.port && loc.port !== '3000' && (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1'))) {
    return 'http://localhost:3000' + clean;
  }
  return clean;
}

async function serverApi(endpoint, options = {}) {
  try {
    let url = resolveApiUrl(endpoint);
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), options.timeoutMs || 8000);
    let res = null;
    try {
      res = await fetch(url, {
        ...options,
        headers,
        signal: ctrl.signal
      });
    } catch (fetchErr) {
      if (!endpoint.startsWith('http')) {
        const altUrl = url.startsWith('http://localhost:3000')
          ? (endpoint.startsWith('/') ? endpoint : '/' + endpoint)
          : ('http://localhost:3000' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint));
        if (altUrl !== url) {
          try {
            res = await fetch(altUrl, { ...options, headers, signal: ctrl.signal });
          } catch (_) {}
        }
      }
      if (!res) throw fetchErr;
    }
    clearTimeout(timeout);
    if (!res.ok) {
      let errTxt = await res.text().catch(() => '');
      try {
        const parsed = JSON.parse(errTxt);
        if (parsed && parsed.error) errTxt = parsed.error;
      } catch (_) {}
      return { ok: false, status: res.status, error: errTxt };
    }
    const json = await res.json().catch(() => ({}));
    return { ok: true, ...json };
  } catch (err) {
    return { ok: false, error: err.message || 'Serverga ulanish xatosi' };
  }
}

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
const AUTO_END_MIN        = 30;
const AUTO_END_TASK_WARNING_INTERVAL_MS = 5 * 60 * 1000;
const LATE_AFTER_MINUTES  = WORKDAY_START_MINUTES;
const HALF_DAY_START_MINUTES = 11 * 60;
const HALF_DAY_END_MINUTES   = 15 * 60;
const TARGET_WORK_SEC_PER_DAY = (WORKDAY_END_MINUTES - WORKDAY_START_MINUTES) * 60;
const NOTIF_POLL_INTERVAL = 30000;
const REALTIME_SCHEMA = 'public';
const ABSENCE_START_KEY = 'aloqa_absence_start_date';

// ============================================================
//  THEME
// ============================================================
let currentTheme = localStorage.getItem('aloqa_theme') || 'light';
function applyTheme(th) {
  document.documentElement.setAttribute('data-theme', th);
  ['themeToggle','themeToggle2','themeToggle3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = th === 'light';
  });
  localStorage.setItem('aloqa_theme', th);
  currentTheme = th;
}
function toggleTheme() {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  ['themeToggle','themeToggle2','themeToggle3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = currentTheme === 'light';
  });
}
applyTheme(currentTheme);

// ============================================================
//  TOAST
// ============================================================
function toast(type, title, msg, duration = 3500) {
  const iconMap = { success:'check-circle-2', error:'alert-circle', warn:'alert-triangle', info:'info' };
  const iconHtml = typeof getLucideIcon === 'function'
    ? getLucideIcon(iconMap[type] || 'info', 'toast-icon-svg', 18)
    : (type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warn' ? '!' : 'i');
  const c = document.getElementById('toast-container');
  if (!c) return;
  const d = document.createElement('div');
  d.className = `toast ${type}`;
  d.innerHTML = `<span class="toast-icon">${iconHtml}</span><div class="toast-body"><div class="toast-title">${title}</div><div class="toast-msg">${msg||''}</div></div>`;
  c.appendChild(d);
  setTimeout(() => {
    d.classList.add('removing');
    setTimeout(() => d.remove(), 320);
  }, duration);
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

