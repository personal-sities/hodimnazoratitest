// AloqaPro dinamik muhit konfiguratsiyasi
// Barcha ma'lumotlar serverdagi PostgreSQL va lokal API orqali ishlaydi.
window.ALOQA_CONFIG = window.ALOQA_CONFIG || {
  DATABASE_TYPE: 'postgresql',
  API_BASE: '/api',
  FUNCTIONS_BASE: '/api/functions/v1',
  ENABLE_GOOGLE_SHEETS: false
};

window.resolveApiUrl = function(endpoint) {
  if (!endpoint) return '';
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) return endpoint;
  const clean = endpoint.startsWith('/') ? endpoint : ('/' + endpoint);
  const serverBase = (typeof window !== 'undefined' && window.ALOQA_SERVER_URL) ||
                     (window.ALOQA_CONFIG && window.ALOQA_CONFIG.SERVER_URL) ||
                     (typeof localStorage !== 'undefined' ? localStorage.getItem('aloqa_server_url') : null);
  if (serverBase) {
    return serverBase.replace(/\/+$/, '') + clean;
  }
  const loc = (typeof window !== 'undefined') ? window.location : null;
  if (!loc || loc.protocol === 'file:' || (loc.port && loc.port !== '3000' && (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1'))) {
    return 'http://localhost:3000' + clean;
  }
  return clean;
};
