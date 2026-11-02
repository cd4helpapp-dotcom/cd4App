-- Found by reading every table as a signed-in patient and with no login at all.

-- Any signed-in user could read every doctor's whole profile row: email, phone, address, push token and settings.
-- Browsing doctors already uses the doctors_public view, and a profile page uses community_get_public_profiles.
-- A patient and doctor who share a booking or a chat still see each other through the existing linked policies.
DROP POLICY IF EXISTS "Profiles doctor directory select" ON public.profiles;

-- Security monitoring data was readable with no login.
REVOKE ALL ON public.security_anomaly_signals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.security_ops_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.security_anomaly_signals TO service_role;
GRANT SELECT ON public.security_ops_status TO service_role;

-- With no login, doctors' registration numbers and signature file paths were readable.
-- The public list stays available through doctors_public, which does not include them.
REVOKE SELECT ON public.doctors FROM anon;
