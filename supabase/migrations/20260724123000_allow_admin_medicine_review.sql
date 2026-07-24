-- Admins must be able to review pending and rejected dictionary entries.
DROP POLICY IF EXISTS "Admins can review medicine dictionary" ON public.medicine_dictionary;
CREATE POLICY "Admins can review medicine dictionary" ON public.medicine_dictionary
  FOR SELECT TO authenticated
  USING (public.current_user_role_slug() = 'admin');
