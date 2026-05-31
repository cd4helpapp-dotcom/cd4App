-- Allow authenticated patients to read open slots before booking.
-- Previous policy only allowed doctor/admin/appointment-linked access, which hid unbooked slots.

ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Slots select for linked users" ON public.slots;

CREATE POLICY "Slots select for doctor admin participant or open"
ON public.slots
FOR SELECT
TO authenticated
USING (
  auth.uid() = doctor_id
  OR public.current_user_role_slug() = 'admin'
  OR is_booked = false
  OR EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.slot_id = slots.id
      AND (a.patient_id = auth.uid() OR a.doctor_id = auth.uid())
  )
);
