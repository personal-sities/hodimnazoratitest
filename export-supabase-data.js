/**
 * AloqaPro - Supabasedan barcha ma'lumotlarni tortib olish (Export) skripti
 * 
 * Ishlatish usullari:
 * 1) Admin email va parol orqali:
 *    node export-supabase-data.js --email admin@example.com --password sirli_parol
 * 
 * 2) Service role key orqali (.env da bo'lsa yoki argumentda):
 *    node export-supabase-data.js --key eyJh...
 */

const fs = require('fs');
const path = require('path');

// .env ni yuklash
loadEnv();

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://hdbhdddekjjjtwtyocfa.supabase.co').replace(/\/+$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_CZUB0mOSzmmCvviNzWykzw_B3_0-5bE';

// Argumentlarni o'qish
const args = process.argv.slice(2);
let email = null;
let password = null;
let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--email' && args[i + 1]) email = args[++i];
  if (args[i] === '--password' && args[i + 1]) password = args[++i];
  if (args[i] === '--key' && args[i + 1]) serviceKey = args[++i];
}

const TABLES = [
  'settings',
  'admins',
  'employees',
  'face_profiles',
  'lunch_plans',
  'employee_leaves',
  'kpi_bonuses',
  'attendance',
  'notifications',
  'feedback',
  'calls',
  'amocrm_active_tasks'
];

async function main() {
  console.log('====================================================');
  console.log('  AloqaPro: Supabasedan Ma\'lumotlarni Yuklab Olish');
  console.log(`  Supabase URL: ${SUPABASE_URL}`);
  console.log('====================================================');

  let activeToken = serviceKey;

  // Agar service role key bo'lmasa, admin login orqali token olishga harakat qilamiz
  if (!activeToken && email && password) {
    console.log(`Admin hisobi bilan tizimga kirilmoqda: ${email}...`);
    try {
      activeToken = await loginWithPassword(email, password);
      console.log('Muvaffaqiyatli kirildi! Admin sessiyasi olindi.');
    } catch (authErr) {
      console.error('Kirishda xatolik:', authErr.message);
      process.exit(1);
    }
  }

  if (!activeToken) {
    console.log('\nDIQQAT: Supabase RLS (Row Level Security) sababli barcha ma\'lumotlarni');
    console.log('tortib olish uchun quyidagilardan birini kiritishingiz kerak:\n');
    console.log('A) Admin hisobingiz bilan:');
    console.log('   node export-supabase-data.js --email ADMIN_EMAIL --password PAROL\n');
    console.log('B) Supabase Service Role Key bilan:');
    console.log('   node export-supabase-data.js --key SERVICE_ROLE_KEY');
    console.log('   (Yoki .env ichida SUPABASE_SERVICE_ROLE_KEY=... qilib qo\'ying)\n');
    console.log('Hozir anonim kalit bilan tekshirib ko\'rilmoqda...');
    activeToken = ANON_KEY;
  }

  const dump = {
    exported_at: new Date().toISOString(),
    supabase_url: SUPABASE_URL,
    tables: {}
  };

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  let totalRows = 0;
  let sqlStatements = [];
  sqlStatements.push(`-- AloqaPro Supabase Data Dump`);
  sqlStatements.push(`-- Eksport vaqti: ${new Date().toISOString()}`);
  sqlStatements.push(`BEGIN;`);

  for (const table of TABLES) {
    process.stdout.write(`Yuklanmoqda [${table}] ... `);
    try {
      const rows = await fetchAllRows(table, activeToken);
      dump.tables[table] = rows;
      console.log(`${rows.length} ta yozuv topildi.`);
      totalRows += rows.length;

      if (rows.length > 0) {
        sqlStatements.push(`\n-- Jadval: ${table}`);
        for (const row of rows) {
          const cols = Object.keys(row).map(c => `"${c}"`).join(', ');
          const vals = Object.values(row).map(val => sqlValue(val)).join(', ');
          const updateCols = Object.keys(row)
            .filter(c => c !== 'id')
            .map(c => `"${c}" = EXCLUDED."${c}"`)
            .join(', ');

          let onConflict = 'ON CONFLICT DO NOTHING';
          if (row.id && updateCols) {
            onConflict = `ON CONFLICT ("id") DO UPDATE SET ${updateCols}`;
          }

          sqlStatements.push(`INSERT INTO public."${table}" (${cols}) VALUES (${vals}) ${onConflict};`);
        }
      }
    } catch (err) {
      console.log(`Xato: ${err.message}`);
      dump.tables[table] = [];
    }
  }

  sqlStatements.push(`\nCOMMIT;`);

  // JSON va SQL fayllarga saqlash
  const jsonPath = path.join(dataDir, 'supabase_backup.json');
  const sqlPath = path.join(dataDir, 'supabase_backup.sql');

  fs.writeFileSync(jsonPath, JSON.stringify(dump, null, 2), 'utf8');
  fs.writeFileSync(sqlPath, sqlStatements.join('\n'), 'utf8');

  console.log('====================================================');
  console.log(`Jami yuklab olingan yozuvlar: ${totalRows} ta`);
  console.log(`JSON nusxa saqlandi:  ${jsonPath}`);
  console.log(`SQL nusxa saqlandi:   ${sqlPath}`);
  console.log('====================================================');

  if (totalRows === 0 && activeToken === ANON_KEY) {
    console.log('\n[MUHIM ESLATMA]: 0 ta yozuv chiqdi, chunki Supabase RLS anonim kalitga');
    console.log('ruxsat bermaydi. Barcha ma\'lumotlarni tortib olish uchun skriptni');
    console.log('Admin email/paroli yoki service_role_key bilan qayta ishga tushiring:');
    console.log('   node export-supabase-data.js --email SIZNING_ADMIN_EMAIL --password PAROLINGIZ');
  }
}

async function loginWithPassword(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.message || 'Login yoki parol xato');
  }

  return data.access_token;
}

async function fetchAllRows(table, token) {
  let rows = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${token}`,
        'Range': `${from}-${to}`,
        'Range-Unit': 'items'
      }
    });

    if (res.status === 404 || res.status === 400) return [];
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Status ${res.status}: ${txt}`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    rows.push(...data);
    if (data.length < pageSize) break;
    page++;
  }

  return rows;
}

function sqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'object') {
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

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
      if (process.env[key] === undefined) process.env[key] = val;
    }
  });
}

main().catch(console.error);
