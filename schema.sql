-- ============================================================
--  AloqaPro - To'liq PostgreSQL Ma'lumotlar Bazasi Sxemasi
--  Ubuntu Serverda ishlatish uchun
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. ADMINS (Administratorlar)
CREATE TABLE IF NOT EXISTS public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  login TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- 2. EMPLOYEES (Xodimlar)
CREATE TABLE IF NOT EXISTS public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  login TEXT NOT NULL,
  kpi_type TEXT DEFAULT 'junior',
  active BOOLEAN NOT NULL DEFAULT true,
  face_registered BOOLEAN NOT NULL DEFAULT false,
  responsible_course TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Agar oldingi bazada responsible_course yo'q bo'lsa qo'shish
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='employees' AND column_name='responsible_course') THEN
    ALTER TABLE public.employees ADD COLUMN responsible_course TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='employees' AND column_name='kpi_type') THEN
    ALTER TABLE public.employees ADD COLUMN kpi_type TEXT DEFAULT 'junior';
  END IF;
END $$;

-- 3. ATTENDANCE (Davomat va ish vaqti)
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  lunch_start TIME,
  lunch_end TIME,
  work_seconds INTEGER NOT NULL DEFAULT 0,
  worked_seconds INTEGER NOT NULL DEFAULT 0,
  lunch_seconds INTEGER NOT NULL DEFAULT 0,
  afk_seconds INTEGER NOT NULL DEFAULT 0,
  afk_count INTEGER NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'kelmadi',
  auto_ended BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance(work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON public.attendance(employee_id, work_date);

-- 4. KPI_BONUSES (KPI va bonuslar)
CREATE TABLE IF NOT EXISTS public.kpi_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  bonus INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, month)
);

-- 5. SETTINGS (Tizim sozlamalari)
CREATE TABLE IF NOT EXISTS public.settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. NOTIFICATIONS (Bildirishnomalar)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT,
  type TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_sent_at ON public.notifications(sent_at);

-- 7. FEEDBACK (Fikr va shikoyatlar)
CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  employee_name TEXT,
  type TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  admin_reply TEXT,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback(created_at);

-- 8. LUNCH_PLANS (Tushlik rejalari)
CREATE TABLE IF NOT EXISTS public.lunch_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  shift TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, work_date)
);

-- 9. EMPLOYEE_LEAVES (Mehnat ta'tillari / Sababli qoldirishlar)
CREATE TABLE IF NOT EXISTS public.employee_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_start_date DATE NOT NULL,
  return_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leaves_dates ON public.employee_leaves(leave_start_date, return_date);

-- 10. FACE_PROFILES (Yuz qoliplari)
CREATE TABLE IF NOT EXISTS public.face_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  descriptor JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id)
);



-- 13. UPDATED_AT TRIGGER FUNKSIYASI
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_attendance_seconds()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.work_seconds IS NOT NULL AND (NEW.worked_seconds IS NULL OR NEW.worked_seconds = 0) THEN
    NEW.worked_seconds = NEW.work_seconds;
  ELSIF NEW.worked_seconds IS NOT NULL AND (NEW.work_seconds IS NULL OR NEW.work_seconds = 0) THEN
    NEW.work_seconds = NEW.worked_seconds;
  ELSE
    NEW.worked_seconds = COALESCE(NEW.work_seconds, NEW.worked_seconds, 0);
    NEW.work_seconds = NEW.worked_seconds;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_sync_seconds_insert ON public.attendance;
CREATE TRIGGER attendance_sync_seconds_insert
BEFORE INSERT ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.sync_attendance_seconds();

DROP TRIGGER IF EXISTS attendance_set_updated_at ON public.attendance;
CREATE TRIGGER attendance_set_updated_at
BEFORE UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.sync_attendance_seconds();

DROP TRIGGER IF EXISTS settings_set_updated_at ON public.settings;
CREATE TRIGGER settings_set_updated_at
BEFORE UPDATE ON public.settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS face_profiles_set_updated_at ON public.face_profiles;
CREATE TRIGGER face_profiles_set_updated_at
BEFORE UPDATE ON public.face_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 14. ADMIN_ATTENDANCE_RANGE FUNKSIYASI
DROP FUNCTION IF EXISTS public.admin_attendance_range(DATE, DATE, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_attendance_range(
  p_from DATE,
  p_to DATE,
  p_search TEXT DEFAULT '',
  p_status TEXT DEFAULT ''
)
RETURNS TABLE (
  employee_id UUID,
  employee_name TEXT,
  employee_login TEXT,
  name TEXT,
  login TEXT,
  work_date DATE,
  start_time TIME,
  end_time TIME,
  lunch_start TIME,
  lunch_end TIME,
  late_minutes INTEGER,
  worked_seconds INTEGER,
  work_seconds INTEGER,
  afk_seconds INTEGER,
  status TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    e.id AS employee_id,
    e.name AS employee_name,
    e.login AS employee_login,
    e.name,
    e.login,
    COALESCE(a.work_date, p_from) AS work_date,
    a.start_time,
    a.end_time,
    a.lunch_start,
    a.lunch_end,
    COALESCE(a.late_minutes, 0) AS late_minutes,
    COALESCE(a.work_seconds, 0) AS worked_seconds,
    COALESCE(a.work_seconds, 0) AS work_seconds,
    COALESCE(a.afk_seconds, 0) AS afk_seconds,
    COALESCE(a.status, 'kelmadi') AS status
  FROM public.employees e
  LEFT JOIN public.attendance a
    ON a.employee_id = e.id
   AND a.work_date BETWEEN p_from AND p_to
  WHERE e.active IS NOT false
    AND (
      COALESCE(p_search, '') = ''
      OR LOWER(COALESCE(e.name, '')) LIKE '%' || LOWER(p_search) || '%'
      OR LOWER(COALESCE(e.login, '')) LIKE '%' || LOWER(p_search) || '%'
    )
    AND (
      COALESCE(p_status, '') = ''
      OR a.status = p_status
    );
$$;

-- 15. DATA RETENTION: 3 OYDAN ESKI MA'LUMOTLARNI TOZALASH FUNKSIYASI
-- Ushbu funksiya xodimlar (employees) va adminlar profiliga tegilmagan holda
-- faqat 3 oydan eski davomat, bildirishnomalar, feedback va qo'ng'iroqlarni tozalaydi.
CREATE OR REPLACE FUNCTION public.cleanup_old_records(retention_months INT DEFAULT 3)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff_date DATE := (CURRENT_DATE - (retention_months || ' months')::INTERVAL)::DATE;
  v_cutoff_tz TIMESTAMPTZ := (now() - (retention_months || ' months')::INTERVAL);
  cnt_attendance INT := 0;
  cnt_notifs INT := 0;
  cnt_feedback INT := 0;
  cnt_leaves INT := 0;
  cnt_calls INT := 0;
BEGIN
  -- Attendance o'chirish (< 3 oy)
  DELETE FROM public.attendance WHERE work_date < v_cutoff_date;
  GET DIAGNOSTICS cnt_attendance = ROW_COUNT;

  -- Notifications o'chirish (< 3 oy)
  DELETE FROM public.notifications WHERE sent_at < v_cutoff_tz;
  GET DIAGNOSTICS cnt_notifs = ROW_COUNT;

  -- Feedback o'chirish (< 3 oy)
  DELETE FROM public.feedback WHERE created_at < v_cutoff_tz;
  GET DIAGNOSTICS cnt_feedback = ROW_COUNT;

  -- O'tgan ta'tillar (< 3 oy)
  DELETE FROM public.employee_leaves WHERE return_date < v_cutoff_date;
  GET DIAGNOSTICS cnt_leaves = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'cutoff_date', v_cutoff_date,
    'retention_months', retention_months,
    'deleted_attendance', cnt_attendance,
    'deleted_notifications', cnt_notifs,
    'deleted_feedback', cnt_feedback,
    'deleted_leaves', cnt_leaves,
    'cleaned_at', now()
  );
END;
$$;
