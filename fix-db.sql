-- ============================================================
-- AloqaPro Database Permission & Missing Columns Fix Script
-- Ushbu skript PostgreSQL ruxsatlarini to'g'irlaydi va yetishmayotgan ustunlarni qo'shadi.
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

-- 2. employees jadvali uchun yetishmayotgan ustunlarni qo'shish
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS operator_number TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS pbx_extension TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS kpi_type TEXT DEFAULT 'junior';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS responsible_course TEXT;

-- 3. calls jadvali (agar yo'q bo'lsa yaratish, bor bo'lsa ustunlarni qo'shish)
CREATE TABLE IF NOT EXISTS public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id TEXT UNIQUE,
  caller TEXT,
  callee TEXT,
  operator_number TEXT,
  employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
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
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS employee_id UUID;
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

-- 4. attendance jadvali uchun tekshiruv
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS worked_seconds INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS work_seconds INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS lunch_seconds INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS afk_seconds INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS afk_count INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS late_minutes INTEGER DEFAULT 0;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS auto_ended BOOLEAN DEFAULT false;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 5. Barcha mavjud jadvallarning egasini aloqa_user ga o'tkazish
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
