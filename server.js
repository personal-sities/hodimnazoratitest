const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Server to'xtab qolmasligi uchun barcha kutilmagan xatolarni ushlab qolish (Crash-Proof)
process.on('uncaughtException', (err) => {
  console.warn('[Ogohlantirish: Uncaught Exception ushlandi]:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[Ogohlantirish: Unhandled Rejection ushlandi]:', reason?.message || reason);
});

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

let sharedPool = null;
let dbConnectionLogged = false;

function getDbPool() {
  if (!sharedPool && process.env.DATABASE_URL && pg) {
    try {
      sharedPool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: 15,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 3000
      });
      sharedPool.on('error', (err) => {
        console.error('[PostgreSQL Pool xatosi]:', err.message);
      });
      sharedPool.query('SELECT 1').then(() => {
        if (!dbConnectionLogged) {
          console.log('[PostgreSQL]: Ma\'lumotlar bazasiga muvaffaqiyatli ulandi.');
          dbConnectionLogged = true;
        }
      }).catch((err) => {
        if (!dbConnectionLogged) {
          console.warn('[PostgreSQL]: Bazasiga ulanish kutilmoqda (' + err.message + '). Barcha amallar lokal data/ omborida xavfsiz bajariladi.');
          dbConnectionLogged = true;
        }
      });
    } catch (e) {
      console.error('[getDbPool]:', e.message);
    }
  }
  return sharedPool;
}

async function ensureDatabaseSchema() {
  // 1. data/ papkasi va admins.json borligini kafolatlash
  try {
    const dataDir = path.join(ROOT, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const adminsPath = path.join(dataDir, 'admins.json');
    let currentAdmins = [];
    if (fs.existsSync(adminsPath)) {
      try { currentAdmins = JSON.parse(fs.readFileSync(adminsPath, 'utf8')) || []; } catch (_) { }
    }
    const hasAdminRoot = currentAdmins.some(a => String(a.login || '').toLowerCase() === 'admin@aloqapro.uz');
    const hasAdminSimple = currentAdmins.some(a => String(a.login || '').toLowerCase() === 'admin');
    let changed = false;
    if (!hasAdminRoot) {
      currentAdmins.push({
        id: 'admin_root',
        user_id: 'admin_root',
        name: 'Administrator',
        login: 'admin@aloqapro.uz',
        role: 'admin'
      });
      changed = true;
    }
    if (!hasAdminSimple) {
      currentAdmins.push({
        id: 'admin_simple',
        user_id: 'admin_simple',
        name: 'Administrator',
        login: 'admin',
        role: 'admin'
      });
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(adminsPath, JSON.stringify(currentAdmins, null, 2), 'utf8');
      console.log('[System]: data/admins.json avtomatik tayyorlandi (admin va admin@aloqapro.uz).');
    }
  } catch (err) {
    console.warn('[ensureDatabaseSchema] admins.json yaratishda ogohlantirish:', err.message);
  }

  const pool = getDbPool();
  if (!pool) return;
  try {
    const schemaFile = path.join(ROOT, 'schema.sql');
    if (fs.existsSync(schemaFile)) {
      const schemaSql = fs.readFileSync(schemaFile, 'utf8');
      await pool.query(schemaSql);
      console.log('[PostgreSQL]: schema.sql bo\'yicha barcha jadvallar va funksiyalar faollashtirildi.');
    }

    await pool.query(`
      ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS password TEXT;
      ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS password TEXT;
      ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS employee_name TEXT;
      CREATE INDEX IF NOT EXISTS idx_calls_caller ON public.calls(caller);
      CREATE INDEX IF NOT EXISTS idx_calls_callee ON public.calls(callee);
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM public.admins WHERE LOWER(login) = 'admin@aloqapro.uz') THEN
          INSERT INTO public.admins (id, user_id, name, login, active)
          VALUES (gen_random_uuid(), gen_random_uuid(), 'Administrator', 'admin@aloqapro.uz', true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.admins WHERE LOWER(login) = 'admin') THEN
          INSERT INTO public.admins (id, user_id, name, login, active)
          VALUES (gen_random_uuid(), gen_random_uuid(), 'Administrator', 'admin', true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.admins WHERE LOWER(login) = 'umirbekovdiyorbek@gmail.com') THEN
          INSERT INTO public.admins (id, user_id, name, login, active)
          VALUES (gen_random_uuid(), gen_random_uuid(), 'Administrator (Diyorbek)', 'umirbekovdiyorbek@gmail.com', true);
        END IF;
      END $$;

      -- 1. Inactive (ishdan ketgan) xodimlardan operator raqamlarini tozalash
      UPDATE public.employees
      SET operator_number = NULL, pbx_extension = NULL
      WHERE active = false AND (operator_number IS NOT NULL OR pbx_extension IS NOT NULL);

      -- 2. Agar bitta operator raqamiga bir nechta active xodim birikib qolsa, faqat oxirgisida qoldirish
      UPDATE public.employees e1
      SET operator_number = NULL, pbx_extension = NULL
      WHERE active = true
        AND operator_number IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.employees e2
          WHERE e2.active = true
            AND (e2.operator_number = e1.operator_number OR e2.pbx_extension = e1.operator_number)
            AND e2.id <> e1.id
            AND (COALESCE(e2.updated_at, e2.created_at) > COALESCE(e1.updated_at, e1.created_at))
        );

      -- 3. Mavjud dublikat xabar/fikrlarni tozalash (bir xil xodim, bir xil matn, 30 soniya ichida)
      DELETE FROM public.feedback f1
      USING public.feedback f2
      WHERE f1.employee_id = f2.employee_id
        AND f1.message = f2.message
        AND f1.id <> f2.id
        AND (
          f1.created_at > f2.created_at
          OR (f1.created_at = f2.created_at AND f1.id > f2.id)
        )
        AND ABS(EXTRACT(EPOCH FROM (f1.created_at - f2.created_at))) < 30;

      -- 4. Mavjud dublikat bildirishnomalarni tozalash
      DELETE FROM public.notifications n1
      USING public.notifications n2
      WHERE n1.employee_id = n2.employee_id
        AND n1.title = n2.title
        AND n1.body = n2.body
        AND n1.id <> n2.id
        AND (
          n1.sent_at > n2.sent_at
          OR (n1.sent_at = n2.sent_at AND n1.id > n2.id)
        )
        AND ABS(EXTRACT(EPOCH FROM (n1.sent_at - n2.sent_at))) < 30;
    `);
    console.log('[Database]: PostgreSQL sxemasi va administratorlar to\'liq tayyor.');

    // Lokal JSON dagi dublikatlarni tozalash
    try {
      const fbList = readJsonData('feedback.json', []);
      const uniqueFb = [];
      const seenFb = new Set();
      fbList.forEach(item => {
        const key = `${item.employee_id || ''}_${item.message || ''}_${String(item.created_at || '').substring(0, 16)}`;
        if (!seenFb.has(key)) {
          seenFb.add(key);
          uniqueFb.push(item);
        }
      });
      if (uniqueFb.length !== fbList.length) writeJsonData('feedback.json', uniqueFb);

      const notifList = readJsonData('notifications.json', []);
      const uniqueNotif = [];
      const seenNotif = new Set();
      notifList.forEach(item => {
        const key = `${item.employee_id || ''}_${item.title || ''}_${item.body || ''}_${String(item.sent_at || '').substring(0, 16)}`;
        if (!seenNotif.has(key)) {
          seenNotif.add(key);
          uniqueNotif.push(item);
        }
      });
      if (uniqueNotif.length !== notifList.length) writeJsonData('notifications.json', uniqueNotif);
    } catch (_) {}

    await relinkAllPbxCalls().catch((e) => {
      console.warn('[ensureDatabaseSchema relinkAllPbxCalls ogohlantirish]:', e.message);
    });
  } catch (err) {
    console.warn('[Database]: Schema tekshirishda ogohlantirish:', err.message);
  }
}

// 2. HTTP SERVER
const server = http.createServer(async (req, res) => {
  req.on('error', () => { });
  res.on('error', () => { });
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
        database: 'postgresql',
        has_database: Boolean(process.env.DATABASE_URL && pg),
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

    // OnlinePBX Webhook (POST & GET, JSON & x-www-form-urlencoded)
    if (
      pathname === '/api/onlinepbx/webhook' ||
      pathname === '/webhook/onlinepbx' ||
      pathname === '/api/functions/v1/onlinepbx-webhook'
    ) {
      return handleOnlinePbxWebhook(req, res, reqUrl);
    }

    // OnlinePBX Statistikalar API
    if (pathname === '/api/pbx/stats' && req.method === 'GET') {
      return handlePbxStats(req, res, reqUrl);
    }

    // OnlinePBX Qo'ng'iroqlar jurnali API
    if (pathname === '/api/pbx/calls' && req.method === 'GET') {
      return handlePbxCalls(req, res, reqUrl);
    }

    // OnlinePBX Test / Sinov API
    if (pathname === '/api/onlinepbx/test' && req.method === 'POST') {
      return handleTestPbxWebhook(req, res);
    }

    // OnlinePBX Qo'ng'iroqlarni xodimlarga qayta biriktirish (Relink) API
    if ((pathname === '/api/pbx/relink' || pathname === '/api/onlinepbx/relink') && req.method === 'POST') {
      return handlePbxRelink(req, res);
    }

    // OnlinePBX Qo'ng'iroqqa baho qo'yish API
    if ((pathname === '/api/pbx/rate-call' || pathname === '/api/pbx/rate') && (req.method === 'POST' || req.method === 'PATCH')) {
      return handleRatePbxCall(req, res);
    }
    if (pathname.startsWith('/api/pbx/calls/') && req.method === 'PATCH') {
      const callId = pathname.replace('/api/pbx/calls/', '').trim();
      return handleRatePbxCall(req, res, callId);
    }

    // Namoz vaqtlari API (Rasmiy ishonchli manbalardan)
    if (pathname === '/api/prayer-times' && req.method === 'GET') {
      return handlePrayerTimes(req, res, reqUrl);
    }

    // Edge Functions marshrutlari
    if (pathname.startsWith('/api/functions/v1/') && req.method === 'POST') {
      const functionName = pathname.replace('/api/functions/v1/', '').split('/')[0];
      return handleFunction(req, res, decodeURIComponent(functionName));
    }

    // ============================================================
    //  ALOQAPRO ASOSIY SERVER API MARSHRUTLARI (TO'G'RIDAN-TO'G'RI SERVER BAZASI)
    // ============================================================

    // Database Table API (PostgreSQL direct / lokal zaxira)
    if (pathname.startsWith('/api/db/')) {
      const table = pathname.replace('/api/db/', '').split('/')[0].trim();
      return handleDatabaseTableApi(req, res, table, reqUrl);
    }

    // Database RPC API (PostgreSQL funksiyalari / lokal hisoblash)
    if (pathname.startsWith('/api/rpc/')) {
      const func = pathname.replace('/api/rpc/', '').split('/')[0].trim();
      return handleDatabaseRpcApi(req, res, func);
    }

    // 1. Auth Login API (Server orqali tezkor kirish)
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      return handleApiLogin(req, res);
    }

    // 2. Attendance API (Davomat olish va saqlash)
    if (pathname === '/api/attendance') {
      if (req.method === 'GET') return handleGetAttendance(req, res, reqUrl);
      if (req.method === 'POST') return handleSaveAttendance(req, res);
    }

    // 3. Employees API (Xodimlar)
    if (pathname === '/api/employees') {
      if (req.method === 'GET') return handleGetEmployees(req, res, reqUrl);
      if (req.method === 'POST') return handleCreateEmployeeApi(req, res);
      if (req.method === 'PATCH') return handleUpdateEmployeeApi(req, res);
    }
    if (pathname.startsWith('/api/employees/')) {
      const empId = pathname.replace('/api/employees/', '').trim();
      if (req.method === 'PATCH') return handleUpdateEmployeeByIdApi(req, res, empId);
      if (req.method === 'DELETE') return handleDeleteEmployeeByIdApi(req, res, empId);
    }

    // 4. Admins API
    if (pathname === '/api/admins' && req.method === 'GET') {
      return handleGetAdmins(req, res);
    }

    // 5. Settings API (IP, GPS, Yuz nazorati sozlamalari)
    if (pathname === '/api/settings') {
      if (req.method === 'GET') return handleGetSettings(req, res, reqUrl);
      if (req.method === 'POST') return handleSaveSettings(req, res);
    }

    // 6. Notifications API (Bildirishnomalar)
    if (pathname === '/api/notifications') {
      if (req.method === 'GET') return handleGetNotifications(req, res, reqUrl);
      if (req.method === 'POST') return handleCreateNotification(req, res);
    }
    if (pathname.startsWith('/api/notifications/') && req.method === 'PATCH') {
      const notifId = pathname.replace('/api/notifications/', '').trim();
      return handleMarkNotificationRead(req, res, notifId);
    }

    // 7. Feedback API (Fikr va shikoyatlar)
    if (pathname === '/api/feedback') {
      if (req.method === 'GET') return handleGetFeedback(req, res, reqUrl);
      if (req.method === 'POST') return handleCreateFeedback(req, res);
    }
    if (pathname.startsWith('/api/feedback/') && req.method === 'PATCH') {
      const fbId = pathname.replace('/api/feedback/', '').trim();
      return handleReplyFeedback(req, res, fbId);
    }

    // 8. Lunch Plans API (Tushlik rejalari)
    if (pathname === '/api/lunch-plans') {
      if (req.method === 'GET') return handleGetLunchPlans(req, res, reqUrl);
      if (req.method === 'POST') return handleSaveLunchPlan(req, res);
    }

    // 9. Employee Leaves API (Ta'tillar)
    if (pathname === '/api/employee-leaves') {
      if (req.method === 'GET') return handleGetEmployeeLeaves(req, res, reqUrl);
      if (req.method === 'POST') return handleSaveEmployeeLeave(req, res);
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
  function startListening(portToTry, attempt = 0) {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE') {
        if (attempt < 5) {
          const nextPort = portToTry + 1;
          console.warn(`[DIQQAT]: ${portToTry}-port band! Keyingi ${nextPort}-portda ishga tushirishga harakat qilinmoqda...`);
          server.removeListener('error', onError);
          startListening(nextPort, attempt + 1);
        } else {
          console.error(`\n[DIQQAT]: ${PORT} dan ${portToTry} gacha bo'lgan portlar band!`);
          console.error(`Eski jarayonlarni to'xtatish uchun terminalda: sudo fuser -k ${PORT}/tcp yoki sudo killall -9 node`);
          process.exit(1);
        }
      } else {
        console.error('\n[Server xatoligi]:', err.message);
        process.exit(1);
      }
    };

    server.once('error', onError);

    server.listen(portToTry, HOST, () => {
      server.removeListener('error', onError);
      console.log(`====================================================`);
      console.log(`  AloqaPro Server muvaffaqiyatli ishga tushdi`);
      console.log(`  Manzil: http://${HOST}:${portToTry}`);
      console.log(`  Lokal test: http://localhost:${portToTry}`);
      console.log(`  Ma'lumotlar bazasi: PostgreSQL (${process.env.DATABASE_URL ? 'sozlangan' : 'lokal zaxira'})`);
      console.log(`  Supabase: BUTUNLAY O'CHIRILGAN (100% Server & PostgreSQL)`);
      console.log(`  Google Sheets: TO'XTATILGAN (Faqat xavfsiz baza)`);
      console.log(`  Tozalash siyosati: Har ${process.env.RETENTION_INTERVAL_MONTHS || 2} oyda, 3 oydan eski ma'lumotlar o'chiriladi`);
      console.log(`====================================================`);

      // Ma'lumotlar bazasi sxemasini tekshirish va yangilash
      ensureDatabaseSchema();

      // Tozalash vazifasini ishga tushirish
      initRetentionScheduler();

      // 18:30 avtomatik yakunlash va 17:55 eslatma rejalashtiruvchisi
      initAutoEndScheduler();
    });
  }

  startListening(PORT);

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
  const examplePath = path.join(__dirname, '.env.example');
  if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
    try {
      fs.copyFileSync(examplePath, envPath);
      console.log("[AloqaPro]: .env fayli topilmadi, .env.example asosida avtomatik yaratildi.");
    } catch (_) { }
  }

  if (fs.existsSync(envPath)) {
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

  // Standart PostgreSQL ulanish manzili (hech qachon DATABASE_URL yo'q deb xato bermaydi)
  if (!process.env.DATABASE_URL) {
    const dbUser = process.env.DB_USER || 'aloqa_user';
    const dbPass = process.env.DB_PASSWORD || 'aloqa_password';
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || '5432';
    const dbName = process.env.DB_NAME || 'aloqapro';
    process.env.DATABASE_URL = `postgres://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}`;
  }
}

function parseBool(val) {
  return String(val || '').toLowerCase() === 'true';
}

function sendEnv(res) {
  const config = {
    DATABASE_TYPE: 'postgresql',
    API_BASE: '/api',
    FUNCTIONS_BASE: '/api/functions/v1',
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

  // update-employee-operator
  if (name === 'update-employee-operator') {
    return handleUpdateEmployeeOperator(res, body);
  }

  return sendJson(res, 404, { ok: false, error: `Noma'lum funksiya: ${name}` });
}

async function handleCreateEmployee(res, body) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '').trim();
  const validRoles = ['manager', 'operator', 'sales_operator', 'intern', 'senior', 'junior'];
  const rawRole = String(body.role || body.kpi_type || 'operator').toLowerCase();
  const kpiType = validRoles.includes(rawRole) ? rawRole : 'operator';
  const operatorNumber = String(body.operator_number || body.pbx_extension || '').trim() || null;

  if (!name || !email || !password) {
    return sendJson(res, 400, { ok: false, error: 'Ism, email va parol kiritilishi shart' });
  }

  const pool = getDbPool();
  if (pool) {
    try {
      const query = `
        INSERT INTO public.employees (user_id, name, login, password, kpi_type, operator_number, pbx_extension, active, face_registered)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $5, true, false)
        RETURNING id, name, login, kpi_type, operator_number, active;
      `;
      const result = await pool.query(query, [name, email, password, kpiType, operatorNumber]);
      const newEmp = result.rows[0];
      const newEmpId = newEmp?.id;
      if (newEmpId && operatorNumber) {
        await pool.query(
          'UPDATE public.calls SET employee_id = $1 WHERE operator_number = $2 AND employee_id IS NULL',
          [newEmpId, operatorNumber]
        ).catch(() => { });
      }

      // Lokal JSON zaxirasi
      const emps = readJsonData('employees.json', []);
      emps.push({ ...newEmp, password, created_at: new Date().toISOString() });
      writeJsonData('employees.json', emps);

      return sendJson(res, 200, { ok: true, employee_id: newEmpId, employee: newEmp });
    } catch (dbErr) {
      console.error('handleCreateEmployee DB xatosi:', dbErr.message);
    }
  }

  // Fallback: Local employees.json ga saqlash
  const emps = readJsonData('employees.json', []);
  const newEmpId = `emp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const newEmp = {
    id: newEmpId,
    user_id: newEmpId,
    name,
    login: email,
    password,
    kpi_type: kpiType,
    operator_number: operatorNumber,
    pbx_extension: operatorNumber,
    active: true,
    face_registered: false,
    created_at: new Date().toISOString()
  };
  emps.push(newEmp);
  writeJsonData('employees.json', emps);

  if (operatorNumber) {
    try {
      const calls = readLocalCalls();
      let callUpdated = false;
      calls.forEach(c => {
        if (c.operator_number === operatorNumber && !c.employee_id) {
          c.employee_id = newEmpId;
          c.employee_name = name;
          callUpdated = true;
        }
      });
      if (callUpdated) writeLocalCalls(calls);
    } catch (_) { }
  }

  return sendJson(res, 200, { ok: true, employee_id: newEmpId, employee: newEmp });
}

async function handleDeleteEmployee(res, body) {
  const employeeId = body.employee_id || body.id;
  if (!employeeId) return sendJson(res, 400, { ok: false, error: 'employee_id berilmadi' });

  const pool = getDbPool();
  if (pool) {
    try {
      // Ishdan ketgan xodim o'chirilganda: active=false qilish va operator raqamlarini tozalash!
      await pool.query(
        'UPDATE public.employees SET active = false, operator_number = NULL, pbx_extension = NULL, updated_at = now() WHERE id = $1',
        [employeeId]
      );
    } catch (dbErr) {
      console.error('handleDeleteEmployee DB xatosi:', dbErr.message);
    }
  }

  const emps = readJsonData('employees.json', []);
  const emp = emps.find(e => e.id === employeeId);
  if (emp) {
    emp.active = false;
    emp.operator_number = null;
    emp.pbx_extension = null;
    emp.updated_at = new Date().toISOString();
    writeJsonData('employees.json', emps);
  }

  // Barcha PBX qo'ng'iroqlarni va operatorlar bog'lanishini yangilaymiz
  await relinkAllPbxCalls().catch(() => {});

  return sendJson(res, 200, { ok: true });
}

async function handleResetEmployeePassword(res, body) {
  const employeeId = body.employee_id || body.id;
  const newPassword = body.new_password;
  if (!employeeId || !newPassword) {
    return sendJson(res, 400, { ok: false, error: 'employee_id va new_password kiritilishi shart' });
  }

  const pool = getDbPool();
  if (pool) {
    try {
      await pool.query('UPDATE public.employees SET password = $1, updated_at = now() WHERE id = $2', [newPassword, employeeId]);
    } catch (err) {
      console.error('handleResetEmployeePassword DB xatosi:', err.message);
    }
  }

  const emps = readJsonData('employees.json', []);
  const emp = emps.find(e => e.id === employeeId);
  if (emp) {
    emp.password = newPassword;
    emp.updated_at = new Date().toISOString();
    writeJsonData('employees.json', emps);
  }

  return sendJson(res, 200, { ok: true, message: 'Parol muvaffaqiyatli yangilandi' });
}

async function handleUpdateEmployeeOperator(res, body) {
  const employeeId = body.employee_id || body.id;
  const operatorNumber = String(body.operator_number || body.pbx_extension || '').trim() || null;
  if (!employeeId) {
    return sendJson(res, 400, { ok: false, error: 'employee_id berilmadi' });
  }

  let employeeName = null;

  // 1. PostgreSQL DB
  const pool = getDbPool();
  if (pool) {
    try {
      // Agar operator raqami berilgan bo'lsa, boshqa har qanday xodimdan (aktiv yoki inaktiv) bu raqamni bo'shatamiz
      if (operatorNumber) {
        await pool.query(
          'UPDATE public.employees SET operator_number = NULL, pbx_extension = NULL WHERE (operator_number = $1 OR pbx_extension = $1) AND id <> $2',
          [operatorNumber, employeeId]
        );
      }

      const uRes = await pool.query(
        'UPDATE public.employees SET operator_number = $1, pbx_extension = $1, updated_at = now() WHERE id = $2 RETURNING id, name',
        [operatorNumber, employeeId]
      );
      if (uRes.rows && uRes.rows[0]) {
        employeeName = uRes.rows[0].name;
      }

      // Agar xodimga operator biriktirilsa, uning barcha qo'ng'iroqlarida employee_id va employee_name ni darhol yangilaymiz
      if (operatorNumber && employeeName) {
        await pool.query(
          'UPDATE public.calls SET employee_id = $1, employee_name = $2, updated_at = now() WHERE operator_number = $3',
          [employeeId, employeeName, operatorNumber]
        ).catch(() => { });
      }
    } catch (dbErr) {
      console.error('[handleUpdateEmployeeOperator DB xatosi]:', dbErr.message);
    }
  }

  // 2. Local employees.json
  const emps = readJsonData('employees.json', []);
  if (operatorNumber) {
    emps.forEach(e => {
      if (e.id !== employeeId && (e.operator_number === operatorNumber || e.pbx_extension === operatorNumber)) {
        e.operator_number = null;
        e.pbx_extension = null;
      }
    });
  }
  const empIdx = emps.findIndex(e => e.id === employeeId);
  if (empIdx >= 0) {
    emps[empIdx].operator_number = operatorNumber;
    emps[empIdx].pbx_extension = operatorNumber;
    emps[empIdx].updated_at = new Date().toISOString();
    employeeName = employeeName || emps[empIdx].name;
    writeJsonData('employees.json', emps);
  }

  // 3. Ushbu operator bo'yicha barcha qo'ng'iroqlarni bazada va lokal faylda to'liq qayta bog'laymiz
  const relinkResult = await relinkAllPbxCalls().catch(() => ({ updated_count: 0 }));

  return sendJson(res, 200, {
    ok: true,
    employee_id: employeeId,
    operator_number: operatorNumber,
    employee_name: employeeName,
    relinked: relinkResult ? relinkResult.updated_count : 0
  });
}

// ============================================================
//  ONLINEPBX INTEGRATSIYASI VA QO'NG'IROQLAR MONITORINGI
// ============================================================

const CALLS_DATA_FILE = path.join(ROOT, 'data', 'calls.json');

function readLocalCalls() {
  try {
    if (fs.existsSync(CALLS_DATA_FILE)) {
      const txt = fs.readFileSync(CALLS_DATA_FILE, 'utf8');
      return JSON.parse(txt) || [];
    }
  } catch (e) { }
  return [];
}

function writeLocalCalls(calls) {
  try {
    const dataDir = path.join(ROOT, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const trimmed = (calls || []).slice(-5000);
    fs.writeFileSync(CALLS_DATA_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (e) {
    console.warn('[writeLocalCalls xatosi]:', e.message);
  }
}

function readRawBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body || ''));
    req.on('error', () => resolve(''));
  });
}

async function readParsedBody(req, reqUrl) {
  const raw = await readRawBody(req);
  let parsed = {};
  if (raw && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      try {
        const searchParams = new URLSearchParams(raw);
        parsed = Object.fromEntries(searchParams.entries());
      } catch {
        parsed = {};
      }
    }
  }
  if (reqUrl && reqUrl.searchParams) {
    for (const [k, v] of reqUrl.searchParams.entries()) {
      if (parsed[k] === undefined) parsed[k] = v;
    }
  }
  return { parsed, raw };
}

async function saveCallRecord(call) {
  const pool = getDbPool();
  if (pool) {
    try {
      const query = `
        INSERT INTO public.calls (
          call_id, caller, callee, operator_number, employee_id, direction, status,
          duration, talk_time, record_url, raw_data, call_date, started_at, rating, rating_comment
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (call_id) DO UPDATE SET
          caller = COALESCE(NULLIF(EXCLUDED.caller, ''), public.calls.caller),
          callee = COALESCE(NULLIF(EXCLUDED.callee, ''), public.calls.callee),
          operator_number = COALESCE(NULLIF(EXCLUDED.operator_number, ''), public.calls.operator_number),
          employee_id = COALESCE(EXCLUDED.employee_id, public.calls.employee_id),
          direction = COALESCE(EXCLUDED.direction, public.calls.direction),
          status = EXCLUDED.status,
          duration = GREATEST(public.calls.duration, EXCLUDED.duration),
          talk_time = GREATEST(public.calls.talk_time, EXCLUDED.talk_time),
          record_url = COALESCE(EXCLUDED.record_url, public.calls.record_url),
          rating = COALESCE(EXCLUDED.rating, public.calls.rating),
          rating_comment = COALESCE(EXCLUDED.rating_comment, public.calls.rating_comment),
          raw_data = EXCLUDED.raw_data,
          updated_at = now()
        RETURNING *;
      `;
      const res = await pool.query(query, [
        call.call_id,
        call.caller,
        call.callee,
        call.operator_number,
        call.employee_id,
        call.direction,
        call.status,
        call.duration,
        call.talk_time,
        call.record_url,
        JSON.stringify(call.raw_data || {}),
        call.call_date,
        call.started_at,
        call.rating !== undefined ? call.rating : null,
        call.rating_comment || null
      ]);
      if (res.rows && res.rows[0]) {
        call = { ...call, ...res.rows[0] };
      }
    } catch (dbErr) {
      console.error('[saveCallRecord DB xatosi]:', dbErr.message);
    }
  }

  try {
    const list = readLocalCalls();
    const idx = list.findIndex(c => c.call_id === call.call_id);
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        ...call,
        rating: call.rating !== undefined ? call.rating : list[idx].rating,
        rating_comment: call.rating_comment !== undefined ? call.rating_comment : list[idx].rating_comment,
        updated_at: new Date().toISOString()
      };
    } else {
      list.push({ ...call, created_at: new Date().toISOString() });
    }
    writeLocalCalls(list);
  } catch (e) { }

  return call;
}

// ============================================================
//  ONLINEPBX QO'NG'IROQLARINI XODIMLARGA BIRIKTIRISH (RELINK)
// ============================================================
const ALLOWED_PBX_OPERATORS = ['100', '101', '102', '103', '104', '105', '5002'];

async function relinkAllPbxCalls() {
  const pool = getDbPool();
  let updatedCount = 0;

  // 0. Inactive (ishdan ketgan) xodimlardan operator raqamini tozalash
  if (pool) {
    try {
      await pool.query(`
        UPDATE public.employees
        SET operator_number = NULL, pbx_extension = NULL
        WHERE active = false AND (operator_number IS NOT NULL OR pbx_extension IS NOT NULL)
      `);
    } catch (_) {}
  }

  // 1. Xodimlar ro'yxatini olamiz (faqat ACTIVE xodimlar!)
  let employees = [];
  if (pool) {
    try {
      const empRes = await pool.query('SELECT id, name, operator_number, pbx_extension FROM public.employees WHERE active = true ORDER BY updated_at DESC, created_at DESC');
      employees = empRes.rows || [];
    } catch (e) {
      console.warn('[relinkAllPbxCalls] Emp query xatosi:', e.message);
    }
  }
  if (!employees.length) {
    employees = readJsonData('employees.json', []).filter(e => e.active !== false);
  }

  // Xodimlar xaritasi: faqat ruxsat berilgan 7 ta operator bo'yicha (eng yangi aktiv xodim)
  const empByOp = new Map();
  employees.forEach(emp => {
    const op = String(emp.operator_number || '').trim();
    const pbx = String(emp.pbx_extension || '').trim();
    if (op && ALLOWED_PBX_OPERATORS.includes(op) && !empByOp.has(op)) empByOp.set(op, emp);
    if (pbx && ALLOWED_PBX_OPERATORS.includes(pbx) && !empByOp.has(pbx)) empByOp.set(pbx, emp);
  });

  // 2. PostgreSQL dagi calls jadvalini to'liq qayta bog'laymiz
  if (pool) {
    try {
      // Begona / noto'g'ri raqamlarni (10, 5000, 5001, 5004, 6200 va hk) tozalash
      await pool.query(`
        UPDATE public.calls
        SET operator_number = NULL, employee_id = NULL, employee_name = NULL
        WHERE operator_number IS NOT NULL
          AND NOT (operator_number = ANY($1::text[]))
      `, [ALLOWED_PBX_OPERATORS]).catch(() => {});

      if (empByOp.size > 0) {
        for (const [opNum, emp] of empByOp.entries()) {
          if (!opNum) continue;

          // A. Ushbu operator raqamidagi BARCHA qo'ng'iroqlarni hozirgi faol xodimga to'liq yangilash
          const resExistingOp = await pool.query(`
            UPDATE public.calls
            SET employee_id = $2,
                employee_name = $3,
                updated_at = now()
            WHERE operator_number = $1
              AND (employee_id IS NULL OR employee_id <> $2 OR employee_name IS NULL OR employee_name <> $3)
          `, [opNum, emp.id, emp.name]);
          updatedCount += (resExistingOp.rowCount || 0);

          // B. callee operator raqamiga to'g'ri keladigan kiruvchi qo'ng'iroqlar
          const resCallee = await pool.query(`
            UPDATE public.calls
            SET operator_number = $1,
                employee_id = $2,
                employee_name = $3,
                direction = COALESCE(NULLIF(direction, ''), 'in'),
                updated_at = now()
            WHERE (operator_number IS NULL OR operator_number = '' OR operator_number = '—' OR employee_id IS NULL OR employee_id <> $2)
              AND (callee = $1 OR callee = ('SIP/' || $1) OR callee LIKE ($1 || '@%') OR callee LIKE ('%/' || $1))
          `, [opNum, emp.id, emp.name]);
          updatedCount += (resCallee.rowCount || 0);

          // C. caller operator raqamiga to'g'ri keladigan chiquvchi qo'ng'iroqlar
          const resCaller = await pool.query(`
            UPDATE public.calls
            SET operator_number = $1,
                employee_id = $2,
                employee_name = $3,
                direction = 'out',
                updated_at = now()
            WHERE (operator_number IS NULL OR operator_number = '' OR operator_number = '—' OR employee_id IS NULL OR employee_id <> $2)
              AND (caller = $1 OR caller = ('SIP/' || $1) OR caller LIKE ($1 || '@%') OR caller LIKE ('%/' || $1))
          `, [opNum, emp.id, emp.name]);
          updatedCount += (resCaller.rowCount || 0);

          // D. raw_data JSON ichida user/extension/agent mavjud bo'lgan holatlar
          const resRaw = await pool.query(`
            UPDATE public.calls
            SET operator_number = $1,
                employee_id = $2,
                employee_name = $3,
                updated_at = now()
            WHERE (operator_number IS NULL OR operator_number = '' OR operator_number = '—' OR employee_id IS NULL OR employee_id <> $2)
              AND (
                raw_data->>'user' = $1 OR
                raw_data->>'extension' = $1 OR
                raw_data->>'ext' = $1 OR
                raw_data->>'agent' = $1 OR
                raw_data->>'operator' = $1 OR
                raw_data->'user'->>'number' = $1
              )
          `, [opNum, emp.id, emp.name]);
          updatedCount += (resRaw.rowCount || 0);
        }
      }

      // E. Agar operator_number hali ham bo'sh bo'lsa, lekin callee yoki caller ruxsat berilgan 7 ta operatordan biri bo'lsa
      await pool.query(`
        UPDATE public.calls
        SET operator_number = callee,
            direction = COALESCE(NULLIF(direction, ''), 'in'),
            updated_at = now()
        WHERE (operator_number IS NULL OR operator_number = '' OR operator_number = '—')
          AND callee = ANY($1::text[])
      `, [ALLOWED_PBX_OPERATORS]).catch(() => {});

      await pool.query(`
        UPDATE public.calls
        SET operator_number = caller,
            direction = 'out',
            updated_at = now()
        WHERE (operator_number IS NULL OR operator_number = '' OR operator_number = '—')
          AND caller = ANY($1::text[])
      `, [ALLOWED_PBX_OPERATORS]).catch(() => {});
    } catch (dbErr) {
      console.warn('[relinkAllPbxCalls DB]:', dbErr.message);
    }
  }

  // 3. Lokal data/calls.json faylini ham to'g'rilaymiz
  try {
    const localCalls = readLocalCalls();
    let localChanged = false;
    const allowedSet = new Set(ALLOWED_PBX_OPERATORS);

    localCalls.forEach(c => {
      let op = String(c.operator_number || '').trim();
      if (op && !allowedSet.has(op)) {
        c.operator_number = null;
        c.employee_id = null;
        c.employee_name = null;
        localChanged = true;
      }
      const callee = String(c.callee || '').trim();
      const caller = String(c.caller || '').trim();

      let detectedOp = op && allowedSet.has(op) ? op : null;
      if (!detectedOp) {
        if (allowedSet.has(callee)) {
          detectedOp = callee;
          c.direction = c.direction || 'in';
        } else if (allowedSet.has(caller)) {
          detectedOp = caller;
          c.direction = 'out';
        }
      }

      if (detectedOp) {
        c.operator_number = detectedOp;
        if (empByOp.has(detectedOp)) {
          const matchedEmp = empByOp.get(detectedOp);
          if (c.employee_id !== matchedEmp.id || c.employee_name !== matchedEmp.name) {
            c.employee_id = matchedEmp.id;
            c.employee_name = matchedEmp.name;
            localChanged = true;
            updatedCount++;
          }
        }
      }
    });
    if (localChanged) {
      writeLocalCalls(localCalls);
    }
  } catch (e) { }

  if (updatedCount > 0) {
    console.log(`[relinkAllPbxCalls]: Jami ${updatedCount} ta qo'ng'iroq xodimlarga muvaffaqiyatli qayta biriktirildi.`);
  }
  return { ok: true, updated_count: updatedCount };
}

async function getCallsStats(from, to, operator = 'all', status = 'all') {
  const allowedSet = new Set(ALLOWED_PBX_OPERATORS);
  const OPERATOR_ACCOUNTS_COUNT = 5; // Foydalanuvchi talabi: qat'iy 5 ta akkaunt
  const pool = getDbPool();
  if (pool) {
    try {
      // 1. Kompaniyaga kelgan barcha umumiy kiruvchi qo'ng'iroqlar soni (X)
      const companyQuery = `
        SELECT
          COUNT(c.id)::int AS total_company_incoming,
          COUNT(c.id) FILTER (WHERE c.status = 'answered')::int AS total_company_answered,
          COUNT(c.id) FILTER (WHERE c.status = 'missed')::int AS total_company_missed
        FROM public.calls c
        WHERE c.call_date BETWEEN $1 AND $2
          AND (LOWER(COALESCE(c.direction, 'in')) IN ('in', 'inbound', '') OR c.direction IS NULL);
      `;
      const companyRes = await pool.query(companyQuery, [from, to]).catch(() => ({ rows: [] }));
      const totalCompanyIncoming = Number(companyRes.rows[0]?.total_company_incoming) || 0;
      const totalCompanyAnswered = Number(companyRes.rows[0]?.total_company_answered) || 0;
      const totalCompanyMissed = Number(companyRes.rows[0]?.total_company_missed) || 0;

      // X: Jami kiruvchilar soni (Kompaniyaga kelgan)
      const X = totalCompanyIncoming;
      // Z: Har bir akkaunt uchun gaplashishi kerak bo'lgan norma soni (X / 5)
      const Z = OPERATOR_ACCOUNTS_COUNT > 0 ? (X / OPERATOR_ACCOUNTS_COUNT) : 0;

      let statsQuery = `
        SELECT
          c.operator_number,
          COUNT(c.id)::int AS total_calls,
          COUNT(c.id) FILTER (WHERE c.status = 'answered')::int AS answered_calls,
          COUNT(c.id) FILTER (WHERE c.status = 'missed')::int AS missed_calls,
          COALESCE(SUM(c.talk_time), 0)::int AS total_talk_seconds,
          CASE
            WHEN COUNT(c.id) > 0
            THEN ROUND(COALESCE(SUM(c.talk_time), 0) / COUNT(c.id))::int
            ELSE 0
          END AS avg_talk_seconds,
          ROUND(COALESCE(AVG(c.rating) FILTER (WHERE c.rating IS NOT NULL AND c.rating > 0), 0)::numeric, 1)::float AS avg_rating,
          COUNT(c.id) FILTER (WHERE c.rating IS NOT NULL AND c.rating > 0)::int AS rated_calls_count
        FROM public.calls c
        WHERE c.call_date BETWEEN $1 AND $2
          AND (LOWER(COALESCE(c.direction, 'in')) IN ('in', 'inbound', '') OR c.direction IS NULL)
          AND c.operator_number = ANY($3::text[])
      `;
      const params = [from, to, ALLOWED_PBX_OPERATORS];
      if (operator && operator !== 'all') {
        params.push(operator);
        statsQuery += ` AND c.operator_number = $${params.length}`;
      }
      if (status && status !== 'all') {
        params.push(status);
        statsQuery += ` AND c.status = $${params.length}`;
      }
      statsQuery += ` GROUP BY c.operator_number ORDER BY total_calls DESC;`;
      const statsRes = await pool.query(statsQuery, params);

      const empQuery = `
        SELECT id, name, operator_number, pbx_extension
        FROM public.employees
        WHERE active = true
        ORDER BY updated_at DESC, created_at DESC;
      `;
      const empRes = await pool.query(empQuery).catch(() => ({ rows: [] }));
      const emps = empRes.rows || [];

      const opMap = new Map();
      ALLOWED_PBX_OPERATORS.forEach(opNum => {
        const emp = emps.find(e => (String(e.operator_number || '').trim() === opNum || String(e.pbx_extension || '').trim() === opNum));
        opMap.set(opNum, {
          operator_number: opNum,
          employee_id: emp?.id || null,
          employee_name: emp?.name || (opNum === '5002' ? '5002-operator' : '—'),
          total_calls: 0,
          answered_calls: 0,
          missed_calls: 0,
          target_quota: Math.round(Z * 10) / 10,
          answered_percent: 0,
          total_talk_seconds: 0,
          avg_talk_seconds: 0,
          avg_rating: null,
          rated_calls_count: 0
        });
      });

      (statsRes.rows || []).forEach(r => {
        const rawOp = String(r.operator_number || '').trim();
        if (opMap.has(rawOp)) {
          const item = opMap.get(rawOp);
          item.total_calls = Number(r.total_calls) || 0;
          item.answered_calls = Number(r.answered_calls) || 0;
          item.missed_calls = Number(r.missed_calls) || 0;
          item.target_quota = Math.round(Z * 10) / 10;
          // FORMULA: Y / Z * 100% (Y: gaplashilgan qo'ng'iroqlar, Z: har bir akkaunt normasi X/5)
          item.answered_percent = Z > 0 ? Math.round((item.answered_calls / Z) * 100 * 10) / 10 : 0;
          item.total_talk_seconds = Number(r.total_talk_seconds) || 0;
          item.avg_talk_seconds = Number(r.avg_talk_seconds) || 0;
          item.avg_rating = r.rated_calls_count > 0 ? Number(r.avg_rating) : null;
          item.rated_calls_count = Number(r.rated_calls_count) || 0;
        }
      });

      let operators = Array.from(opMap.values()).sort((a, b) => b.total_calls - a.total_calls);
      if (operator && operator !== 'all') {
        operators = operators.filter(o => o.operator_number === operator);
      }

      const totalCalls = X > 0 ? X : operators.reduce((s, x) => s + x.total_calls, 0);
      const answeredCalls = totalCompanyAnswered > 0 ? totalCompanyAnswered : operators.reduce((s, x) => s + x.answered_calls, 0);
      const missedCalls = totalCompanyMissed > 0 ? totalCompanyMissed : Math.max(0, totalCalls - answeredCalls);
      const totalTalkSec = operators.reduce((s, x) => s + x.total_talk_seconds, 0);
      const avgTalkSec = totalCalls > 0 ? Math.round(totalTalkSec / totalCalls) : 0;
      const answeredPercent = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100 * 10) / 10 : 0;

      const totalRatedCount = operators.reduce((s, x) => s + (x.rated_calls_count || 0), 0);
      const totalWeightedRating = operators.reduce((s, x) => s + ((x.avg_rating || 0) * (x.rated_calls_count || 0)), 0);
      const avgRating = totalRatedCount > 0 ? Math.round((totalWeightedRating / totalRatedCount) * 10) / 10 : null;

      return {
        ok: true,
        from,
        to,
        operator,
        status,
        summary: {
          total_calls: totalCalls,
          accounts_count: OPERATOR_ACCOUNTS_COUNT,
          target_quota: Math.round(Z * 10) / 10,
          answered_calls: answeredCalls,
          missed_calls: missedCalls,
          answered_percent: answeredPercent,
          total_talk_seconds: totalTalkSec,
          avg_talk_seconds: avgTalkSec,
          avg_rating: avgRating,
          rated_calls_count: totalRatedCount
        },
        operators
      };
    } catch (err) {
      console.error('[getCallsStats DB xatosi]:', err.message);
    }
  }

  // Fallback: local calls.json va employees.json dan
  const allEmployees = readJsonData('employees.json', []);
  const allLocalCalls = readLocalCalls();

  const allCompanyIncoming = allLocalCalls.filter(c => {
    const cd = c.call_date || (c.started_at ? c.started_at.split('T')[0] : '');
    const dateMatch = (!from || cd >= from) && (!to || cd <= to);
    const dir = String(c.direction || 'in').toLowerCase().trim();
    const isIncoming = (dir === 'in' || dir === 'inbound' || dir === '');
    const statusMatch = (!status || status === 'all' || c.status === status);
    return dateMatch && isIncoming && statusMatch;
  });

  const X = allCompanyIncoming.length;
  const Z = OPERATOR_ACCOUNTS_COUNT > 0 ? (X / OPERATOR_ACCOUNTS_COUNT) : 0;

  let calls = allCompanyIncoming.filter(c => {
    const op = String(c.operator_number || '').trim();
    const isAllowed = allowedSet.has(op);
    const opMatch = (!operator || operator === 'all' || op === String(operator).trim());
    return isAllowed && opMatch;
  });

  const opMap = new Map();
  ALLOWED_PBX_OPERATORS.forEach(opNum => {
    const emp = allEmployees.find(e => (String(e.operator_number || '').trim() === opNum || String(e.pbx_extension || '').trim() === opNum));
    opMap.set(opNum, {
      operator_number: opNum,
      employee_id: emp?.id || null,
      employee_name: emp?.name || (opNum === '5002' ? '5002-operator' : '—'),
      total_calls: 0,
      answered_calls: 0,
      missed_calls: 0,
      target_quota: Math.round(Z * 10) / 10,
      answered_percent: 0,
      total_talk_seconds: 0,
      total_rating_sum: 0,
      rated_calls_count: 0
    });
  });

  calls.forEach(c => {
    const op = String(c.operator_number || '').trim();
    if (opMap.has(op)) {
      const item = opMap.get(op);
      item.total_calls++;
      if (c.status === 'answered') {
        item.answered_calls++;
        item.total_talk_seconds += (c.talk_time || 0);
      } else {
        item.missed_calls++;
      }

      const r = parseFloat(c.rating);
      if (!isNaN(r) && r > 0) {
        item.total_rating_sum += r;
        item.rated_calls_count++;
      }
    }
  });

  let operators = Array.from(opMap.values()).map(x => ({
    operator_number: x.operator_number,
    employee_id: x.employee_id,
    employee_name: x.employee_name,
    total_calls: x.total_calls,
    answered_calls: x.answered_calls,
    missed_calls: x.missed_calls,
    target_quota: Math.round(Z * 10) / 10,
    answered_percent: Z > 0 ? Math.round((x.answered_calls / Z) * 100 * 10) / 10 : 0,
    total_talk_seconds: x.total_talk_seconds,
    avg_talk_seconds: x.total_calls > 0 ? Math.round(x.total_talk_seconds / x.total_calls) : 0,
    avg_rating: x.rated_calls_count > 0 ? Math.round((x.total_rating_sum / x.rated_calls_count) * 10) / 10 : null,
    rated_calls_count: x.rated_calls_count
  })).sort((a, b) => b.total_calls - a.total_calls);

  if (operator && operator !== 'all') {
    operators = operators.filter(o => o.operator_number === operator);
  }

  const totalCalls = X > 0 ? X : calls.length;
  const answeredCalls = allCompanyIncoming.filter(c => c.status === 'answered').length;
  const missedCalls = allCompanyIncoming.filter(c => c.status === 'missed').length;
  const totalTalkSec = calls.reduce((s, c) => s + (c.talk_time || 0), 0);
  const avgTalkSec = totalCalls > 0 ? Math.round(totalTalkSec / totalCalls) : 0;

  const allRatedCalls = calls.filter(c => parseFloat(c.rating) > 0);
  const totalRatingSum = allRatedCalls.reduce((s, c) => s + parseFloat(c.rating), 0);
  const avgRating = allRatedCalls.length > 0 ? Math.round((totalRatingSum / allRatedCalls.length) * 10) / 10 : null;

  return {
    ok: true,
    from,
    to,
    operator,
    status,
    summary: {
      total_calls: totalCalls,
      accounts_count: OPERATOR_ACCOUNTS_COUNT,
      target_quota: Math.round(Z * 10) / 10,
      answered_calls: answeredCalls,
      missed_calls: missedCalls,
      answered_percent: totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100 * 10) / 10 : 0,
      total_talk_seconds: totalTalkSec,
      avg_talk_seconds: avgTalkSec,
      avg_rating: avgRating,
      rated_calls_count: allRatedCalls.length
    },
    operators
  };
}

async function getCallsList(from, to, operator, status, limit = 50) {
  limit = Math.min(300, Math.max(1, parseInt(limit, 10) || 50));
  const pool = getDbPool();
  if (pool) {
    try {
      let query = `
        SELECT
          c.id,
          c.call_id,
          c.caller,
          c.callee,
          c.operator_number,
          COALESCE(e.name, c.employee_name, '—') AS employee_name,
          c.direction,
          c.status,
          c.duration,
          c.talk_time,
          c.record_url,
          c.rating,
          c.rating_comment,
          c.call_date,
          c.started_at
        FROM public.calls c
        LEFT JOIN LATERAL (
          SELECT name
          FROM public.employees emp
          WHERE emp.active = true
            AND (
              (c.operator_number IS NOT NULL AND c.operator_number <> '' AND (emp.operator_number = c.operator_number OR emp.pbx_extension = c.operator_number))
              OR emp.id = c.employee_id
            )
          ORDER BY (emp.operator_number = c.operator_number) DESC, emp.updated_at DESC
          LIMIT 1
        ) e ON true
        WHERE c.operator_number = ANY($1::text[])
      `;
      const params = [ALLOWED_PBX_OPERATORS];
      if (from) {
        params.push(from);
        query += ` AND c.call_date >= $${params.length}`;
      }
      if (to) {
        params.push(to);
        query += ` AND c.call_date <= $${params.length}`;
      }
      if (operator && operator !== 'all') {
        params.push(operator);
        query += ` AND c.operator_number = $${params.length}`;
      }
      if (status && status !== 'all') {
        params.push(status);
        query += ` AND c.status = $${params.length}`;
      }
      params.push(limit);
      query += ` ORDER BY c.started_at DESC LIMIT $${params.length}`;

      const res = await pool.query(query, params);
      return { ok: true, calls: res.rows || [] };
    } catch (err) {
      console.error('[getCallsList DB xatosi]:', err.message);
    }
  }

  let calls = readLocalCalls();
  const allEmployees = readJsonData('employees.json', []);
  const empMapByOp = new Map();
  allEmployees.forEach(e => {
    if (e.operator_number) empMapByOp.set(String(e.operator_number).trim(), e.name);
    if (e.pbx_extension) empMapByOp.set(String(e.pbx_extension).trim(), e.name);
  });

  calls = calls.filter(c => ALLOWED_PBX_OPERATORS.includes(String(c.operator_number || '').trim()));
  if (from) calls = calls.filter(c => (c.call_date || '').substring(0, 10) >= from);
  if (to) calls = calls.filter(c => (c.call_date || '').substring(0, 10) <= to);
  if (operator && operator !== 'all') {
    calls = calls.filter(c => c.operator_number === operator);
  }
  if (status && status !== 'all') calls = calls.filter(c => c.status === status);
  calls.sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));

  const enriched = calls.slice(0, limit).map(c => {
    let empName = c.employee_name;
    let opNum = c.operator_number;

    if (!empName || empName === '—' || empName === 'Biriktirilmagan') {
      const found = empMapByOp.get(String(opNum || '').trim()) ||
                    empMapByOp.get(String(c.callee || '').trim()) ||
                    empMapByOp.get(String(c.caller || '').trim());
      if (found) empName = found;
    }
    if (!opNum || opNum === '—') {
      if (empMapByOp.has(String(c.callee || '').trim())) opNum = String(c.callee).trim();
      else if (empMapByOp.has(String(c.caller || '').trim())) opNum = String(c.caller).trim();
    }

    return {
      ...c,
      operator_number: opNum || '—',
      employee_name: empName || '—'
    };
  });

  return { ok: true, calls: enriched };
}

async function handleOnlinePbxWebhook(req, res, reqUrl) {
  try {
    const { parsed } = await readParsedBody(req, reqUrl);
    console.log('[OnlinePBX Webhook qabul qilindi]:', JSON.stringify(parsed));

    const callId = String(
      parsed.uuid || parsed.call_id || parsed.id || parsed.callId || parsed.session_id ||
      `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    ).trim();

    const caller = String(parsed.caller || parsed.phone || parsed.from || parsed.caller_id || parsed.num || parsed.src || parsed.source || '').trim();
    const callee = String(parsed.callee || parsed.called || parsed.to || parsed.destination || parsed.dst || parsed.line || '').trim();

    // 1. Faol xodimlar ro'yxatini yuklaymiz (faqat active = true)
    let allEmployees = [];
    const pool = getDbPool();
    if (pool) {
      try {
        const empRes = await pool.query('SELECT id, name, operator_number, pbx_extension FROM public.employees WHERE active = true ORDER BY updated_at DESC, created_at DESC');
        allEmployees = empRes.rows || [];
      } catch (e) { }
    }
    if (!allEmployees.length) {
      allEmployees = readJsonData('employees.json', []).filter(e => e.active !== false);
    }

    const empByOp = new Map();
    allEmployees.forEach(e => {
      const op = String(e.operator_number || '').trim();
      const pbx = String(e.pbx_extension || '').trim();
      if (op) empByOp.set(op, e);
      if (pbx) empByOp.set(pbx, e);
    });

    // 2. Operator raqamini aniqlash
    let rawOp = '';
    const opCandidates = [
      parsed.user, parsed.extension, parsed.operator, parsed.ext, parsed.agent,
      parsed.user_id, parsed.user_number, parsed.accountcode, parsed.dstchannel,
      parsed.srcchannel, parsed.peer, parsed.channel, parsed.diversion
    ];
    for (const cand of opCandidates) {
      if (!cand) continue;
      if (typeof cand === 'object') {
        const nested = cand.number || cand.extension || cand.operator || cand.id || cand.name;
        if (nested) { rawOp = String(nested); break; }
      } else {
        const str = String(cand).trim();
        if (str && str !== 'undefined' && str !== 'null') { rawOp = str; break; }
      }
    }

    const opMatch = rawOp.match(/(?:SIP\/|PJSIP\/)?(\d{2,5})/i);
    let operatorNumber = opMatch ? opMatch[1] : (rawOp || null);

    const rawDir = String(parsed.direction || parsed.call_type || (parsed.inbound ? 'in' : '') || '').toLowerCase();
    let direction = rawDir.includes('out') ? 'out' : (rawDir.includes('int') ? 'internal' : (rawDir.includes('in') ? 'in' : ''));

    let matchedEmployee = null;

    // A) Agar explicit operator bo'lsa
    if (operatorNumber && empByOp.has(operatorNumber)) {
      matchedEmployee = empByOp.get(operatorNumber);
    }

    // B) Agar callee xodimning operator raqami bo'lsa (Kiruvchi qo'ng'iroq)
    if (!matchedEmployee && callee && empByOp.has(callee)) {
      matchedEmployee = empByOp.get(callee);
      operatorNumber = callee;
      if (!direction) direction = 'in';
    }

    // C) Agar caller xodimning operator raqami bo'lsa (Chiquvchi qo'ng'iroq)
    if (!matchedEmployee && caller && empByOp.has(caller)) {
      matchedEmployee = empByOp.get(caller);
      operatorNumber = caller;
      direction = 'out';
    }

    // D) Agar hali ham topilmagan bo'lsa, qisqa raqam tekshiruvi (faqat ruxsat berilgan 7 ta operator uchun)
    if (!operatorNumber) {
      if (ALLOWED_PBX_OPERATORS.includes(callee)) {
        operatorNumber = callee;
        if (!direction) direction = 'in';
      } else if (ALLOWED_PBX_OPERATORS.includes(caller)) {
        operatorNumber = caller;
        direction = 'out';
      }
    }

    if (operatorNumber && !ALLOWED_PBX_OPERATORS.includes(operatorNumber)) {
      operatorNumber = null;
    }

    if (!direction) {
      direction = (operatorNumber && caller === operatorNumber) ? 'out' : 'in';
    }

    const employeeId = matchedEmployee ? matchedEmployee.id : null;
    const employeeName = matchedEmployee ? matchedEmployee.name : null;

    const duration = Math.max(0, parseInt(parsed.duration || parsed.call_duration || parsed.total_duration || 0, 10) || 0);
    const talkTime = Math.max(0, parseInt(parsed.billsec || parsed.dialog_duration || parsed.talk_time || parsed.conversation_duration || 0, 10) || 0);

    const rawStatus = String(parsed.status || parsed.disposition || parsed.call_status || parsed.event || '').toUpperCase();
    let status = 'missed';
    if (
      rawStatus.includes('NOANSWER') ||
      rawStatus.includes('MISSED') ||
      rawStatus.includes('BUSY') ||
      rawStatus.includes('CANCEL') ||
      rawStatus.includes('FAIL') ||
      rawStatus.includes('REJECT')
    ) {
      status = 'missed';
    } else if (
      rawStatus.includes('ANSWER') ||
      rawStatus.includes('CONNECT') ||
      rawStatus.includes('TALK') ||
      rawStatus.includes('SUCCESS') ||
      talkTime > 0
    ) {
      status = talkTime > 0 ? 'answered' : 'missed';
    } else {
      status = talkTime > 0 ? 'answered' : 'missed';
    }

    const recordUrl = String(parsed.recording || parsed.record || parsed.download_url || parsed.link || parsed.record_url || parsed.audio || '').trim() || null;

    // Baho (rating / score / evaluation)
    let rating = null;
    const rawRating = parsed.rating ?? parsed.score ?? parsed.evaluation ?? parsed.mark ?? parsed.rate ?? parsed.client_rating ?? parsed.ivr_rating ?? parsed.user_rate ?? null;
    if (rawRating !== null && rawRating !== undefined && rawRating !== '') {
      const num = parseFloat(rawRating);
      if (!isNaN(num) && num >= 1 && num <= 5) {
        rating = Math.round(num * 10) / 10;
      }
    }
    const ratingComment = String(parsed.rating_comment || parsed.comment || parsed.review || parsed.note || '').trim() || null;

    let startedAt = new Date();
    const dateStr = parsed.date || parsed.start_time || parsed.call_start || parsed.call_date || parsed.time;
    if (dateStr) {
      const parsedDate = new Date(dateStr);
      if (!isNaN(parsedDate.getTime())) startedAt = parsedDate;
    }
    const callDate = startedAt.toISOString().split('T')[0];

    const saved = await saveCallRecord({
      call_id: callId,
      caller,
      callee,
      operator_number: operatorNumber,
      employee_id: employeeId,
      employee_name: employeeName,
      direction,
      status,
      duration,
      talk_time: talkTime,
      record_url: recordUrl,
      rating,
      rating_comment: ratingComment,
      raw_data: parsed,
      call_date: callDate,
      started_at: startedAt.toISOString()
    });

    console.log(`[OnlinePBX Webhook muvaffaqiyatli saqlandi]: ID=${callId}, Op=${operatorNumber || '—'}, Xodim=${employeeName || '—'}, Yo'nalish=${direction}, Holat=${status}, Suhbat=${talkTime}s`);
    return sendJson(res, 200, {
      ok: true,
      call_id: callId,
      operator: operatorNumber,
      employee: employeeName,
      direction,
      status,
      talk_time: talkTime,
      rating
    });
  } catch (error) {
    console.error('[handleOnlinePbxWebhook xatosi]:', error);
    return sendJson(res, 200, { ok: false, error: error.message });
  }
}

async function handlePbxStats(req, res, reqUrl) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const from = reqUrl.searchParams.get('from') || today;
    const to = reqUrl.searchParams.get('to') || today;
    const operator = reqUrl.searchParams.get('operator') || 'all';
    const status = reqUrl.searchParams.get('status') || 'all';

    // Har safar statistikani olishdan oldin yangi kelgan biriktirilmagan qo'ng'iroqlarni tekshirib avtomatik bog'laymiz
    await relinkAllPbxCalls().catch(() => {});

    const result = await getCallsStats(from, to, operator, status);
    return sendJson(res, 200, result);
  } catch (e) {
    console.error('[handlePbxStats error]:', e);
    return sendJson(res, 500, { ok: false, error: e.message });
  }
}

async function handlePbxCalls(req, res, reqUrl) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const from = reqUrl.searchParams.get('from') || today;
    const to = reqUrl.searchParams.get('to') || today;
    const operator = reqUrl.searchParams.get('operator') || 'all';
    const status = reqUrl.searchParams.get('status') || 'all';
    const limit = reqUrl.searchParams.get('limit') || 50;

    const result = await getCallsList(from, to, operator, status, limit);
    return sendJson(res, 200, result);
  } catch (e) {
    console.error('[handlePbxCalls error]:', e);
    return sendJson(res, 500, { ok: false, error: e.message });
  }
}

async function handlePbxRelink(req, res) {
  try {
    const result = await relinkAllPbxCalls();
    return sendJson(res, 200, result);
  } catch (err) {
    console.error('[handlePbxRelink error]:', err);
    return sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleRatePbxCall(req, res, targetCallId = null) {
  try {
    const body = await readJson(req);
    const callId = targetCallId || body.call_id || body.id;
    const rating = Math.max(1, Math.min(5, parseFloat(body.rating || 5)));
    const comment = String(body.comment || body.rating_comment || '').trim() || null;

    if (!callId) {
      return sendJson(res, 400, { ok: false, error: 'call_id berilmadi' });
    }

    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          'UPDATE public.calls SET rating = $1, rating_comment = $2, updated_at = now() WHERE call_id = $3',
          [rating, comment, callId]
        );
      } catch (e) {
        console.warn('[handleRatePbxCall DB xatosi]:', e.message);
      }
    }

    const list = readLocalCalls();
    const idx = list.findIndex(c => c.call_id === callId);
    if (idx >= 0) {
      list[idx].rating = rating;
      list[idx].rating_comment = comment;
      list[idx].updated_at = new Date().toISOString();
      writeLocalCalls(list);
    }

    return sendJson(res, 200, { ok: true, call_id: callId, rating, comment });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleTestPbxWebhook(req, res) {
  const body = await readJson(req);
  const operator = String(body.operator || body.operator_number || '100').trim();
  const status = body.status === 'missed' ? 'missed' : 'answered';
  const talkTime = status === 'answered' ? (parseInt(body.talk_time, 10) || Math.floor(Math.random() * 180) + 30) : 0;
  const duration = talkTime + Math.floor(Math.random() * 15) + 5;
  const caller = String(body.caller || `+99890${Math.floor(1000000 + Math.random() * 9000000)}`);
  const callee = String(body.callee || '+998712000000');
  const rating = body.rating !== undefined && body.rating !== null ? parseFloat(body.rating) : (status === 'answered' ? 5 : null);

  const testPayload = {
    uuid: `test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    caller,
    callee,
    user: operator,
    status: status === 'answered' ? 'ANSWER' : 'NOANSWER',
    duration,
    billsec: talkTime,
    rating,
    rating_comment: body.comment || (rating ? 'Sinov qo\'ng\'irog\'i bahosi' : null),
    date: new Date().toISOString()
  };

  const mockReq = {
    method: 'POST',
    on: (evt, cb) => {
      if (evt === 'data') cb(JSON.stringify(testPayload));
      if (evt === 'end') cb();
    }
  };

  return handleOnlinePbxWebhook(mockReq, res, new URL('http://localhost/api/onlinepbx/webhook'));
}

// ============================================================
//  PRAYER TIMES API (Namoz vaqtlari - Ishonchli manbalardan)
// ============================================================
let prayerTimesMemoryCache = { date: '', data: null };

async function fetchJsonWithTimeout(url, timeoutMs = 4500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AloqaPro/2.1'
      }
    });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function handlePrayerTimes(req, res, reqUrl) {
  const today = todayISO();
  const region = reqUrl.searchParams.get('region') || 'toshkent-shahri';

  if (prayerTimesMemoryCache.date === today && prayerTimesMemoryCache.data) {
    return sendJson(res, 200, prayerTimesMemoryCache.data);
  }

  // 1-manba: namoz-vaqti.uz (O'zbekiston Musulmonlar idorasi rasmiy taqvimi)
  try {
    const pUrl = `https://www.namoz-vaqti.uz/index.php?region=${encodeURIComponent(region)}&period=today&format=json`;
    const json = await fetchJsonWithTimeout(pUrl, 4500);
    const times = json?.today?.times;
    if (times && times.bomdod && times.peshin && times.asr && times.shom && times.xufton) {
      const payload = {
        ok: true,
        source: 'namoz-vaqti.uz (O‘zbekiston Musulmonlar idorasi)',
        region: json?.meta?.region?.name || 'Toshkent shahri',
        date: today,
        times: {
          fajr: times.bomdod,
          sunrise: times.quyosh,
          dhuhr: times.peshin,
          asr: times.asr,
          maghrib: times.shom,
          isha: times.xufton
        }
      };
      prayerTimesMemoryCache = { date: today, data: payload };
      return sendJson(res, 200, payload);
    }
  } catch (err1) {
    console.warn('[Prayer API 1 xatosi (namoz-vaqti.uz)]:', err1.message);
  }

  // 2-manba: Aladhan API (Xalqaro eng ishonchli 99.9% uptime islomiy API / Hanafi)
  try {
    const aUrl = 'https://api.aladhan.com/v1/timingsByCity?city=Tashkent&country=Uzbekistan&method=3&school=1';
    const json = await fetchJsonWithTimeout(aUrl, 4500);
    const timings = json?.data?.timings;
    if (timings && timings.Fajr && timings.Dhuhr && timings.Asr && timings.Maghrib && timings.Isha) {
      const payload = {
        ok: true,
        source: 'api.aladhan.com (Muslim World League / Hanafi)',
        region: 'Toshkent shahri',
        date: today,
        times: {
          fajr: timings.Fajr.substring(0, 5),
          sunrise: timings.Sunrise.substring(0, 5),
          dhuhr: timings.Dhuhr.substring(0, 5),
          asr: timings.Asr.substring(0, 5),
          maghrib: timings.Maghrib.substring(0, 5),
          isha: timings.Isha.substring(0, 5)
        }
      };
      prayerTimesMemoryCache = { date: today, data: payload };
      return sendJson(res, 200, payload);
    }
  } catch (err2) {
    console.warn('[Prayer API 2 xatosi (aladhan.com)]:', err2.message);
  }

  // Zaxira: Oxirgi muvaffaqiyatli kesh yoki standart Toshkent taqvimi
  if (prayerTimesMemoryCache.data) {
    return sendJson(res, 200, prayerTimesMemoryCache.data);
  }

  return sendJson(res, 200, {
    ok: true,
    source: 'Toshkent taqvimi (Standart)',
    region: 'Toshkent shahri',
    date: today,
    times: {
      fajr: '05:16',
      sunrise: '06:35',
      dhuhr: '12:09',
      asr: '15:59',
      maghrib: '17:46',
      isha: '19:01'
    }
  });
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
  'ubuntu_deploy.md',
  'readme.md',
  '.cleanup_last_run'
]);

// Statik fayllarni xavfsiz tarqatish
function serveStatic(requestPath, res) {
  try {
    let cleanPath = '/';
    try {
      cleanPath = decodeURIComponent(requestPath.split('?')[0]);
    } catch {
      cleanPath = requestPath.split('?')[0];
    }
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
      if (res.writableEnded) return;

      if (err || !stats.isFile()) {
        // index.html fallback SPA uchun
        if (!path.extname(safePath)) {
          return fs.readFile(path.join(ROOT, 'index.html'), (err2, data) => {
            if (res.writableEnded) return;
            if (err2) return sendText(res, 404, 'Sahifa topilmadi');
            try {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(data);
            } catch (_) { }
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

      try {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stats.size,
          'Cache-Control': cacheControl
        });
      } catch (_) {
        return;
      }

      const stream = fs.createReadStream(fullPath);
      stream.on('error', () => {
        stream.destroy();
        if (!res.headersSent && !res.writableEnded) sendText(res, 500, 'Faylni o\'qishda xatolik');
      });
      res.on('close', () => {
        stream.destroy();
      });
      res.on('error', () => {
        stream.destroy();
      });
      stream.pipe(res);
    });
  } catch (err) {
    if (!res.headersSent && !res.writableEnded) sendText(res, 500, 'Ichki server xatosi');
  }
}

function setCors(res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PATCH,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,apikey,x-admin-key');
  } catch (_) { }
}

function sendJson(res, status, payload) {
  try {
    if (res.writableEnded || res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  } catch (_) { }
}

function sendText(res, status, text) {
  try {
    if (res.writableEnded || res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  } catch (_) { }
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
  const pool = getDbPool();
  if (pool) {
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
        await client.query('ROLLBACK').catch(() => { });
        throw sqlErr;
      } finally {
        client.release();
      }
    } catch (err) {
      console.warn('[Tozalash ogohlantirish - PostgreSQL]: Baza xatosi (' + err.message + '). Lokal fayllar tozalanadi.');
    }
  }

  // 2-USUL: Lokal JSON fayllarni tozalash (PostgreSQL mavjud bo'lmaganda)
  try {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
    const cutoffIso = cutoffDate.toISOString();

    const att = readJsonData('attendance.json', []).filter(r => (r.work_date || '') >= cutoffDateStr);
    writeJsonData('attendance.json', att);

    const notifs = readJsonData('notifications.json', []).filter(r => (r.sent_at || '') >= cutoffIso);
    writeJsonData('notifications.json', notifs);

    const fb = readJsonData('feedback.json', []).filter(r => (r.created_at || '') >= cutoffIso);
    writeJsonData('feedback.json', fb);

    const leaves = readJsonData('employee_leaves.json', []).filter(r => (r.return_date || '') >= cutoffDateStr);
    writeJsonData('employee_leaves.json', leaves);

    saveLastCleanupTimestamp();
    const summary = {
      ok: true,
      method: 'local_json_cleanup',
      retention_months: retentionMonths,
      cutoff_date: cutoffDateStr,
      cleaned_at: new Date().toISOString()
    };
    console.log('[Tozalash muvaffaqiyatli - Lokal JSON]:', summary);
    return summary;
  } catch (jsonErr) {
    console.error('[Tozalash xatosi - Lokal JSON]:', jsonErr.message);
    return { ok: false, error: jsonErr.message };
  }
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
  } catch (e) { }
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
      try {
        runRetentionCleanup(false).catch(err => console.warn('[Scheduler ogohlantirish]:', err?.message || err));
      } catch (e) {
        console.warn('[Scheduler ogohlantirish]:', e.message);
      }
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

// ============================================================
//  18:30 AUTO-END & 17:55 REMINDER SCHEDULER (Server-Side)
// ============================================================
let serverSentRemindersToday = {};
let serverAutoEndDoneToday = {};

async function runServerScheduledChecks() {
  try {
    const now = new Date();
    // Toshkent vaqti
    const dStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' }); // YYYY-MM-DD
    const tStr = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Tashkent', hour12: false }); // HH:MM:SS
    const [h, m] = tStr.split(':').map(Number);
    const pool = getDbPool();

    // 1. 17:55 da "Ishni yakunlashni unutmang ⏰" eslatmasi
    if (((h === 17 && m >= 55) || (h === 18 && m < 30)) && !serverSentRemindersToday[dStr]) {
      serverSentRemindersToday[dStr] = true;
      const title = 'AloqaPro | Eslatma';
      const body = 'Ishni yakunlashni unutmang ⏰';

      if (pool) {
        try {
          const res = await pool.query(`
            SELECT DISTINCT a.employee_id 
            FROM public.attendance a
            WHERE a.work_date = $1 AND a.start_time IS NOT NULL AND a.end_time IS NULL
          `, [dStr]);

          if (res.rows && res.rows.length > 0) {
            for (const row of res.rows) {
              await pool.query(`
                INSERT INTO public.notifications (employee_id, title, body, type, created_at)
                VALUES ($1, $2, $3, 'work_end_reminder', now())
              `, [row.employee_id, title, body]);
            }
            console.log(`[AutoEnd Scheduler]: ${res.rows.length} ta xodimga 17:55 ishni yakunlash eslatmasi yuborildi.`);
          }
        } catch (dbErr) {
          console.warn('[AutoEnd Scheduler] 17:55 eslatma xatosi:', dbErr.message);
        }
      } else {
        // Lokal JSON eslatmasi
        const att = readJsonData('attendance.json', []);
        const activeToday = att.filter(r => r.work_date === dStr && r.start_time && !r.end_time);
        if (activeToday.length > 0) {
          const notifs = readJsonData('notifications.json', []);
          activeToday.forEach(r => {
            notifs.unshift({
              id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              employee_id: r.employee_id,
              title,
              body,
              type: 'work_end_reminder',
              is_read: false,
              sent_at: new Date().toISOString()
            });
          });
          writeJsonData('notifications.json', notifs.slice(0, 1000));
        }
      }
    }

    // 2. 18:30 da barcha xodimlarda ishni avtomatik yakunlash
    if ((h > 18 || (h === 18 && m >= 30)) && !serverAutoEndDoneToday[dStr]) {
      serverAutoEndDoneToday[dStr] = true;
      console.log(`[AutoEnd Scheduler]: Soat 18:30 dan o'tdi (${dStr} ${tStr}). Barcha xodimlar ishi avtomatik yakunlanmoqda...`);

      if (pool) {
        try {
          const res = await pool.query(`
            SELECT id, employee_id, start_time, work_seconds, lunch_seconds, late_minutes
            FROM public.attendance
            WHERE work_date = $1 AND start_time IS NOT NULL AND end_time IS NULL
          `, [dStr]);

          if (res.rows && res.rows.length > 0) {
            for (const r of res.rows) {
              let finalWorkSec = Number(r.work_seconds) || 0;
              if (r.start_time) {
                const [sh, sm] = String(r.start_time).split(':').map(Number);
                const startSec = (sh * 3600) + (sm * 60);
                const endSec = (18 * 3600) + (30 * 60); // 18:30:00
                const lunchSec = Number(r.lunch_seconds) || 0;
                const calcSec = Math.max(0, endSec - startSec - lunchSec);
                if (calcSec > finalWorkSec) {
                  finalWorkSec = calcSec;
                }
              }

              await pool.query(`
                UPDATE public.attendance
                SET end_time = '18:30:00',
                    work_seconds = $2,
                    auto_ended = true,
                    updated_at = now()
                WHERE id = $1
              `, [r.id, finalWorkSec]);
            }
            console.log(`[AutoEnd Scheduler]: ${res.rows.length} ta xodimning davomati 18:30 holatiga muvaffaqiyatli yakunlandi.`);
          }
        } catch (dbErr) {
          console.warn('[AutoEnd Scheduler] 18:30 auto-end DB xatosi:', dbErr.message);
        }
      } else {
        // Lokal JSON avtomatik yakunlash
        const att = readJsonData('attendance.json', []);
        let updatedCount = 0;
        att.forEach(r => {
          if (r.work_date === dStr && r.start_time && !r.end_time) {
            r.end_time = '18:30:00';
            r.auto_ended = true;
            r.updated_at = new Date().toISOString();
            updatedCount++;
          }
        });
        if (updatedCount > 0) {
          writeJsonData('attendance.json', att);
          console.log(`[AutoEnd Scheduler - Lokal]: ${updatedCount} ta xodimning davomati 18:30 holatiga yakunlandi.`);
        }
      }
    }
  } catch (err) {
    console.warn('[runServerScheduledChecks] xatolik:', err.message);
  }
}

function initAutoEndScheduler() {
  const timer = setInterval(runServerScheduledChecks, 20000);
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
  setTimeout(runServerScheduledChecks, 2000);
}

// ============================================================
//  ALOQAPRO SERVER MA'LUMOTLAR OMBORI VA API ISHLOVCHILARI
// ============================================================

function readJsonData(filename, defaultVal = []) {
  try {
    const p = path.join(ROOT, 'data', filename);
    if (fs.existsSync(p)) {
      const txt = fs.readFileSync(p, 'utf8');
      return JSON.parse(txt) || defaultVal;
    }
  } catch (e) {
    console.warn(`[readJsonData ${filename}]:`, e.message);
  }
  return defaultVal;
}

function writeJsonData(filename, data) {
  try {
    const dataDir = path.join(ROOT, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, filename), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`[writeJsonData ${filename}]:`, e.message);
    return false;
  }
}

// ============================================================
//  POSTGRESQL TO'G'RIDAN-TO'G'RI REST VA RPC ISHLOVCHILARI
// ============================================================

async function handleDatabaseTableApi(req, res, table, reqUrl) {
  const allowedTables = [
    'admins', 'employees', 'attendance', 'kpi_bonuses', 'settings',
    'notifications', 'feedback', 'lunch_plans', 'employee_leaves', 'face_profiles', 'calls'
  ];
  if (!allowedTables.includes(table)) {
    return sendJson(res, 404, { ok: false, error: `Noma'lum jadval: ${table}` });
  }

  const pool = getDbPool();

  // 1. GET (Select & Filter)
  if (req.method === 'GET') {
    const selectParam = reqUrl.searchParams.get('select') || '*';
    const orderParam = reqUrl.searchParams.get('order');
    const limitParam = reqUrl.searchParams.get('limit');
    const offsetParam = reqUrl.searchParams.get('offset');

    if (pool) {
      try {
        const whereClauses = [];
        const params = [];

        for (const [key, val] of reqUrl.searchParams.entries()) {
          if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
          if (val.startsWith('eq.')) {
            params.push(val.slice(3));
            whereClauses.push(`t."${key}" = $${params.length}`);
          } else if (val.startsWith('neq.')) {
            params.push(val.slice(4));
            whereClauses.push(`t."${key}" != $${params.length}`);
          } else if (val.startsWith('gte.')) {
            params.push(val.slice(4));
            whereClauses.push(`t."${key}" >= $${params.length}`);
          } else if (val.startsWith('lte.')) {
            params.push(val.slice(4));
            whereClauses.push(`t."${key}" <= $${params.length}`);
          } else if (val.startsWith('gt.')) {
            params.push(val.slice(3));
            whereClauses.push(`t."${key}" > $${params.length}`);
          } else if (val.startsWith('lt.')) {
            params.push(val.slice(3));
            whereClauses.push(`t."${key}" < $${params.length}`);
          } else if (val.startsWith('like.')) {
            params.push(val.slice(5));
            whereClauses.push(`t."${key}" LIKE $${params.length}`);
          } else if (val.startsWith('ilike.')) {
            params.push(val.slice(6));
            whereClauses.push(`t."${key}" ILIKE $${params.length}`);
          } else if (val === 'is.null') {
            whereClauses.push(`t."${key}" IS NULL`);
          } else if (val === 'not.is.null') {
            whereClauses.push(`t."${key}" IS NOT NULL`);
          }
        }

        let selectClause = 't.*';
        let joinClause = '';
        if (selectParam.includes('employees(name)')) {
          selectClause = `t.*, json_build_object('name', e.name) AS employees`;
          joinClause = `LEFT JOIN public.employees e ON t.employee_id = e.id`;
        } else if (selectParam !== '*') {
          const cols = selectParam.split(',').map(c => c.trim()).filter(Boolean);
          selectClause = cols.map(c => c.includes('(') ? c : `t."${c}"`).join(', ');
        }

        let query = `SELECT ${selectClause} FROM public."${table}" t ${joinClause}`;
        if (whereClauses.length > 0) {
          query += ` WHERE ${whereClauses.join(' AND ')}`;
        }
        if (orderParam) {
          const [oCol, oDir] = orderParam.split('.');
          const dir = (oDir && oDir.toLowerCase() === 'desc') ? 'DESC' : 'ASC';
          query += ` ORDER BY t."${oCol}" ${dir}`;
        }
        if (limitParam && !isNaN(Number(limitParam))) {
          params.push(Number(limitParam));
          query += ` LIMIT $${params.length}`;
        }
        if (offsetParam && !isNaN(Number(offsetParam))) {
          params.push(Number(offsetParam));
          query += ` OFFSET $${params.length}`;
        }

        const dbRes = await pool.query(query, params);
        return sendJson(res, 200, { ok: true, data: dbRes.rows || [] });
      } catch (err) {
        console.warn(`[handleDatabaseTableApi GET ${table} DB xatosi]:`, err.message);
      }
    }

    // Local JSON fallback
    let list = readJsonData(`${table}.json`, []);
    for (const [key, val] of reqUrl.searchParams.entries()) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
      if (val.startsWith('eq.')) {
        const target = val.slice(3);
        list = list.filter(item => String(item[key] ?? '') === target);
      } else if (val.startsWith('neq.')) {
        const target = val.slice(4);
        list = list.filter(item => String(item[key] ?? '') !== target);
      } else if (val.startsWith('gte.')) {
        const target = val.slice(4);
        list = list.filter(item => (item[key] ?? '') >= target);
      } else if (val.startsWith('lte.')) {
        const target = val.slice(4);
        list = list.filter(item => (item[key] ?? '') <= target);
      } else if (val === 'is.null') {
        list = list.filter(item => item[key] == null);
      } else if (val === 'not.is.null') {
        list = list.filter(item => item[key] != null);
      }
    }

    if (orderParam) {
      const [oCol, oDir] = orderParam.split('.');
      const isDesc = oDir && oDir.toLowerCase() === 'desc';
      list.sort((a, b) => {
        const valA = a[oCol] ?? '';
        const valB = b[oCol] ?? '';
        if (valA < valB) return isDesc ? 1 : -1;
        if (valA > valB) return isDesc ? -1 : 1;
        return 0;
      });
    }

    if (offsetParam && !isNaN(Number(offsetParam))) {
      list = list.slice(Number(offsetParam));
    }
    if (limitParam && !isNaN(Number(limitParam))) {
      list = list.slice(0, Number(limitParam));
    }

    return sendJson(res, 200, { ok: true, data: list });
  }

  // 2. POST (Insert / Upsert)
  if (req.method === 'POST') {
    const rawBody = await readJson(req);
    const rows = Array.isArray(rawBody) ? rawBody : [rawBody];
    const onConflict = reqUrl.searchParams.get('on_conflict');
    const insertedRows = [];

    if (pool) {
      try {
        for (const item of rows) {
          const keys = Object.keys(item).filter(k => item[k] !== undefined);
          if (keys.length === 0) continue;

          // Dublikatlarni tekshirish (feedback va notifications uchun)
          if (table === 'feedback' && item.employee_id && item.message) {
            const dup = await pool.query(
              `SELECT * FROM public.feedback WHERE employee_id = $1 AND message = $2 AND created_at > (now() - interval '10 seconds') LIMIT 1`,
              [item.employee_id, String(item.message).trim()]
            ).catch(() => ({ rows: [] }));
            if (dup.rows && dup.rows.length > 0) {
              insertedRows.push(dup.rows[0]);
              continue;
            }
          }
          if (table === 'notifications' && item.employee_id && item.title && item.body) {
            const dup = await pool.query(
              `SELECT * FROM public.notifications WHERE employee_id = $1 AND title = $2 AND body = $3 AND sent_at > (now() - interval '10 seconds') LIMIT 1`,
              [item.employee_id, item.title, item.body]
            ).catch(() => ({ rows: [] }));
            if (dup.rows && dup.rows.length > 0) {
              insertedRows.push(dup.rows[0]);
              continue;
            }
          }

          let query = '';
          const params = keys.map(k => {
            const v = item[k];
            if (typeof v === 'object' && v !== null && (table === 'face_profiles' || k === 'descriptor' || k === 'raw_data')) {
              return JSON.stringify(v);
            }
            return v;
          });

          if (onConflict) {
            const conflictCols = onConflict.split(',').map(c => c.trim());
            const updateCols = keys.filter(k => !conflictCols.includes(k));
            const updateSet = updateCols.map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');
            query = `
              INSERT INTO public."${table}" (${keys.map(k => `"${k}"`).join(', ')})
              VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
              ON CONFLICT (${conflictCols.map(c => `"${c}"`).join(', ')})
              DO UPDATE SET ${updateSet || `"${conflictCols[0]}" = EXCLUDED."${conflictCols[0]}"`}
              RETURNING *;
            `;
          } else {
            query = `
              INSERT INTO public."${table}" (${keys.map(k => `"${k}"`).join(', ')})
              VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
              RETURNING *;
            `;
          }
          const resDb = await pool.query(query, params);
          if (resDb.rows && resDb.rows[0]) insertedRows.push(resDb.rows[0]);
        }
      } catch (err) {
        console.warn(`[handleDatabaseTableApi POST ${table} DB xatosi]:`, err.message);
      }
    }

    // Local JSON update
    const currentList = readJsonData(`${table}.json`, []);
    for (const item of rows) {
      if (table === 'feedback' && item.employee_id && item.message) {
        const localDup = currentList.find(f => f.employee_id === item.employee_id && f.message === item.message && Date.now() - new Date(f.created_at).getTime() < 10000);
        if (localDup) continue;
      }
      if (table === 'notifications' && item.employee_id && item.title && item.body) {
        const localDup = currentList.find(n => n.employee_id === item.employee_id && n.title === item.title && n.body === item.body && Date.now() - new Date(n.sent_at).getTime() < 10000);
        if (localDup) continue;
      }

      if (!item.id && !item.employee_id) {
        item.id = `${table}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      }
      let foundIdx = -1;
      if (onConflict) {
        const conflictCols = onConflict.split(',').map(c => c.trim());
        foundIdx = currentList.findIndex(entry => conflictCols.every(c => entry[c] === item[c]));
      } else if (item.id) {
        foundIdx = currentList.findIndex(entry => entry.id === item.id);
      }

      if (foundIdx >= 0) {
        currentList[foundIdx] = { ...currentList[foundIdx], ...item, updated_at: new Date().toISOString() };
      } else {
        currentList.push({ ...item, created_at: item.created_at || new Date().toISOString() });
      }
    }
    writeJsonData(`${table}.json`, currentList);

    return sendJson(res, 200, { ok: true, data: insertedRows.length > 0 ? insertedRows : rows });
  }

  // 3. PATCH (Update)
  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const updateKeys = Object.keys(body).filter(k => body[k] !== undefined);
    const updatedRows = [];

    if (pool && updateKeys.length > 0) {
      try {
        const setClauses = updateKeys.map((k, i) => `"${k}" = $${i + 1}`);
        const params = updateKeys.map(k => body[k]);
        const whereClauses = [];

        for (const [key, val] of reqUrl.searchParams.entries()) {
          if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
          if (val.startsWith('eq.')) {
            params.push(val.slice(3));
            whereClauses.push(`"${key}" = $${params.length}`);
          }
        }

        let query = `UPDATE public."${table}" SET ${setClauses.join(', ')}`;
        if (whereClauses.length > 0) {
          query += ` WHERE ${whereClauses.join(' AND ')}`;
        }
        query += ' RETURNING *;';

        const dbRes = await pool.query(query, params);
        if (dbRes.rows) updatedRows.push(...dbRes.rows);
      } catch (err) {
        console.warn(`[handleDatabaseTableApi PATCH ${table} DB xatosi]:`, err.message);
      }
    }

    // Local JSON update
    const currentList = readJsonData(`${table}.json`, []);
    for (const item of currentList) {
      let match = true;
      for (const [key, val] of reqUrl.searchParams.entries()) {
        if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
        if (val.startsWith('eq.') && String(item[key] ?? '') !== val.slice(3)) {
          match = false;
          break;
        }
      }
      if (match) {
        Object.assign(item, body, { updated_at: new Date().toISOString() });
        if (updatedRows.length === 0) updatedRows.push(item);
      }
    }
    writeJsonData(`${table}.json`, currentList);

    return sendJson(res, 200, { ok: true, data: updatedRows });
  }

  // 4. DELETE
  if (req.method === 'DELETE') {
    const deletedRows = [];
    if (pool) {
      try {
        const whereClauses = [];
        const params = [];
        for (const [key, val] of reqUrl.searchParams.entries()) {
          if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
          if (val.startsWith('eq.')) {
            params.push(val.slice(3));
            whereClauses.push(`"${key}" = $${params.length}`);
          }
        }
        let query = `DELETE FROM public."${table}"`;
        if (whereClauses.length > 0) {
          query += ` WHERE ${whereClauses.join(' AND ')}`;
        }
        query += ' RETURNING *;';
        const dbRes = await pool.query(query, params);
        if (dbRes.rows) deletedRows.push(...dbRes.rows);
      } catch (err) {
        console.warn(`[handleDatabaseTableApi DELETE ${table} DB xatosi]:`, err.message);
      }
    }

    // Local JSON delete
    let currentList = readJsonData(`${table}.json`, []);
    currentList = currentList.filter(item => {
      for (const [key, val] of reqUrl.searchParams.entries()) {
        if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
        if (val.startsWith('eq.') && String(item[key] ?? '') === val.slice(3)) {
          return false;
        }
      }
      return true;
    });
    writeJsonData(`${table}.json`, currentList);

    return sendJson(res, 200, { ok: true, data: deletedRows });
  }

  return sendJson(res, 405, { ok: false, error: 'Usul qo\'llab-quvvatlanmaydi' });
}

// Database RPC API (Stored procedures)
async function handleDatabaseRpcApi(req, res, func) {
  const body = await readJson(req);
  const pool = getDbPool();

  if (func === 'admin_attendance_range') {
    const pFrom = body.p_from || todayISO();
    const pTo = body.p_to || todayISO();
    const pSearch = body.p_search || '';
    const pStatus = body.p_status || '';

    if (pool) {
      try {
        const r = await pool.query(
          'SELECT * FROM public.admin_attendance_range($1, $2, $3, $4)',
          [pFrom, pTo, pSearch, pStatus]
        );
        return sendJson(res, 200, { ok: true, data: r.rows || [] });
      } catch (err) {
        console.warn('[handleDatabaseRpcApi admin_attendance_range DB]:', err.message);
      }
    }

    // Local fallback for admin_attendance_range
    const emps = readJsonData('employees.json', []).filter(e => e.active !== false);
    const attendance = readJsonData('attendance.json', []);
    const results = [];

    emps.forEach(emp => {
      if (pSearch) {
        const s = pSearch.toLowerCase();
        const matchName = String(emp.name || '').toLowerCase().includes(s);
        const matchLogin = String(emp.login || '').toLowerCase().includes(s);
        if (!matchName && !matchLogin) return;
      }
      const rec = attendance.find(a => a.employee_id === emp.id && a.work_date >= pFrom && a.work_date <= pTo);
      if (pStatus && (!rec || rec.status !== pStatus)) return;

      results.push({
        employee_id: emp.id,
        employee_name: emp.name,
        employee_login: emp.login,
        name: emp.name,
        login: emp.login,
        work_date: rec?.work_date || pFrom,
        start_time: rec?.start_time || null,
        end_time: rec?.end_time || null,
        lunch_start: rec?.lunch_start || null,
        lunch_end: rec?.lunch_end || null,
        late_minutes: Number(rec?.late_minutes) || 0,
        worked_seconds: Number(rec?.work_seconds || rec?.worked_seconds) || 0,
        work_seconds: Number(rec?.work_seconds || rec?.worked_seconds) || 0,
        afk_seconds: Number(rec?.afk_seconds) || 0,
        status: rec?.status || 'kelmadi'
      });
    });

    return sendJson(res, 200, { ok: true, data: results });
  }

  return sendJson(res, 404, { ok: false, error: `Noma'lum funksiya: ${func}` });
}

// 1. LOGIN API
async function handleApiLogin(req, res) {
  const body = await readJson(req);
  const email = String(body.email || body.login || '').trim().toLowerCase();
  const password = String(body.password || '').trim();

  if (!email || !password) {
    return sendJson(res, 400, { ok: false, error: 'Email va parol kiritilishi shart' });
  }

  const isKnownAdmin = (val) => {
    const l = String(val || '').trim().toLowerCase();
    return l === 'admin' ||
      l === 'admin@aloqapro.uz' ||
      l === 'umirbekovdiyorbek@gmail.com' ||
      l.startsWith('admin@') ||
      l.includes('admin');
  };

  const pool = getDbPool();
  const admins = readJsonData('admins.json', []);
  const employees = readJsonData('employees.json', []);

  // 1-bosqich: Administrator tekshirish (PostgreSQL & Lokal JSON & Tizim adminlari)
  // Barcha admin tekshiruvlari xodimlardan OLDIN bajariladi!
  if (pool) {
    try {
      const adminRes = await pool.query(
        `SELECT * FROM public.admins 
         WHERE LOWER(login) = $1 
            OR LOWER(name) = $1 
            OR ($1 = 'admin' AND LOWER(login) LIKE 'admin%')
            OR ($1 = 'admin@aloqapro.uz' AND (LOWER(login) = 'admin' OR LOWER(login) = 'admin@aloqapro.uz'))
            OR ($1 = 'umirbekovdiyorbek@gmail.com' AND LOWER(login) = 'umirbekovdiyorbek@gmail.com')
         LIMIT 1`,
        [email]
      );
      if (adminRes.rows && adminRes.rows.length > 0) {
        const adm = adminRes.rows[0];
        return sendJson(res, 200, { ok: true, user: { ...adm, role: 'admin' } });
      }
    } catch (dbErr) {
      console.warn('[handleApiLogin DB admin xatosi]:', dbErr.message);
    }
  }

  // Lokal admins.json tekshirish
  const admMatch = admins.find(a => {
    const l = String(a.login || a.email || '').toLowerCase();
    return l === email ||
      (email === 'admin' && (l === 'admin' || l === 'admin@aloqapro.uz' || l.startsWith('admin@'))) ||
      (email === 'admin@aloqapro.uz' && (l === 'admin' || l === 'admin@aloqapro.uz')) ||
      (email === 'umirbekovdiyorbek@gmail.com' && l === 'umirbekovdiyorbek@gmail.com');
  });
  if (admMatch) {
    return sendJson(res, 200, { ok: true, user: { ...admMatch, role: 'admin' } });
  }

  // Tizim adminlari fallback
  if (isKnownAdmin(email)) {
    const defaultAdmin = {
      id: 'admin_' + email.replace(/[^a-z0-9]/g, '_'),
      user_id: 'admin_root',
      name: email === 'umirbekovdiyorbek@gmail.com' ? 'Administrator (Diyorbek)' : 'Bosh Administrator',
      login: email,
      role: 'admin'
    };
    if (!admins.some(a => String(a.login || '').toLowerCase() === email)) {
      admins.push(defaultAdmin);
      writeJsonData('admins.json', admins);
    }
    return sendJson(res, 200, { ok: true, user: defaultAdmin });
  }

  // 2-bosqich: Xodim tekshirish (PostgreSQL & JSON)
  if (pool) {
    try {
      const empRes = await pool.query(
        'SELECT * FROM public.employees WHERE LOWER(login) = $1 AND active = true LIMIT 1',
        [email]
      );
      if (empRes.rows && empRes.rows.length > 0) {
        const emp = empRes.rows[0];
        if (!emp.password || emp.password === password) {
          return sendJson(res, 200, {
            ok: true,
            user: { ...emp, role: 'employee' },
            token: 'local_token_' + Date.now()
          });
        }
      }
    } catch (dbErr) {
      console.warn('[handleApiLogin DB xodim xatosi]:', dbErr.message);
    }
  }

  const empMatch = employees.find(e => String(e.login || e.email || '').toLowerCase() === email && e.active !== false);
  if (empMatch) {
    if (!empMatch.password || empMatch.password === password) {
      return sendJson(res, 200, {
        ok: true,
        user: { ...empMatch, role: 'employee' },
        token: 'local_token_' + Date.now()
      });
    }
  }

  return sendJson(res, 401, { ok: false, error: 'Login yoki parol noto\'g\'ri' });
}

// 2. ATTENDANCE (Davomat)
async function handleGetAttendance(req, res, reqUrl) {
  const from = reqUrl.searchParams.get('from');
  const to = reqUrl.searchParams.get('to');
  const month = reqUrl.searchParams.get('month');
  const employeeId = reqUrl.searchParams.get('employee_id');

  const pool = getDbPool();
  if (pool) {
    try {
      // Kunlik ko'rinish (from === to va employeeId ko'rsatilmagan): Barcha faol xodimlar LEFT JOIN qilinadi
      if (from && to && from === to && !employeeId) {
        const dailyQuery = `
          SELECT
            e.id AS employee_id,
            e.name AS employee_name,
            e.login AS employee_login,
            e.operator_number,
            COALESCE(a.work_date, $1::date) AS work_date,
            a.start_time,
            a.end_time,
            a.lunch_start,
            a.lunch_end,
            COALESCE(a.late_minutes, 0)::int AS late_minutes,
            COALESCE(a.work_seconds, 0)::int AS worked_seconds,
            COALESCE(a.work_seconds, 0)::int AS work_seconds,
            COALESCE(a.afk_seconds, 0)::int AS afk_seconds,
            COALESCE(a.afk_count, 0)::int AS afk_count,
            COALESCE(a.status, 'kelmadi') AS status,
            COALESCE(a.auto_ended, false) AS auto_ended
          FROM public.employees e
          LEFT JOIN public.attendance a
            ON a.employee_id = e.id AND a.work_date = $1::date
          WHERE e.active = true
          ORDER BY e.name ASC;
        `;
        const dbRes = await pool.query(dailyQuery, [from]);
        return sendJson(res, 200, { ok: true, data: dbRes.rows || [] });
      }

      let query = `
        SELECT a.*,
          e.name AS employee_name,
          e.login AS employee_login,
          e.operator_number,
          COALESCE(a.work_seconds, 0)::int AS worked_seconds
        FROM public.attendance a
        LEFT JOIN public.employees e ON a.employee_id = e.id
        WHERE 1=1
      `;
      const params = [];
      if (employeeId) {
        params.push(employeeId);
        query += ` AND a.employee_id = $${params.length}`;
      }
      if (month) {
        params.push(`${month}-%`);
        query += ` AND a.work_date::text LIKE $${params.length}`;
      }
      if (from) {
        params.push(from);
        query += ` AND a.work_date >= $${params.length}`;
      }
      if (to) {
        params.push(to);
        query += ` AND a.work_date <= $${params.length}`;
      }
      query += ' ORDER BY a.work_date ASC, a.start_time ASC';

      const dbRes = await pool.query(query, params);
      return sendJson(res, 200, { ok: true, data: dbRes.rows || [] });
    } catch (err) {
      console.warn('[handleGetAttendance DB]:', err.message);
    }
  }

  // Fallback: local attendance.json va employees.json
  const emps = readJsonData('employees.json', []);
  const activeEmps = emps.filter(e => e.active !== false);
  const empMap = new Map(emps.map(e => [e.id, e]));
  let list = readJsonData('attendance.json', []);

  // Kunlik ko'rinish (from === to va employeeId ko'rsatilmagan): Barcha faol xodimlar ko'rsatiladi
  if (from && to && from === to && !employeeId) {
    const dayList = list.filter(r => r.work_date === from);
    const dayMap = new Map(dayList.map(r => [r.employee_id, r]));

    const result = activeEmps.map(e => {
      const rec = dayMap.get(e.id);
      if (rec) {
        return {
          ...rec,
          employee_id: e.id,
          employee_name: rec.employee_name || e.name || '—',
          employee_login: rec.employee_login || e.login || '',
          operator_number: rec.operator_number || e.operator_number || null,
          work_date: from,
          start_time: rec.start_time || null,
          end_time: rec.end_time || null,
          lunch_start: rec.lunch_start || null,
          lunch_end: rec.lunch_end || null,
          late_minutes: Number(rec.late_minutes) || 0,
          worked_seconds: Number(rec.work_seconds || rec.worked_seconds) || 0,
          work_seconds: Number(rec.work_seconds || rec.worked_seconds) || 0,
          afk_seconds: Number(rec.afk_seconds) || 0,
          afk_count: Number(rec.afk_count) || 0,
          status: rec.status || 'kelmadi',
          auto_ended: Boolean(rec.auto_ended)
        };
      }
      return {
        id: `att_abs_${e.id}_${from}`,
        employee_id: e.id,
        employee_name: e.name || '—',
        employee_login: e.login || '',
        operator_number: e.operator_number || null,
        work_date: from,
        start_time: null,
        end_time: null,
        lunch_start: null,
        lunch_end: null,
        late_minutes: 0,
        worked_seconds: 0,
        work_seconds: 0,
        afk_seconds: 0,
        afk_count: 0,
        status: 'kelmadi',
        auto_ended: false
      };
    });

    result.sort((a, b) => String(a.employee_name || '').localeCompare(String(b.employee_name || '')));
    return sendJson(res, 200, { ok: true, data: result });
  }

  if (employeeId) list = list.filter(r => r.employee_id === employeeId);
  if (month) list = list.filter(r => String(r.work_date || '').startsWith(month));
  if (from) list = list.filter(r => String(r.work_date || '') >= from);
  if (to) list = list.filter(r => String(r.work_date || '') <= to);

  const mapped = list.map(r => {
    const e = empMap.get(r.employee_id) || {};
    return {
      ...r,
      employee_name: r.employee_name || e.name || '—',
      employee_login: r.employee_login || e.login || '',
      operator_number: r.operator_number || e.operator_number || null,
      worked_seconds: Number(r.work_seconds || r.worked_seconds) || 0,
      work_seconds: Number(r.work_seconds || r.worked_seconds) || 0
    };
  });

  return sendJson(res, 200, { ok: true, data: mapped });
}

async function handleSaveAttendance(req, res) {
  const body = await readJson(req);
  const employeeId = body.employee_id;
  const workDate = body.work_date || todayISO();

  if (!employeeId) {
    return sendJson(res, 400, { ok: false, error: 'employee_id kiritilishi shart' });
  }

  const payload = {
    employee_id: employeeId,
    work_date: workDate,
    start_time: body.start_time || null,
    end_time: body.end_time || null,
    lunch_start: body.lunch_start || null,
    lunch_end: body.lunch_end || null,
    work_seconds: Number(body.work_seconds || body.worked_seconds) || 0,
    worked_seconds: Number(body.work_seconds || body.worked_seconds) || 0,
    lunch_seconds: Number(body.lunch_seconds) || 0,
    afk_seconds: Number(body.afk_seconds) || 0,
    afk_count: Number(body.afk_count) || 0,
    late_minutes: Number(body.late_minutes) || 0,
    status: body.status || 'kelmadi',
    auto_ended: Boolean(body.auto_ended),
    updated_at: new Date().toISOString()
  };

  const emps = readJsonData('employees.json', []);
  const emp = emps.find(e => e.id === employeeId);
  if (emp) {
    payload.employee_name = emp.name || '';
    payload.employee_login = emp.login || '';
    payload.operator_number = emp.operator_number || emp.pbx_extension || null;
  }

  // 1. PostgreSQL ga yozish
  const pool = getDbPool();
  if (pool) {
    try {
      const q = `
        INSERT INTO public.attendance (
          employee_id, work_date, start_time, end_time, lunch_start, lunch_end,
          work_seconds, lunch_seconds, afk_seconds, afk_count, late_minutes, status, auto_ended, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
        ON CONFLICT (employee_id, work_date) DO UPDATE SET
          start_time = COALESCE(EXCLUDED.start_time, public.attendance.start_time),
          end_time = COALESCE(EXCLUDED.end_time, public.attendance.end_time),
          lunch_start = COALESCE(EXCLUDED.lunch_start, public.attendance.lunch_start),
          lunch_end = COALESCE(EXCLUDED.lunch_end, public.attendance.lunch_end),
          work_seconds = GREATEST(EXCLUDED.work_seconds, public.attendance.work_seconds),
          lunch_seconds = GREATEST(EXCLUDED.lunch_seconds, public.attendance.lunch_seconds),
          afk_seconds = GREATEST(EXCLUDED.afk_seconds, public.attendance.afk_seconds),
          afk_count = GREATEST(EXCLUDED.afk_count, public.attendance.afk_count),
          late_minutes = EXCLUDED.late_minutes,
          status = EXCLUDED.status,
          auto_ended = EXCLUDED.auto_ended,
          updated_at = now()
        RETURNING *;
      `;
      const result = await pool.query(q, [
        payload.employee_id,
        payload.work_date,
        payload.start_time,
        payload.end_time,
        payload.lunch_start,
        payload.lunch_end,
        payload.work_seconds,
        payload.lunch_seconds,
        payload.afk_seconds,
        payload.afk_count,
        payload.late_minutes,
        payload.status,
        payload.auto_ended
      ]);
      if (result.rows && result.rows[0]) {
        Object.assign(payload, result.rows[0]);
      }
    } catch (dbErr) {
      console.warn('[handleSaveAttendance DB xatosi]:', dbErr.message);
    }
  }

  // 2. Local JSON omboriga har doim yozish (to'liq ishonchlilik)
  const list = readJsonData('attendance.json', []);
  const idx = list.findIndex(r => r.employee_id === payload.employee_id && r.work_date === payload.work_date);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...payload };
  } else {
    payload.id = payload.id || `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    list.push(payload);
  }
  writeJsonData('attendance.json', list);

  return sendJson(res, 200, { ok: true, data: payload });
}

// 3. EMPLOYEES
async function handleGetEmployees(req, res, reqUrl) {
  const activeOnly = reqUrl.searchParams.get('active_only') !== 'false';
  const pool = getDbPool();
  if (pool) {
    try {
      const q = activeOnly
        ? 'SELECT * FROM public.employees WHERE active = true ORDER BY name ASC'
        : 'SELECT * FROM public.employees ORDER BY name ASC';
      const r = await pool.query(q);
      return sendJson(res, 200, { ok: true, data: r.rows || [] });
    } catch (e) {
      console.warn('[handleGetEmployees DB]:', e.message);
    }
  }

  let list = readJsonData('employees.json', []);
  if (activeOnly) list = list.filter(e => e.active !== false);
  list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return sendJson(res, 200, { ok: true, data: list });
}

async function handleCreateEmployeeApi(req, res) {
  const body = await readJson(req);
  return handleCreateEmployee(res, body);
}

async function handleUpdateEmployeeApi(req, res) {
  const body = await readJson(req);
  const id = body.id || body.employee_id;
  if (!id) return sendJson(res, 400, { ok: false, error: 'id berilmadi' });
  return handleUpdateEmployeeByIdApi(req, res, id, body);
}

async function handleUpdateEmployeeByIdApi(req, res, empId, preBody = null) {
  const body = preBody || await readJson(req);
  const pool = getDbPool();

  if (body.active === false) {
    body.operator_number = null;
    body.pbx_extension = null;
  }

  const opVal = String(body.operator_number || body.pbx_extension || '').trim() || null;

  if (pool) {
    try {
      // Agar operator raqami berilgan bo'lsa, boshqa xodimlardan bo'shatamiz
      if (opVal) {
        await pool.query(
          'UPDATE public.employees SET operator_number = NULL, pbx_extension = NULL WHERE (operator_number = $1 OR pbx_extension = $1) AND id <> $2',
          [opVal, empId]
        );
      }

      const fields = [];
      const values = [];
      const allowed = ['name', 'login', 'kpi_type', 'operator_number', 'pbx_extension', 'active', 'face_registered'];
      allowed.forEach(k => {
        if (body[k] !== undefined) {
          values.push(body[k]);
          fields.push(`${k} = $${values.length}`);
        }
      });
      if (fields.length > 0) {
        values.push(empId);
        await pool.query(`UPDATE public.employees SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length}`);
      }

      // Agar operator yoki ism o'zgargan bo'lsa, calls jadvalini ham yangilaymiz
      if (opVal && body.name) {
        await pool.query(
          'UPDATE public.calls SET employee_id = $1, employee_name = $2, updated_at = now() WHERE operator_number = $3',
          [empId, body.name, opVal]
        ).catch(() => {});
      }

      if (body.operator_number !== undefined || body.pbx_extension !== undefined || body.active !== undefined || body.name !== undefined) {
        await relinkAllPbxCalls().catch(() => {});
      }
    } catch (e) {
      console.warn('[handleUpdateEmployeeByIdApi DB]:', e.message);
    }
  }

  const list = readJsonData('employees.json', []);
  const idx = list.findIndex(e => e.id === empId);
  if (idx >= 0) {
    if (opVal) {
      list.forEach(e => {
        if (e.id !== empId && (e.operator_number === opVal || e.pbx_extension === opVal)) {
          e.operator_number = null;
          e.pbx_extension = null;
        }
      });
    }
    list[idx] = { ...list[idx], ...body, updated_at: new Date().toISOString() };
    writeJsonData('employees.json', list);
    if (body.operator_number !== undefined || body.pbx_extension !== undefined || body.active !== undefined || body.name !== undefined) {
      await relinkAllPbxCalls().catch(() => {});
    }
    return sendJson(res, 200, { ok: true, employee: list[idx] });
  }

  return sendJson(res, 200, { ok: true });
}

async function handleDeleteEmployeeByIdApi(req, res, empId) {
  return handleDeleteEmployee(res, { employee_id: empId });
}

// 4. ADMINS
async function handleGetAdmins(req, res) {
  const pool = getDbPool();
  if (pool) {
    try {
      const r = await pool.query('SELECT id, user_id, name, login, active FROM public.admins WHERE active = true');
      return sendJson(res, 200, { ok: true, data: r.rows || [] });
    } catch (e) {
      console.warn('[handleGetAdmins DB]:', e.message);
    }
  }
  const admins = readJsonData('admins.json', []);
  return sendJson(res, 200, { ok: true, data: admins });
}

// 5. SETTINGS
async function handleGetSettings(req, res, reqUrl) {
  const key = reqUrl.searchParams.get('key');
  const pool = getDbPool();
  if (pool) {
    try {
      if (key) {
        const r = await pool.query('SELECT key, value FROM public.settings WHERE key = $1 LIMIT 1', [key]);
        return sendJson(res, 200, { ok: true, data: r.rows[0] || null });
      }
      const r = await pool.query('SELECT key, value FROM public.settings');
      return sendJson(res, 200, { ok: true, data: r.rows || [] });
    } catch (e) {
      console.warn('[handleGetSettings DB]:', e.message);
    }
  }

  const settings = readJsonData('settings.json', []);
  if (key) {
    const item = settings.find(s => s.key === key) || null;
    return sendJson(res, 200, { ok: true, data: item });
  }
  return sendJson(res, 200, { ok: true, data: settings });
}

async function handleSaveSettings(req, res) {
  const body = await readJson(req);
  const key = body.key;
  const value = typeof body.value === 'object' ? JSON.stringify(body.value) : String(body.value || '');

  if (!key) return sendJson(res, 400, { ok: false, error: 'key berilmadi' });

  const pool = getDbPool();
  if (pool) {
    try {
      await pool.query(
        'INSERT INTO public.settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
        [key, value]
      );
    } catch (e) {
      console.warn('[handleSaveSettings DB]:', e.message);
    }
  }

  const list = readJsonData('settings.json', []);
  const idx = list.findIndex(s => s.key === key);
  if (idx >= 0) list[idx] = { key, value, updated_at: new Date().toISOString() };
  else list.push({ key, value, created_at: new Date().toISOString() });
  writeJsonData('settings.json', list);

  return sendJson(res, 200, { ok: true, key, value });
}

// 6. NOTIFICATIONS
async function handleGetNotifications(req, res, reqUrl) {
  const employeeId = reqUrl.searchParams.get('employee_id');
  const limit = Math.min(100, parseInt(reqUrl.searchParams.get('limit') || 30, 10));

  const pool = getDbPool();
  if (pool) {
    try {
      let q = 'SELECT n.*, e.name AS employee_name FROM public.notifications n LEFT JOIN public.employees e ON n.employee_id = e.id WHERE 1=1';
      const params = [];
      if (employeeId) {
        params.push(employeeId);
        q += ` AND n.employee_id = $${params.length}`;
      }
      params.push(limit);
      q += ` ORDER BY n.sent_at DESC LIMIT $${params.length}`;
      const r = await pool.query(q, params);
      return sendJson(res, 200, { ok: true, data: r.rows || [] });
    } catch (e) {
      console.warn('[handleGetNotifications DB]:', e.message);
    }
  }

  let list = readJsonData('notifications.json', []);
  const emps = readJsonData('employees.json', []);
  const empMap = new Map(emps.map(e => [e.id, e.name]));

  if (employeeId) list = list.filter(n => n.employee_id === employeeId);
  list.sort((a, b) => new Date(b.sent_at || 0) - new Date(a.sent_at || 0));

  const mapped = list.slice(0, limit).map(n => ({
    ...n,
    employee_name: empMap.get(n.employee_id) || '—'
  }));

  return sendJson(res, 200, { ok: true, data: mapped });
}

async function handleCreateNotification(req, res) {
  const body = await readJson(req);
  const items = Array.isArray(body) ? body : [body];

  const pool = getDbPool();
  const created = [];
  const list = readJsonData('notifications.json', []);
  const tenSecAgo = Date.now() - 10000;

  for (const item of items) {
    const employeeId = item.employee_id || null;
    const title = item.title || 'AloqaPro';
    const bodyText = item.body || '';
    const type = item.type || 'admin';

    // 10 soniya ichida aynan shu xodimga bir xil sarlavha va matn bilan bildirishnoma kelgan bo'lsa
    if (pool && employeeId) {
      try {
        const dup = await pool.query(
          `SELECT * FROM public.notifications
           WHERE employee_id = $1 AND title = $2 AND body = $3 AND sent_at > (now() - interval '10 seconds')
           ORDER BY sent_at DESC LIMIT 1`,
          [employeeId, title, bodyText]
        );
        if (dup.rows && dup.rows.length > 0) {
          created.push(dup.rows[0]);
          continue;
        }
      } catch (e) {}
    }

    const localDup = list.find(n => n.employee_id === employeeId && n.title === title && n.body === bodyText && new Date(n.sent_at).getTime() > tenSecAgo);
    if (localDup) {
      created.push(localDup);
      continue;
    }

    const notif = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      employee_id: employeeId,
      title,
      body: bodyText,
      type,
      is_read: false,
      sent_at: new Date().toISOString()
    };

    if (pool) {
      try {
        const r = await pool.query(
          'INSERT INTO public.notifications (employee_id, title, body, type, is_read, sent_at) VALUES ($1, $2, $3, $4, false, now()) RETURNING *',
          [notif.employee_id, notif.title, notif.body, notif.type]
        );
        if (r.rows && r.rows[0]) Object.assign(notif, r.rows[0]);
      } catch (e) {
        console.warn('[handleCreateNotification DB]:', e.message);
      }
    }
    created.push(notif);
  }

  list.unshift(...created);
  writeJsonData('notifications.json', list.slice(0, 1000));

  return sendJson(res, 200, { ok: true, data: created });
}

async function handleMarkNotificationRead(req, res, notifId) {
  const pool = getDbPool();
  if (pool) {
    try {
      await pool.query('UPDATE public.notifications SET is_read = true WHERE id = $1', [notifId]);
    } catch (e) { }
  }
  const list = readJsonData('notifications.json', []);
  const item = list.find(n => n.id === notifId);
  if (item) {
    item.is_read = true;
    writeJsonData('notifications.json', list);
  }
  return sendJson(res, 200, { ok: true });
}

// 7. FEEDBACK
async function handleGetFeedback(req, res, reqUrl) {
  const employeeId = reqUrl.searchParams.get('employee_id');
  const filter = reqUrl.searchParams.get('filter');
  const pool = getDbPool();

  if (pool) {
    try {
      let q = 'SELECT f.*, e.name AS employee_name FROM public.feedback f LEFT JOIN public.employees e ON f.employee_id = e.id WHERE 1=1';
      const params = [];
      if (employeeId) {
        params.push(employeeId);
        q += ` AND f.employee_id = $${params.length}`;
      }
      if (filter === 'new') q += " AND f.status = 'new'";
      if (filter === 'replied') q += " AND f.status = 'replied'";
      if (filter === 'complaint') q += " AND f.type = 'complaint'";
      if (filter === 'suggestion') q += " AND f.type = 'suggestion'";
      q += ' ORDER BY f.created_at DESC LIMIT 50';

      const r = await pool.query(q, params);
      return sendJson(res, 200, { ok: true, data: r.rows || [] });
    } catch (e) {
      console.warn('[handleGetFeedback DB]:', e.message);
    }
  }

  let list = readJsonData('feedback.json', []);
  if (employeeId) list = list.filter(f => f.employee_id === employeeId);
  if (filter === 'new') list = list.filter(f => f.status === 'new');
  if (filter === 'replied') list = list.filter(f => f.status === 'replied');
  if (filter === 'complaint') list = list.filter(f => f.type === 'complaint');
  if (filter === 'suggestion') list = list.filter(f => f.type === 'suggestion');
  list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  return sendJson(res, 200, { ok: true, data: list.slice(0, 50) });
}

async function handleCreateFeedback(req, res) {
  const body = await readJson(req);
  const employeeId = body.employee_id || null;
  const message = String(body.message || '').trim();
  const type = body.type || 'other';
  const employeeName = body.employee_name || '';

  if (!message) {
    return sendJson(res, 400, { ok: false, error: 'Xabar matni kiritilishi shart' });
  }

  const pool = getDbPool();
  if (pool && employeeId) {
    try {
      // 10 soniya ichida aynan shu xodimdan bir xil xabar kelgan bo'lsa (dublikatdan himoya)
      const dup = await pool.query(
        `SELECT * FROM public.feedback
         WHERE employee_id = $1 AND message = $2 AND created_at > (now() - interval '10 seconds')
         ORDER BY created_at DESC LIMIT 1`,
        [employeeId, message]
      );
      if (dup.rows && dup.rows.length > 0) {
        return sendJson(res, 200, { ok: true, data: dup.rows[0], duplicate: true });
      }
    } catch (_) {}
  }

  // Lokal fayldagi dublikat tekshiruvi (oxirgi 10 soniya)
  const list = readJsonData('feedback.json', []);
  const tenSecAgo = Date.now() - 10000;
  const localDup = list.find(f => f.employee_id === employeeId && f.message === message && new Date(f.created_at).getTime() > tenSecAgo);
  if (localDup) {
    return sendJson(res, 200, { ok: true, data: localDup, duplicate: true });
  }

  const fb = {
    id: `fb_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    employee_id: employeeId,
    employee_name: employeeName,
    type,
    message,
    status: 'new',
    admin_reply: null,
    created_at: new Date().toISOString()
  };

  if (pool) {
    try {
      const r = await pool.query(
        'INSERT INTO public.feedback (employee_id, employee_name, type, message, status, created_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING *',
        [fb.employee_id, fb.employee_name, fb.type, fb.message, fb.status]
      );
      if (r.rows && r.rows[0]) Object.assign(fb, r.rows[0]);
    } catch (e) {
      console.warn('[handleCreateFeedback DB]:', e.message);
    }
  }

  list.unshift(fb);
  writeJsonData('feedback.json', list);

  return sendJson(res, 200, { ok: true, data: fb });
}

async function handleReplyFeedback(req, res, fbId) {
  const body = await readJson(req);
  const reply = body.admin_reply || body.reply || '';

  const pool = getDbPool();
  let updated = null;

  if (pool) {
    try {
      const r = await pool.query(
        'UPDATE public.feedback SET admin_reply = $1, status = \'replied\', replied_at = now() WHERE id = $2 RETURNING *',
        [reply, fbId]
      );
      if (r.rows && r.rows[0]) updated = r.rows[0];
    } catch (e) {
      console.warn('[handleReplyFeedback DB]:', e.message);
    }
  }

  const list = readJsonData('feedback.json', []);
  const item = list.find(f => f.id === fbId);
  if (item) {
    item.admin_reply = reply;
    item.status = 'replied';
    item.replied_at = new Date().toISOString();
    writeJsonData('feedback.json', list);
    updated = updated || item;
  }

  return sendJson(res, 200, { ok: true, data: updated });
}

// 8. LUNCH PLANS
async function handleGetLunchPlans(req, res, reqUrl) {
  const employeeId = reqUrl.searchParams.get('employee_id');
  const workDate = reqUrl.searchParams.get('work_date') || todayISO();

  const pool = getDbPool();
  if (pool) {
    try {
      const r = await pool.query(
        'SELECT * FROM public.lunch_plans WHERE employee_id = $1 AND work_date = $2 LIMIT 1',
        [employeeId, workDate]
      );
      return sendJson(res, 200, { ok: true, data: r.rows[0] || null });
    } catch (e) { }
  }

  const list = readJsonData('lunch_plans.json', []);
  const item = list.find(lp => lp.employee_id === employeeId && lp.work_date === workDate) || null;
  return sendJson(res, 200, { ok: true, data: item });
}

async function handleSaveLunchPlan(req, res) {
  const body = await readJson(req);
  const employeeId = body.employee_id;
  const workDate = body.work_date || todayISO();
  const shift = body.shift;

  const pool = getDbPool();
  if (pool) {
    try {
      await pool.query(`
        INSERT INTO public.lunch_plans (employee_id, work_date, shift, created_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (employee_id, work_date) DO UPDATE SET shift = EXCLUDED.shift
      `, [employeeId, workDate, shift]);
    } catch (e) { }
  }

  const list = readJsonData('lunch_plans.json', []);
  const idx = list.findIndex(lp => lp.employee_id === employeeId && lp.work_date === workDate);
  if (idx >= 0) list[idx].shift = shift;
  else list.push({ employee_id: employeeId, work_date: workDate, shift, created_at: new Date().toISOString() });
  writeJsonData('lunch_plans.json', list);

  return sendJson(res, 200, { ok: true });
}

// 9. EMPLOYEE LEAVES
async function handleGetEmployeeLeaves(req, res, reqUrl) {
  const from = reqUrl.searchParams.get('from');
  const to = reqUrl.searchParams.get('to');
  const pool = getDbPool();

  if (pool) {
    try {
      const q = from && to
        ? 'SELECT * FROM public.employee_leaves WHERE return_date >= $1 AND leave_start_date <= $2 ORDER BY leave_start_date DESC'
        : 'SELECT * FROM public.employee_leaves ORDER BY leave_start_date DESC';
      const r = from && to ? await pool.query(q, [from, to]) : await pool.query(q);
      return sendJson(res, 200, { ok: true, data: r.rows || [] });
    } catch (e) { }
  }

  let list = readJsonData('employee_leaves.json', []);
  if (from && to) list = list.filter(l => l.return_date >= from && l.leave_start_date <= to);
  return sendJson(res, 200, { ok: true, data: list });
}

async function handleSaveEmployeeLeave(req, res) {
  const body = await readJson(req);
  const pool = getDbPool();
  const leave = {
    id: `leave_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    employee_id: body.employee_id,
    leave_start_date: body.leave_start_date,
    return_date: body.return_date,
    created_at: new Date().toISOString()
  };

  if (pool) {
    try {
      const r = await pool.query(
        'INSERT INTO public.employee_leaves (employee_id, leave_start_date, return_date, created_at) VALUES ($1, $2, $3, now()) RETURNING *',
        [leave.employee_id, leave.leave_start_date, leave.return_date]
      );
      if (r.rows && r.rows[0]) Object.assign(leave, r.rows[0]);
    } catch (e) { }
  }

  const list = readJsonData('employee_leaves.json', []);
  list.unshift(leave);
  writeJsonData('employee_leaves.json', list);

  return sendJson(res, 200, { ok: true, data: leave });
}

module.exports = {
  server,
  runRetentionCleanup,
  initAutoEndScheduler,
  runServerScheduledChecks,
  getCallsStats,
  getCallsList,
  handleGetAttendance
};
