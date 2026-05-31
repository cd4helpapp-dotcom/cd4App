DROP POLICY IF EXISTS "Doctors are viewable" ON public.doctors;

CREATE POLICY "Doctors are viewable"
ON public.doctors
FOR SELECT
TO authenticated, anon
USING (
  true
);
