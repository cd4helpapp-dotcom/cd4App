-- Security hardening: private storage, scoped access, rate limiting + audit logs.

-- ---------------------------------------------------------------------------
-- 1) Storage buckets: private-by-default
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
SET public = false
WHERE id IN ('cd4-storage', 'ai-reports');

INSERT INTO storage.buckets (id, name, public)
VALUES ('doctor-kyc', 'doctor-kyc', false)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

-- ---------------------------------------------------------------------------
-- 2) cd4-storage policies (profile media + legacy user folder compatibility)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Uploads" ON storage.objects;
DROP POLICY IF EXISTS "CD4 storage read profile pictures" ON storage.objects;
DROP POLICY IF EXISTS "CD4 storage read own legacy folder" ON storage.objects;
DROP POLICY IF EXISTS "CD4 storage write own profile folder" ON storage.objects;
DROP POLICY IF EXISTS "CD4 storage delete own profile folder" ON storage.objects;

CREATE POLICY "CD4 storage read profile pictures"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'cd4-storage'
  AND split_part(name, '/', 1) = 'profile-pictures'
);

CREATE POLICY "CD4 storage read own legacy folder"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'cd4-storage'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR public.current_user_role_slug() = 'admin'
  )
);

CREATE POLICY "CD4 storage write own profile folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'cd4-storage'
  AND split_part(name, '/', 1) = 'profile-pictures'
  AND split_part(name, '/', 2) = auth.uid()::text
);

CREATE POLICY "CD4 storage delete own profile folder"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'cd4-storage'
  AND (
    (split_part(name, '/', 1) = 'profile-pictures' AND split_part(name, '/', 2) = auth.uid()::text)
    OR public.current_user_role_slug() = 'admin'
  )
);

-- ---------------------------------------------------------------------------
-- 3) doctor-kyc policies (strictly owner/admin)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Doctor KYC read own or admin" ON storage.objects;
DROP POLICY IF EXISTS "Doctor KYC write own or admin" ON storage.objects;
DROP POLICY IF EXISTS "Doctor KYC update own or admin" ON storage.objects;
DROP POLICY IF EXISTS "Doctor KYC delete own or admin" ON storage.objects;

CREATE POLICY "Doctor KYC read own or admin"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'doctor-kyc'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR public.current_user_role_slug() = 'admin'
  )
);

CREATE POLICY "Doctor KYC write own or admin"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'doctor-kyc'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR public.current_user_role_slug() = 'admin'
  )
);

CREATE POLICY "Doctor KYC update own or admin"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'doctor-kyc'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR public.current_user_role_slug() = 'admin'
  )
)
WITH CHECK (
  bucket_id = 'doctor-kyc'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR public.current_user_role_slug() = 'admin'
  )
);

CREATE POLICY "Doctor KYC delete own or admin"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'doctor-kyc'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR public.current_user_role_slug() = 'admin'
  )
);

-- ---------------------------------------------------------------------------
-- 4) ai-reports policies (patient-owned path + doctor linkage by appointment)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can upload their own reports" ON storage.objects;
DROP POLICY IF EXISTS "Reports are viewable by authenticated users" ON storage.objects;
DROP POLICY IF EXISTS "AI reports insert own folder" ON storage.objects;
DROP POLICY IF EXISTS "AI reports select by patient doctor or admin" ON storage.objects;
DROP POLICY IF EXISTS "AI reports delete own or admin" ON storage.objects;

CREATE POLICY "AI reports insert own folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'ai-reports'
  AND split_part(name, '/', 1) = auth.uid()::text
);

CREATE POLICY "AI reports select by patient doctor or admin"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'ai-reports'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR public.current_user_role_slug() = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.ai_triage_reports r
      JOIN public.appointments a ON a.ai_report_id = r.id
      WHERE r.pdf_url = storage.objects.name
        AND (a.patient_id = auth.uid() OR a.doctor_id = auth.uid())
    )
  )
);

CREATE POLICY "AI reports delete own or admin"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'ai-reports'
  AND (
    split_part(name, '/', 1) = auth.uid()::text
    OR public.current_user_role_slug() = 'admin'
  )
);

-- ---------------------------------------------------------------------------
-- 5) Public-safe doctors view for frontend (least-column exposure)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.doctors_public AS
SELECT
  d.id,
  d.city,
  d.specialization,
  d.experience,
  d.fee,
  d.bio,
  d.rating,
  d.is_verified,
  d.created_at,
  d.updated_at,
  p.first_name,
  p.last_name,
  p.profile_picture,
  p.gender
FROM public.doctors d
JOIN public.profiles p ON p.id = d.id
WHERE d.is_verified = true;

GRANT SELECT ON public.doctors_public TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 6) Edge abuse monitoring + rate limit primitives
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error', 'critical')),
  user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ip TEXT NULL,
  source TEXT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_logs_created_at ON public.security_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_event_type ON public.security_audit_logs (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_user_id ON public.security_audit_logs (user_id, created_at DESC);

ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read security audit logs" ON public.security_audit_logs;
DROP POLICY IF EXISTS "Service role can insert security audit logs" ON public.security_audit_logs;

CREATE POLICY "Admins can read security audit logs"
ON public.security_audit_logs
FOR SELECT
TO authenticated
USING (public.current_user_role_slug() = 'admin');

CREATE POLICY "Service role can insert security audit logs"
ON public.security_audit_logs
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.security_rate_limits (
  scope TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, subject, window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_security_rate_limits_updated_at ON public.security_rate_limits (updated_at);

ALTER TABLE public.security_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access security_rate_limits" ON public.security_rate_limits;
CREATE POLICY "Service role full access security_rate_limits"
ON public.security_rate_limits
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.security_check_rate_limit(
  p_scope TEXT,
  p_subject TEXT,
  p_window_seconds INTEGER,
  p_max_requests INTEGER
)
RETURNS TABLE(
  allowed BOOLEAN,
  remaining INTEGER,
  retry_after_sec INTEGER,
  current_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_window_seconds INTEGER := GREATEST(1, p_window_seconds);
  v_max_requests INTEGER := GREATEST(1, p_max_requests);
  v_window_epoch BIGINT;
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
  v_retry INTEGER;
BEGIN
  v_window_epoch := FLOOR(EXTRACT(EPOCH FROM v_now) / v_window_seconds)::BIGINT * v_window_seconds;
  v_window_start := TO_TIMESTAMP(v_window_epoch);

  INSERT INTO public.security_rate_limits (scope, subject, window_started_at, request_count, updated_at)
  VALUES (p_scope, p_subject, v_window_start, 1, v_now)
  ON CONFLICT (scope, subject, window_started_at)
  DO UPDATE SET
    request_count = public.security_rate_limits.request_count + 1,
    updated_at = EXCLUDED.updated_at
  RETURNING request_count INTO v_count;

  allowed := v_count <= v_max_requests;
  remaining := GREATEST(v_max_requests - v_count, 0);
  current_count := v_count;
  v_retry := GREATEST((v_window_seconds - EXTRACT(EPOCH FROM (v_now - v_window_start))::INTEGER), 0);
  retry_after_sec := CASE WHEN allowed THEN 0 ELSE v_retry END;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.security_check_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE VIEW public.security_anomaly_signals AS
SELECT
  date_trunc('hour', created_at) AS hour_bucket,
  event_type,
  severity,
  COUNT(*)::INTEGER AS event_count
FROM public.security_audit_logs
WHERE created_at >= NOW() - INTERVAL '48 hours'
GROUP BY 1, 2, 3
ORDER BY hour_bucket DESC, event_count DESC;
