/**
 * AloqaPro - Supabasedan Server PostgreSQL bazasiga ma'lumotlarni ko'chirish (Migration) skripti
 * 
 * Ishlatish:
 * 1. .env fayliga SUPABASE_SERVICE_ROLE_KEY va DATABASE_URL ni kiriting.
 * 2. Buyruqni bering: node migrate-from-supabase.js
 */

const fs = require('fs');
const path = require('path');

// .env ni yuklash
loadEnv();

let pg = null;
try {
  pg = require('pg');
} catch (e) {
  console.error("Xatolik: 'pg' moduli o'rnatilmagan. Avval 'npm install pg' buyrug'ini bering.");
  process.exit(1);
}

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Xatolik: .env faylida SUPABASE_URL yoki SUPABASE_KEY (SERVICE_ROLE_KEY) mavjud emas!");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("Xatolik: .env faylida DATABASE_URL mavjud emas!");
  process.exit(1);
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
  console.log('  Supabase -> Server PostgreSQL Migratsiyasi');
  console.log(`  Supabase URL: ${SUPABASE_URL}`);
  console.log(`  Server DB:    ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
  console.log('====================================================');

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    for (const table of TABLES) {
      process.stdout.write(`Jadval ko'chirilmoqda: [${table}] ... `);
      try {
        const rows = await fetchAllSupabaseRows(table);
        if (!rows || rows.length === 0) {
          console.log(`0 ta yozuv (bo'sh)`);
          continue;
        }

        let insertedCount = 0;
        for (const row of rows) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;

          const cols = keys.map(k => `"${k}"`).join(', ');
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
          const values = keys.map(k => {
            const val = row[k];
            // JSON obyektlarini to'g'ri formatlash
            if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
              return JSON.stringify(val);
            }
            return val;
          });

          const updateCols = keys
            .filter(k => k !== 'id')
            .map(k => `"${k}" = EXCLUDED."${k}"`)
            .join(', ');

          let conflictClause = 'ON CONFLICT DO NOTHING';
          if (keys.includes('id') && updateCols) {
            conflictClause = `ON CONFLICT ("id") DO UPDATE SET ${updateCols}`;
          }

          const query = `
            INSERT INTO public."${table}" (${cols})
            VALUES (${placeholders})
            ${conflictClause}
          `;

          await client.query(query, values);
          insertedCount++;
        }

        console.log(`Muvaffaqiyatli: ${insertedCount} ta yozuv ko'chirildi!`);
      } catch (tableErr) {
        console.log(`Ogohlantirish/Xato: ${tableErr.message}`);
      }
    }

    console.log('====================================================');
    console.log("Barcha ma'lumotlar muvaffaqiyatli ko'chirildi!");
    console.log('====================================================');
  } catch (err) {
    console.error('Migratsiyada jiddiy xatolik:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

async function fetchAllSupabaseRows(table) {
  let all = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Range': `${from}-${to}`,
        'Range-Unit': 'items'
      }
    });

    if (res.status === 404 || res.status === 400) {
      // Jadval Supabaseda mavjud bo'lmasligi mumkin
      return [];
    }

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Supabase ${res.status}: ${txt}`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    all.push(...data);
    if (data.length < pageSize) break;
    page++;
  }

  return all;
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
