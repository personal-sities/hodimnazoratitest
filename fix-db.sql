-- ============================================================
-- AloqaPro Database Permission & Missing Columns Fix Script
-- Ushbu skript PostgreSQL ruxsatlarini to'g'irlaydi, UUID cheklovlarini yechadi va ustunlarni to'g'irlaydi.
-- Ishga tushirish: sudo -u postgres psql -d aloqapro -f fix-db.sql
-- ============================================================

-- 1. aloqapro bazasi va public sxemasi egaligini aloqa_user ga berish
ALTER DATABASE aloqapro OWNER TO aloqa_user;
ALTER SCHEMA public OWNER TO aloqa_user;
GRANT ALL ON SCHEMA public TO aloqa_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO aloqa_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO aloqa_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO aloqa_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO aloqa_user;

-- 2. UUID cheklovlarini olib tashlash (emp_... formatidagi string IDlar ishlashi uchun)
ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_employee_id_fkey;
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_employee_id_fkey;
ALTER TABLE public.employee_leaves DROP CONSTRAINT IF EXISTS employee_leaves_employee_id_fkey;
ALTER TABLE public.lunch_plans DROP CONSTRAINT IF EXISTS lunch_plans_employee_id_fkey;
ALTER TABLE public.kpi_bonuses DROP CONSTRAINT IF EXISTS kpi_bonuses_employee_id_fkey;
ALTER TABLE public.face_profiles DROP CONSTRAINT IF EXISTS face_profiles_employee_id_fkey;

DO $$
BEGIN
  BEGIN ALTER TABLE public.employees ALTER COLUMN id TYPE TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.employees ALTER COLUMN user_id TYPE TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.attendance ALTER COLUMN employee_id TYPE TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.calls ALTER COLUMN employee_id TYPE TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.employee_leaves ALTER COLUMN employee_id TYPE TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.lunch_plans ALTER COLUMN employee_id TYPE TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.kpi_bonuses ALTER COLUMN employee_id TYPE TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE public.face_profiles ALTER COLUMN employee_id TYPE TEXT; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- 3. employees jadvali uchun yetishmayotgan ustunlarni qo'shish
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS operator_number TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS pbx_extension TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS kpi_type TEXT DEFAULT 'junior';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS responsible_course TEXT;

-- 4. calls jadvali (agar yo'q bo'lsa yaratish, bor bo'lsa ustunlarni qo'shish)
CREATE TABLE IF NOT EXISTS public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id TEXT UNIQUE,
  caller TEXT,
  callee TEXT,
  operator_number TEXT,
  employee_id TEXT,
  employee_name TEXT,
  direction TEXT DEFAULT 'in',
  status TEXT NOT NULL DEFAULT 'missed',
  duration INTEGER NOT NULL DEFAULT 0,
  talk_time INTEGER NOT NULL DEFAULT 0,
  record_url TEXT,
  rating NUMERIC,
  rating_comment TEXT,
  raw_data JSONB,
  call_date DATE NOT NULL DEFAULT CURRENT_DATE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS call_id TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS caller TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS callee TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS operator_number TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS employee_id TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS employee_name TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'in';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'missed';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 0;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS talk_time INTEGER DEFAULT 0;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS record_url TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS rating NUMERIC;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS rating_comment TEXT;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS raw_data JSONB;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS call_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- calls jadvalidagi call_id ga UNIQUE qo'yish (ON CONFLICT ishlashi uchun)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.calls'::regclass AND (conname = 'calls_call_id_unique' OR conname = 'calls_call_id_key')
  ) THEN
    ALTER TABLE public.calls ADD CONSTRAINT calls_call_id_unique UNIQUE (call_id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 5. attendance jadvali uchun tekshiruv
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS worked_seconds INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS work_seconds INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS lunch_seconds INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS afk_seconds INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS afk_count INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS late_minutes INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS auto_ended BOOLEAN DEFAULT false;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 6. Barcha mavjud jadvallarning egasini aloqa_user ga o'tkazish
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO aloqa_user';
    EXECUTE 'GRANT ALL PRIVILEGES ON TABLE public.' || quote_ident(r.tablename) || ' TO aloqa_user';
  END LOOP;
  FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
    EXECUTE 'ALTER SEQUENCE public.' || quote_ident(r.sequence_name) || ' OWNER TO aloqa_user';
    EXECUTE 'GRANT ALL PRIVILEGES ON SEQUENCE public.' || quote_ident(r.sequence_name) || ' TO aloqa_user';
  END LOOP;
END $$;
