-- Debounced, hospital-scoped doctor search for patient assignment.
CREATE OR REPLACE FUNCTION public.hospital_search_doctors(p_query TEXT)
RETURNS TABLE (
  id UUID,
  doctor_id UUID,
  status TEXT,
  department TEXT,
  name TEXT,
  email TEXT,
  phone_number TEXT,
  specialization TEXT,
  city TEXT,
  registration_number TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  query_text TEXT := lower(trim(COALESCE(p_query, '')));
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role_slug() <> 'hospital' THEN
    RAISE EXCEPTION 'Hospital admin access required';
  END IF;

  IF length(query_text) < 3 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    hd.id,
    hd.doctor_id,
    hd.status,
    hd.department,
    trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS name,
    p.email,
    p.phone_number,
    d.specialization,
    d.city,
    d.registration_number,
    hd.created_at
  FROM public.hospital_doctors hd
  JOIN public.doctors d ON d.id = hd.doctor_id
  JOIN public.profiles p ON p.id = d.id
  WHERE hd.hospital_admin_user_id = auth.uid()
    AND hd.status = 'active'
    AND (
      lower(trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))) LIKE '%' || query_text || '%'
      OR lower(COALESCE(p.email, '')) LIKE '%' || query_text || '%'
      OR lower(COALESCE(d.specialization, '')) LIKE '%' || query_text || '%'
      OR lower(COALESCE(hd.department, '')) LIKE '%' || query_text || '%'
    )
  ORDER BY name
  LIMIT 25;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hospital_search_doctors(TEXT) TO authenticated;
