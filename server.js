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
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json'
};

// PostgreSQL kutubxonasi (mavjud bo'lsa)
let pg = null;
try {
  pg = require('pg');
} catch (e) {
  // pg o'rnatilmagan bo'lsa ogohlantirishsiz o'tadi
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
        has_database: Boolean(process.env.DATABASE_URL && pg),
        has_supabase: Boolean(process.env.SUPABASE_URL),
        uptime: Math.floor(process.uptime())
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

// Faqat to'g'ridan-to'g'ri ishga tushirilganda listen qilish
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`====================================================`);
    console.log(`  AloqaPro Server muvaffaqiyatli ishga tushdi`);
    console.log(`  Manzil: http://${HOST}:${PORT}`);
    console.log(`  Ma'lumotlar bazasi: ${process.env.DATABASE_URL ? 'PostgreSQL ulandi' : 'Supabase Cloud / Standart'}`);
    console.log(`  Google Sheets: TO'XTATILGAN (Faqat xavfsiz baza)`);
    console.log(`  Tozalash siyosati: Har ${process.env.RETENTION_INTERVAL_MONTHS || 2} oyda, 3 oydan eski ma'lumotlar o'chiriladi`);
    console.log(`====================================================`);

    // Tozalash vazifasini ishga tushirish
    initRetentionScheduler();
  });

  // Toza to'xtatish (graceful shutdown)
  const shutdown = () => {
    console.log('\n[AloqaPro]: Server to\'xtatilmoqda...');
    server.close(() => {
      console.log('[AloqaPro]: Server to\'xtatildi.');
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

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
    FUNCTIONS_BASE: process.env.FUNCTIONS_BASE || '/api/functions/v1',
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

async function handleCreateEmployee(res, body) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '').trim();
  const kpiType = body.kpi_type || 'operator';

  if (!name || !email || !password) {
    return sendJson(res, 400, { ok: false, error: 'Ism, email va parol kiritilishi shart' });
  }

  // 1. Supabase Service Role mavjud bo'lsa Supabase Auth ga qo'shish
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
      if (!userRes.ok) {
        throw new Error(userData.msg || userData.message || userData.error_description || 'Foydalanuvchi yaratilmadi');
      }

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
      if (!empRes.ok) {
        throw new Error(empData.message || empData.msg || 'Xodim ma\'lumotlar bazasiga yozilmadi');
      }

      return sendJson(res, 200, { ok: true, employee_id: empData?.[0]?.id, employee: empData?.[0] });
    } catch (err) {
      console.error('handleCreateEmployee Supabase xatosi:', err);
      return sendJson(res, 400, { ok: false, error: err.message || 'Xodimni yaratishda xatolik yuz berdi' });
    }
  }

  // 2. Mahalliy PostgreSQL mavjud bo'lsa
  if (process.env.DATABASE_URL && pg) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const query = `
        INSERT INTO public.employees (user_id, name, login, kpi_type, active, face_registered)
        VALUES (gen_random_uuid(), $1, $2, $3, true, false)
        RETURNING id, name, login, kpi_type;
      `;
      const result = await pool.query(query, [name, email, kpiType]);
      await pool.end();
      return sendJson(res, 200, { ok: true, employee_id: result.rows[0]?.id, employee: result.rows[0] });
    } catch (dbErr) {
      await pool.end().catch(() => {});
      console.error('handleCreateEmployee DB xatosi:', dbErr);
      return sendJson(res, 400, { ok: false, error: dbErr.message });
    }
  }

  return sendJson(res, 400, { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY yoki DATABASE_URL sozlanmagan" });
}

async function handleDeleteEmployee(res, body) {
  const employeeId = body.employee_id || body.id;
  if (!employeeId) return sendJson(res, 400, { ok: false, error: 'employee_id berilmadi' });

  let handled = false;

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const delRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/employees?id=eq.${encodeURIComponent(employeeId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ active: false })
      });
      if (!delRes.ok) {
        const txt = await delRes.text();
        throw new Error(txt || 'Xodimni o\'chirishda xatolik');
      }
      handled = true;
    } catch (e) {
      console.error('handleDeleteEmployee error:', e);
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  if (process.env.DATABASE_URL && pg && !handled) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query('UPDATE public.employees SET active = false WHERE id = $1', [employeeId]);
      await pool.end();
      handled = true;
    } catch (dbErr) {
      await pool.end().catch(() => {});
      return sendJson(res, 500, { ok: false, error: dbErr.message });
    }
  }

  return sendJson(res, 200, { ok: true });
}

async function handleResetEmployeePassword(res, body) {
  const employeeId = body.employee_id || body.id;
  const newPassword = body.new_password;
  if (!employeeId || !newPassword) {
    return sendJson(res, 400, { ok: false, error: 'employee_id va new_password kiritilishi shart' });
  }

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      // 1. Employee ning user_id sini topish
      const empRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/employees?id=eq.${encodeURIComponent(employeeId)}&select=user_id`, {
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      });
      const emps = await empRes.json();
      const userId = emps?.[0]?.user_id;
      if (!userId) {
        return sendJson(res, 404, { ok: false, error: 'Xodim yoki uning auth user_id si topilmadi' });
      }

      // 2. Supabase Auth da parolni yangilash
      const passRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ password: newPassword })
      });
      const passData = await passRes.json();
      if (!passRes.ok) {
        throw new Error(passData.msg || passData.message || 'Parolni yangilab bo\'lmadi');
      }

      return sendJson(res, 200, { ok: true, message: 'Parol muvaffaqiyatli yangilandi' });
    } catch (err) {
      console.error('handleResetEmployeePassword error:', err);
      return sendJson(res, 500, { ok: false, error: err.message || 'Parolni yangilashda xatolik' });
    }
  }

  return sendJson(res, 400, { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY sozlanmagan' });
}

// Himoyalangan ichki fayllar ro'yxati (hech qachon brauzerga berilmaydi)
const PROTECTED_FILES = new Set([
  '.env',
  '.env.example',
  '.env.local',
  '.gitignore',
  '.dockerignore',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'server.js',
  'package.json',
  'package-lock.json',
  'schema.sql',
  'migrate-from-supabase.js',
  'export-supabase-data.js',
  'ubuntu_deploy.md',
  'readme.md',
  '.cleanup_last_run'
]);

// Statik fayllarni xavfsiz tarqatish
function serveStatic(requestPath, res) {
  const cleanPath = decodeURIComponent(requestPath.split('?')[0]);
  const safePath = cleanPath === '/' ? '/index.html' : cleanPath;

  // 1. Xavfsizlik: Nuqta bilan boshlanuvchi yashirin fayl va papkalarni taqiqlash (.env, .git, va h.k.)
  if (/(?:^|\/)\.[^\/]/.test(safePath)) {
    return sendText(res, 403, 'Taqiqlangan (Forbidden)');
  }

  // 2. Xavfsizlik: Path traversal hujumlarini bartaraf etish
  const fullPath = path.resolve(ROOT, '.' + safePath);
  if (!fullPath.startsWith(ROOT + path.sep) && fullPath !== ROOT) {
    return sendText(res, 403, 'Taqiqlangan (Forbidden)');
  }

  // 3. Xavfsizlik: Server kodlari, konfiguratsiyalar va ma'lumotlar bazasi fayllarini yashirish
  const baseName = path.basename(fullPath).toLowerCase();
  const relPath = path.relative(ROOT, fullPath).replace(/\\/g, '/').toLowerCase();
  if (
    PROTECTED_FILES.has(baseName) ||
    baseName.endsWith('.sql') ||
    relPath.startsWith('data/') ||
    relPath.startsWith('.git/') ||
    relPath.startsWith('.vscode/')
  ) {
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

    // Model va og'ir kutubxona fayllari uchun uzoq muddatli keshlash
    const isImmutable = fullPath.includes('model') || ext === '.wasm' || ext === '.bin';
    const cacheControl = isImmutable
      ? 'public, max-age=2592000, immutable'
      : 'no-cache';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': cacheControl
    });

    const stream = fs.createReadStream(fullPath);
    stream.on('error', (streamErr) => {
      console.error('Stream xatosi:', streamErr.message);
      if (!res.headersSent) sendText(res, 500, 'Faylni o\'qishda xatolik');
    });
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

  // 1-USUL: PostgreSQL bazasi to'g'ridan-to'g'ri ulangan bo'lsa
  if (dbUrl && pg) {
    const pool = new pg.Pool({ connectionString: dbUrl });
    try {
      // 1. Stored procedure cleanup_old_records orqali tozalash
      const procResult = await pool.query('SELECT public.cleanup_old_records($1) AS res', [retentionMonths]).catch(() => null);
      if (procResult && procResult.rows && procResult.rows[0]?.res) {
        const summary = procResult.rows[0].res;
        console.log(`[Tozalash muvaffaqiyatli]:`, summary);
        saveLastCleanupTimestamp();
        return summary;
      }

      // 2. Aks holda SQL so'rovlari orqali xavfsiz tozalash
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
          method: 'postgresql_direct',
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
      console.error('[Tozalash xatosi - PostgreSQL]:', err.message);
      return { ok: false, error: err.message };
    } finally {
      await pool.end().catch(() => {});
    }
  }

  // 2-USUL: Supabase REST API orqali tozalash (agar DATABASE_URL yo'q, lekin Supabase service kaliti bo'lsa)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      console.log('[Tozalash]: Supabase REST API orqali eski ma\'lumotlar tozalanmoqda...');
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
      const cutoffIso = cutoffDate.toISOString();

      const headers = {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'count=exact'
      };

      const [r1, r2, r3, r4] = await Promise.all([
        fetch(`${process.env.SUPABASE_URL}/rest/v1/attendance?work_date=lt.${cutoffDateStr}`, { method: 'DELETE', headers }),
        fetch(`${process.env.SUPABASE_URL}/rest/v1/notifications?sent_at=lt.${cutoffIso}`, { method: 'DELETE', headers }),
        fetch(`${process.env.SUPABASE_URL}/rest/v1/feedback?created_at=lt.${cutoffIso}`, { method: 'DELETE', headers }),
        fetch(`${process.env.SUPABASE_URL}/rest/v1/employee_leaves?return_date=lt.${cutoffDateStr}`, { method: 'DELETE', headers })
      ]);

      const summary = {
        ok: true,
        method: 'supabase_rest',
        retention_months: retentionMonths,
        cutoff_date: cutoffDateStr,
        attendance_status: r1.status,
        notifications_status: r2.status,
        feedback_status: r3.status,
        leaves_status: r4.status,
        cleaned_at: new Date().toISOString()
      };
      console.log(`[Tozalash muvaffaqiyatli - Supabase REST]:`, summary);
      saveLastCleanupTimestamp();
      return summary;
    } catch (restErr) {
      console.error('[Tozalash xatosi - Supabase REST]:', restErr.message);
      return { ok: false, error: restErr.message };
    }
  }

  console.log('[Tozalash ogohlantirish]: DATABASE_URL yoki SUPABASE_SERVICE_ROLE_KEY mavjud emas. Tozalash uchun ulardan birini sozlang.');
  return {
    ok: false,
    message: "DATABASE_URL yoki SUPABASE_SERVICE_ROLE_KEY mavjud emas",
    retention_months: retentionMonths
  };
}

const CLEANUP_TIMESTAMP_FILE = path.join(__dirname, '.cleanup_last_run');

function saveLastCleanupTimestamp() {
  try {
    // Agar docker bind-mount sababli katalog bo'lib qolgan bo'lsa ichiga yozish
    if (fs.existsSync(CLEANUP_TIMESTAMP_FILE) && fs.statSync(CLEANUP_TIMESTAMP_FILE).isDirectory()) {
      fs.writeFileSync(path.join(CLEANUP_TIMESTAMP_FILE, 'timestamp'), new Date().toISOString(), 'utf8');
    } else {
      fs.writeFileSync(CLEANUP_TIMESTAMP_FILE, new Date().toISOString(), 'utf8');
    }
  } catch (e) {
    console.warn('[saveLastCleanupTimestamp]:', e.message);
  }
}

function getLastCleanupTimestamp() {
  try {
    if (fs.existsSync(CLEANUP_TIMESTAMP_FILE)) {
      const isDir = fs.statSync(CLEANUP_TIMESTAMP_FILE).isDirectory();
      const targetFile = isDir ? path.join(CLEANUP_TIMESTAMP_FILE, 'timestamp') : CLEANUP_TIMESTAMP_FILE;
      if (fs.existsSync(targetFile)) {
        const content = fs.readFileSync(targetFile, 'utf8').trim();
        const d = new Date(content);
        return Number.isNaN(d.getTime()) ? null : d;
      }
    }
  } catch (e) {}
  return null;
}

function initRetentionScheduler() {
  const intervalMonths = Number(process.env.RETENTION_INTERVAL_MONTHS || 2);
  const intervalMs = intervalMonths * 30 * 24 * 60 * 60 * 1000; // ~60 kun

  // Server yoqilganda: Agar oxirgi tozalash 2 oydan oldin bo'lgan bo'lsa yoki bo'lmagan bo'lsa tekshirish
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

  // Har 24 soatda bir tekshirib turadigan kunlik tekshiruv taymeri
  const dailyTimer = setInterval(() => {
    const lr = getLastCleanupTimestamp();
    const current = Date.now();
    if (!lr || (current - lr.getTime() >= intervalMs)) {
      runRetentionCleanup(false).catch(err => console.error('[Scheduler periodic err]:', err));
    }
  }, 24 * 60 * 60 * 1000);

  if (dailyTimer && typeof dailyTimer.unref === 'function') {
    dailyTimer.unref();
  }
}

module.exports = {
  server,
  runRetentionCleanup
};
