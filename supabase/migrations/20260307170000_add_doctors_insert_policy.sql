-- Allow authenticated users to insert their own doctor profile row.
-- Required for doctor onboarding flow where id must match auth.uid().
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Doctors can insert their own info" ON public.doctors;
CREATE POLICY "Doctors can insert their own info"
ON public.doctors
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);
