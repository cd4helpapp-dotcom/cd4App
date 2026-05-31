-- Enforce patient booking cooldown: one booking per doctor within a rolling 30-day window.
-- Admin users remain exempt for support/backoffice corrections.

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Appointments insert by patient or admin" ON public.appointments;

CREATE POLICY "Appointments insert by patient or admin"
ON public.appointments
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_user_role_slug() = 'admin'
  OR (
    patient_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1
      FROM public.appointments existing
      WHERE existing.patient_id = appointments.patient_id
        AND existing.doctor_id = appointments.doctor_id
        AND existing.status IN ('pending', 'confirmed', 'completed')
        AND existing.created_at >= (now() - interval '30 days')
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_appointments_patient_doctor_recent_non_cancelled
  ON public.appointments (patient_id, doctor_id, created_at DESC)
  WHERE status IN ('pending', 'confirmed', 'completed');
