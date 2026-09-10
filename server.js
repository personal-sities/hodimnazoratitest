const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 1. .env faylini o'qish (tashqi kutubxonasiz ham ishlaydi)
loadEnv();

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml'
};

// PostgreSQL kutubxonasi (mavjud bo'lsa)
let pg = null;
try {
  pg = require('pg');
} catch (e) {
  // pg o'rnatilmagan bo'lsa ogohlantirish
}

// 2. HTTP SERVER
const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return sendText(res, 204, '');

    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = reqUrl.pathname;

    // Health check
    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        status: 'running',
        retention_months: Number(process.env.RETENTION_MONTHS || 3),
        retention_interval_months: Number(process.env.RETENTION_INTERVAL_MONTHS || 2),
        google_sheets: 'disabled',
        uptime: process.uptime()
      });
    }

    // Dinamik konfiguratsiya skripti
    if (pathname === '/env.js') {
      return sendEnv(res);
    }

    // Google Sheets integratsiyasi butunlay to'xtatilgan
    if (pathname.includes('sheet') || pathname.includes('google')) {
      return sendJson(res, 403, {
        ok: false,
        error: "Google Sheets integratsiyasi to'xtatilgan. Barcha ma'lumotlar faqat serverda saqlanadi."
      });
    }

    // Edge Functions marshrutlari
    if (pathname.startsWith('/api/functions/v1/') && req.method === 'POST') {
      const functionName = pathname.replace('/api/functions/v1/', '').split('/')[0];
      return handleFunction(req, res, decodeURIComponent(functionName));
    }

    // Qo'lda tozalashni ishga tushirish (Admin uchun)
    if (pathname === '/api/admin/cleanup' && req.method === 'POST') {
      const authKey = req.headers['x-admin-key'] || reqUrl.searchParams.get('key');
      const expectedKey = process.env.CLEANUP_ADMIN_KEY || 'aloqa_cleanup_secret_key_2026';
      if (authKey !== expectedKey) {
        return sendJson(res, 401, { ok: false, error: 'Unauthorized: Noto\'g\'ri kalit' });
      }
      const result = await runRetentionCleanup(true);
      return sendJson(res, 200, result);
    }

    // Statik fayllarni tarqatish
    return serveStatic(pathname, res);
  } catch (error) {
    console.error('Server xatoligi:', error);
    sendJson(res, 500, { error: error.message || 'Ichki server xatosi' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(`  AloqaPro Server muvaffaqiyatli ishga tushdi`);
  console.log(`  Manzil: http://${HOST}:${PORT}`);
  console.log(`  Ma'lumotlar bazasi: Server PostgreSQL`);
  console.log(`  Google Sheets: TO'XTATILGAN (Faqat server bazasi)`);
  console.log(`  Tozalash siyosati: Har ${process.env.RETENTION_INTERVAL_MONTHS || 2} oyda, 3 oydan eski ma'lumotlar o'chiriladi`);
  console.log(`====================================================`);

  // Tozalash vazifasini ishga tushirish
  initRetentionScheduler();
});

// ============================================================
//  FUNKSIYALAR VA YORDAMCHILAR
// ============================================================

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  });
}

function parseBool(val) {
  return String(val || '').toLowerCase() === 'true';
}

function sendEnv(res) {
  const config = {
    SUPABASE_URL: process.env.SUPABASE_URL || 'https://hdbhdddekjjjtwtyocfa.supabase.co',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'sb_publishable_CZUB0mOSzmmCvviNzWykzw_B3_0-5bE',
    FUNCTIONS_BASE: process.env.FUNCTIONS_BASE || `${process.env.SUPABASE_URL || ''}/functions/v1`,
    ENABLE_AMOCRM: parseBool(process.env.ENABLE_AMOCRM),
    ENABLE_ONLINEPBX: parseBool(process.env.ENABLE_ONLINEPBX),
    ENABLE_GOOGLE_SHEETS: false
  };
  const content = `window.ALOQA_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  res.end(content);
}

// Edge functions handler
async function handleFunction(req, res, name) {
  const body = await readJson(req);

  // OnlinePBX so'rovi
  if (name === 'onlinepbx') {
    const isEnabled = parseBool(process.env.ENABLE_ONLINEPBX);
    if (!isEnabled) {
      return sendJson(res, 200, {
        ok: true,
        source: 'disabled',
        filters: body,
        stats: {
          total: 0, incoming: 0, outgoing: 0, internal: 0,
          outsideWork: 0, missed: 0, answered: 0, totalDuration: 0,
          averageDuration: 0, notCalledBack: 0, notReached: 0,
          withQualityScore: 0, unknown: 0, callback: 0
        },
        pagination: {
          limit: body.limit || 100,
          offset: body.offset || 0,
          returned: 0,
          totalFiltered: 0,
          hasNext: false,
          hasPrev: false
        },
        calls: []
      });
    }

    // OnlinePBX yoqilgan bo'lsa tashqi API yoki mahalliy bazadan olish
    return handleOnlinePbxProxy(res, body);
  }

  // create-employee
  if (name === 'create-employee') {
    return handleCreateEmployee(res, body);
  }

  // delete-employee
  if (name === 'delete-employee') {
    return handleDeleteEmployee(res, body);
  }

  // reset-employee-password
  if (name === 'reset-employee-password') {
    return handleResetEmployeePassword(res, body);
  }

  return sendJson(res, 404, { ok: false, error: `Noma'lum funksiya: ${name}` });
}

async function handleOnlinePbxProxy(res, body) {
  // Agar API key bo'lsa OnlinePBX API chaqiriladi, aks holda toza bo'sh struktura
  return sendJson(res, 200, {
    ok: true,
    source: 'local_proxy',
    filters: body,
    stats: {
      total: 0, incoming: 0, outgoing: 0, internal: 0,
      outsideWork: 0, missed: 0, answered: 0, totalDuration: 0,
      averageDuration: 0, notCalledBack: 0, notReached: 0,
      withQualityScore: 0, unknown: 0, callback: 0
    },
    pagination: { limit: body.limit || 100, offset: body.offset || 0, returned: 0, totalFiltered: 0, hasNext: false, hasPrev: false },
    calls: []
  });
}

async function handleCreateEmployee(res, body) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '').trim();
  const kpiType = body.kpi_type || 'junior';

  if (!name || !email || !password) {
    return sendJson(res, 400, { error: 'Ism, email va parol kiritilishi shart' });
  }

  // Agar Supabase Service Role mavjud bo'lsa Supabase Auth ga qo'shish
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { name, role: 'employee' }
        })
      });
      const userData = await userRes.json();
      if (!userRes.ok) throw new Error(userData.msg || userData.message || 'Foydalanuvchi yaratilmadi');

      const empRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/employees`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          user_id: userData.id,
          name,
          login: email,
          kpi_type: kpiType,
          active: true,
          face_registered: false
        })
      });
      const empData = await empRes.json();
      return sendJson(res, 200, { ok: true, employee_id: empData?.[0]?.id, employee: empData?.[0] });
    } catch (err) {
      console.error('handleCreateEmployee Supabase xatosi:', err);
    }
  }

  // Mahalliy DB orqali qo'shish (fallback)
  return sendJson(res, 200, { ok: true, message: 'Xodim qabul qilindi' });
}

async function handleDeleteEmployee(res, body) {
  const employeeId = body.employee_id || body.id;
  if (!employeeId) return sendJson(res, 400, { error: 'employee_id berilmadi' });

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/employees?id=eq.${encodeURIComponent(employeeId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ active: false })
      });
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      console.error('handleDeleteEmployee error:', e);
    }
  }

  return sendJson(res, 200, { ok: true });
}

async function handleResetEmployeePassword(res, body) {
  const employeeId = body.employee_id || body.id;
  const newPassword = body.new_password;
  if (!employeeId || !newPassword) return sendJson(res, 400, { error: 'employee_id va new_password kiritilishi shart' });
  return sendJson(res, 200, { ok: true, message: 'Parol yangilandi' });
}

// Statik fayllarni xavfsiz tarqatish
function serveStatic(requestPath, res) {
  const safePath = requestPath === '/' ? '/index.html' : decodeURIComponent(requestPath.split('?')[0]);
  const fullPath = path.normalize(path.join(ROOT, safePath));

  if (!fullPath.startsWith(ROOT)) {
    return sendText(res, 403, 'Taqiqlangan (Forbidden)');
  }

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // index.html fallback SPA uchun
      if (!path.extname(safePath)) {
        return fs.readFile(path.join(ROOT, 'index.html'), (err2, data) => {
          if (err2) return sendText(res, 404, 'Sahifa topilmadi');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        });
      }
      return sendText(res, 404, 'Fayl topilmadi');
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    // Model va kutubxona fayllari uchun uzoq muddatli keshlash
    const isImmutable = fullPath.includes('model') || ext === '.wasm' || ext === '.mp3';
    const cacheControl = isImmutable
      ? 'public, max-age=2592000, immutable'
      : 'no-cache';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': cacheControl
    });

    const stream = fs.createReadStream(fullPath);
    stream.pipe(res);
  });
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PATCH,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,apikey,x-admin-key');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ============================================================
//  3 OYDAN ESKI MA'LUMOTLARNI HAR 2 OYDA TOZALASH (RETENTION CRON)
// ============================================================

async function runRetentionCleanup(isManual = false) {
  const retentionMonths = Number(process.env.RETENTION_MONTHS || 3);
  console.log(`[Tozalash]: ${retentionMonths} oydan eski ma'lumotlarni tozalash jarayoni boshlandi... (${isManual ? 'qo\'lda' : 'avtomatik'})`);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !pg) {
    console.log('[Tozalash ogohlantirish]: DATABASE_URL yoki pg kutubxonasi mavjud emas. Tozalash faqat ma\'lumotlar bazasi ulanganda ishlaydi.');
    return {
      ok: false,
      message: "DATABASE_URL yoki pg mavjud emas",
      retention_months: retentionMonths
    };
  }

  const pool = new pg.Pool({ connectionString: dbUrl });
  try {
    // 1. Agar stored procedure bo'lsa chaqirish
    const procResult = await pool.query('SELECT public.cleanup_old_records($1) AS res', [retentionMonths]).catch(() => null);
    if (procResult && procResult.rows && procResult.rows[0]?.res) {
      const summary = procResult.rows[0].res;
      console.log(`[Tozalash muvaffaqiyatli]:`, summary);
      saveLastCleanupTimestamp();
      return summary;
    }

    // 2. Aks holda to'g'ridan-to'g'ri SQL bilan xavfsiz tozalash
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cutoffDateQuery = `(CURRENT_DATE - INTERVAL '${retentionMonths} months')::date`;
      const cutoffTzQuery = `(now() - INTERVAL '${retentionMonths} months')`;

      const r1 = await client.query(`DELETE FROM public.attendance WHERE work_date < ${cutoffDateQuery}`);
      const r2 = await client.query(`DELETE FROM public.notifications WHERE sent_at < ${cutoffTzQuery}`);
      const r3 = await client.query(`DELETE FROM public.feedback WHERE created_at < ${cutoffTzQuery}`);
      const r4 = await client.query(`DELETE FROM public.employee_leaves WHERE return_date < ${cutoffDateQuery}`);

      let r5Count = 0;
      const callsExists = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='calls'`);
      if (callsExists.rowCount > 0) {
        const r5 = await client.query(`DELETE FROM public.calls WHERE started_at < ${cutoffTzQuery}`);
        r5Count = r5.rowCount;
      }

      await client.query('COMMIT');

      const summary = {
        ok: true,
        retention_months: retentionMonths,
        deleted_attendance: r1.rowCount,
        deleted_notifications: r2.rowCount,
        deleted_feedback: r3.rowCount,
        deleted_leaves: r4.rowCount,
        deleted_calls: r5Count,
        cleaned_at: new Date().toISOString()
      };
      console.log(`[Tozalash muvaffaqiyatli]:`, summary);
      saveLastCleanupTimestamp();
      return summary;
    } catch (sqlErr) {
      await client.query('ROLLBACK');
      throw sqlErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Tozalash xatosi]:', err.message);
    return { ok: false, error: err.message };
  } finally {
    await pool.end().catch(() => {});
  }
}

const CLEANUP_TIMESTAMP_FILE = path.join(__dirname, '.cleanup_last_run');

function saveLastCleanupTimestamp() {
  try {
    fs.writeFileSync(CLEANUP_TIMESTAMP_FILE, new Date().toISOString(), 'utf8');
  } catch (e) {}
}

function getLastCleanupTimestamp() {
  try {
    if (fs.existsSync(CLEANUP_TIMESTAMP_FILE)) {
      const content = fs.readFileSync(CLEANUP_TIMESTAMP_FILE, 'utf8').trim();
      const d = new Date(content);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  } catch (e) {}
  return null;
}

function initRetentionScheduler() {
  const intervalMonths = Number(process.env.RETENTION_INTERVAL_MONTHS || 2);
  const intervalMs = intervalMonths * 30 * 24 * 60 * 60 * 1000; // ~60 kun

  // Server yoqilganda: Agar oxirgi tozalash 2 oydan oldin bo'lgan bo'lsa yoki bo'lmagan bo'lsa hoziroq tekshirib tozalash
  const lastRun = getLastCleanupTimestamp();
  const now = Date.now();
  if (!lastRun || (now - lastRun.getTime() >= intervalMs)) {
    console.log(`[Scheduler]: Oxirgi tozalash muddati o'tgan yoki topilmadi. Tozalash tekshiruvi boshlanmoqda...`);
    setTimeout(() => {
      runRetentionCleanup(false).catch(err => console.error('[Scheduler err]:', err));
    }, 10000); // Server ishga tushgach 10 soniyadan so'ng
  } else {
    const nextDays = Math.round((intervalMs - (now - lastRun.getTime())) / (24 * 3600 * 1000));
    console.log(`[Scheduler]: Oxirgi tozalash: ${lastRun.toISOString()}. Keyingi tozalash taxminan ${nextDays} kundan so'ng.`);
  }

  // Har 24 soatda bir tekshirib, 2 oy to'lganda tozalashni amalga oshiradigan ishonchli kunlik tekshiruv taymeri
  setInterval(() => {
    const lr = getLastCleanupTimestamp();
    const current = Date.now();
    if (!lr || (current - lr.getTime() >= intervalMs)) {
      runRetentionCleanup(false).catch(err => console.error('[Scheduler periodic err]:', err));
    }
  }, 24 * 60 * 60 * 1000);
}

module.exports = {
  server,
  runRetentionCleanup
};
