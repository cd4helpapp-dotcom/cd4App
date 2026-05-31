-- Security ops controls: key rotation ledger, pentest cadence, anomaly alert automation.

-- ---------------------------------------------------------------------------
-- 1) Key rotation ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_key_rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name TEXT NOT NULL,
  rotated_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  previous_fingerprint TEXT NULL,
  new_fingerprint TEXT NULL,
  rotation_reason TEXT NOT NULL DEFAULT 'scheduled',
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('scheduled', 'completed', 'rolled_back', 'failed')),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_key_rotations_rotated_at
  ON public.security_key_rotations (rotated_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_key_rotations_key_name
  ON public.security_key_rotations (key_name, rotated_at DESC);

ALTER TABLE public.security_key_rotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read key rotations" ON public.security_key_rotations;
DROP POLICY IF EXISTS "Service role manage key rotations" ON public.security_key_rotations;

CREATE POLICY "Admins can read key rotations"
ON public.security_key_rotations
FOR SELECT
TO authenticated
USING (public.current_user_role_slug() = 'admin');

CREATE POLICY "Service role manage key rotations"
ON public.security_key_rotations
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2) Pen-test cadence tracker
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_pentest_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL DEFAULT 'full-stack',
  cadence_days INTEGER NOT NULL DEFAULT 90 CHECK (cadence_days BETWEEN 7 AND 365),
  owner_email TEXT NULL,
  last_completed_at TIMESTAMPTZ NULL,
  next_due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'overdue', 'waived')),
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_pentest_schedule_next_due
  ON public.security_pentest_schedule (next_due_at);

ALTER TABLE public.security_pentest_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read pentest schedule" ON public.security_pentest_schedule;
DROP POLICY IF EXISTS "Service role manage pentest schedule" ON public.security_pentest_schedule;

CREATE POLICY "Admins can read pentest schedule"
ON public.security_pentest_schedule
FOR SELECT
TO authenticated
USING (public.current_user_role_slug() = 'admin');

CREATE POLICY "Service role manage pentest schedule"
ON public.security_pentest_schedule
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

INSERT INTO public.security_pentest_schedule (
  scope,
  cadence_days,
  owner_email,
  next_due_at,
  status,
  notes
)
SELECT
  'full-stack',
  90,
  NULL,
  NOW() + INTERVAL '90 days',
  'scheduled',
  'Initial quarterly penetration-test cadence'
WHERE NOT EXISTS (
  SELECT 1 FROM public.security_pentest_schedule
);

-- ---------------------------------------------------------------------------
-- 3) Anomaly alert materializer from security_anomaly_signals view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.security_create_anomaly_alerts(
  p_min_events INTEGER DEFAULT 20
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_inserted INTEGER := 0;
  v_threshold INTEGER := GREATEST(1, p_min_events);
BEGIN
  FOR r IN
    SELECT hour_bucket, event_type, severity, event_count
    FROM public.security_anomaly_signals
    WHERE hour_bucket >= date_trunc('hour', NOW() - INTERVAL '2 hours')
      AND severity IN ('warn', 'error', 'critical')
      AND event_count >= v_threshold
    ORDER BY hour_bucket DESC, event_count DESC
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.security_audit_logs l
      WHERE l.event_type = 'security_anomaly_alert'
        AND l.severity = r.severity
        AND COALESCE(l.context->>'source_event_type', '') = r.event_type
        AND COALESCE(l.context->>'hour_bucket', '') = r.hour_bucket::text
        AND l.created_at >= NOW() - INTERVAL '6 hours'
    ) THEN
      INSERT INTO public.security_audit_logs (
        event_type,
        severity,
        user_id,
        source,
        context
      )
      VALUES (
        'security_anomaly_alert',
        r.severity,
        NULL,
        'security-ops-monitor',
        jsonb_build_object(
          'hour_bucket', r.hour_bucket::text,
          'source_event_type', r.event_type,
          'event_count', r.event_count,
          'threshold', v_threshold
        )
      );

      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.security_create_anomaly_alerts(INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Admin ops summary view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.security_ops_status AS
SELECT
  (SELECT MAX(rotated_at) FROM public.security_key_rotations WHERE status = 'completed') AS last_key_rotation_at,
  (SELECT MIN(next_due_at) FROM public.security_pentest_schedule WHERE status IN ('scheduled', 'in_progress', 'overdue')) AS next_pentest_due_at,
  (SELECT COUNT(*)::INTEGER
   FROM public.security_audit_logs
   WHERE event_type = 'security_anomaly_alert'
     AND created_at >= NOW() - INTERVAL '24 hours') AS anomaly_alerts_24h;

REVOKE ALL ON public.security_ops_status FROM PUBLIC;
GRANT SELECT ON public.security_ops_status TO service_role;
