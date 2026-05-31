-- Align RLS policies with current app flows when RLS is enabled on all tables.
-- Covers: roles, profiles, doctors, slots, appointments.

CREATE OR REPLACE FUNCTION public.current_user_role_slug()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(r.slug, 'patient')
  FROM public.profiles p
  LEFT JOIN public.roles r ON r.id = p.role_id
  WHERE p.id = auth.uid()
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.current_user_role_slug() TO authenticated, anon;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Roles are readable" ON public.roles;
CREATE POLICY "Roles are readable"
ON public.roles
FOR SELECT
TO authenticated, anon
USING (true);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles own select" ON public.profiles;
DROP POLICY IF EXISTS "Profiles admin select" ON public.profiles;
DROP POLICY IF EXISTS "Profiles doctor directory select" ON public.profiles;
DROP POLICY IF EXISTS "Profiles appointment-linked select" ON public.profiles;
DROP POLICY IF EXISTS "Profiles own or admin update" ON public.profiles;

CREATE POLICY "Profiles own select"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Profiles admin select"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.current_user_role_slug() = 'admin');

CREATE POLICY "Profiles doctor directory select"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.doctors d
    WHERE d.id = profiles.id
  )
);

CREATE POLICY "Profiles appointment-linked select"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE (a.patient_id = profiles.id AND a.doctor_id = auth.uid())
       OR (a.doctor_id = profiles.id AND a.patient_id = auth.uid())
  )
);

CREATE POLICY "Profiles own or admin update"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id OR public.current_user_role_slug() = 'admin')
WITH CHECK (auth.uid() = id OR public.current_user_role_slug() = 'admin');

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view doctors" ON public.doctors;
DROP POLICY IF EXISTS "Doctors can update their own info" ON public.doctors;
DROP POLICY IF EXISTS "Doctors can insert their own info" ON public.doctors;
DROP POLICY IF EXISTS "Doctors are viewable" ON public.doctors;
DROP POLICY IF EXISTS "Doctors insert own or admin" ON public.doctors;
DROP POLICY IF EXISTS "Doctors update own or admin" ON public.doctors;

CREATE POLICY "Doctors are viewable"
ON public.doctors
FOR SELECT
TO authenticated, anon
USING (true);

CREATE POLICY "Doctors insert own or admin"
ON public.doctors
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id OR public.current_user_role_slug() = 'admin');

CREATE POLICY "Doctors update own or admin"
ON public.doctors
FOR UPDATE
TO authenticated
USING (auth.uid() = id OR public.current_user_role_slug() = 'admin')
WITH CHECK (auth.uid() = id OR public.current_user_role_slug() = 'admin');

ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Slots select for linked users" ON public.slots;
DROP POLICY IF EXISTS "Slots insert by doctor or admin" ON public.slots;
DROP POLICY IF EXISTS "Slots update by linked users" ON public.slots;

CREATE POLICY "Slots select for linked users"
ON public.slots
FOR SELECT
TO authenticated
USING (
  auth.uid() = doctor_id
  OR public.current_user_role_slug() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.slot_id = slots.id
      AND (a.patient_id = auth.uid() OR a.doctor_id = auth.uid())
  )
);

CREATE POLICY "Slots insert by doctor or admin"
ON public.slots
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = doctor_id OR public.current_user_role_slug() = 'admin');

CREATE POLICY "Slots update by linked users"
ON public.slots
FOR UPDATE
TO authenticated
USING (
  auth.uid() = doctor_id
  OR public.current_user_role_slug() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.slot_id = slots.id
      AND a.patient_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() = doctor_id
  OR public.current_user_role_slug() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.slot_id = slots.id
      AND a.patient_id = auth.uid()
  )
);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Appointments select by participant" ON public.appointments;
DROP POLICY IF EXISTS "Appointments insert by patient or admin" ON public.appointments;
DROP POLICY IF EXISTS "Appointments update by participant" ON public.appointments;

CREATE POLICY "Appointments select by participant"
ON public.appointments
FOR SELECT
TO authenticated
USING (
  patient_id = auth.uid()
  OR doctor_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);

CREATE POLICY "Appointments insert by patient or admin"
ON public.appointments
FOR INSERT
TO authenticated
WITH CHECK (
  patient_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);

CREATE POLICY "Appointments update by participant"
ON public.appointments
FOR UPDATE
TO authenticated
USING (
  patient_id = auth.uid()
  OR doctor_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
)
WITH CHECK (
  patient_id = auth.uid()
  OR doctor_id = auth.uid()
  OR public.current_user_role_slug() = 'admin'
);
