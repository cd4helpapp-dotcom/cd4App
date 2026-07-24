-- Medicine normalization foundation.
-- The reusable dictionary is deliberately separate from patient/doctor-specific
-- prescription instructions. New entries start as pending and cannot be used
-- as verified automatic matches until an admin approves them.

CREATE TABLE IF NOT EXISTS public.medicine_dictionary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generic_name TEXT NOT NULL,
  brand_name TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  speech_variants TEXT[] NOT NULL DEFAULT '{}',
  strength_value NUMERIC,
  strength_unit TEXT,
  dosage_form TEXT,
  route TEXT,
  market TEXT NOT NULL DEFAULT 'India',
  normalized_key TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected', 'inactive')),
  source_reference TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep this migration safe if an earlier draft of the table already exists.
ALTER TABLE public.medicine_dictionary
  ADD COLUMN IF NOT EXISTS speech_variants TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_medicine_dictionary_verified_lookup
  ON public.medicine_dictionary (verification_status, active, normalized_key);
CREATE INDEX IF NOT EXISTS idx_medicine_dictionary_generic_name
  ON public.medicine_dictionary (LOWER(generic_name));
CREATE INDEX IF NOT EXISTS idx_medicine_dictionary_brand_name
  ON public.medicine_dictionary (LOWER(brand_name));
CREATE INDEX IF NOT EXISTS idx_medicine_dictionary_aliases
  ON public.medicine_dictionary USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_medicine_dictionary_speech_variants
  ON public.medicine_dictionary USING GIN (speech_variants);

CREATE TABLE IF NOT EXISTS public.prescription_medicine_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.chat_rooms(id) ON DELETE SET NULL,
  patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  medicine_dictionary_id UUID REFERENCES public.medicine_dictionary(id) ON DELETE SET NULL,
  spoken_text TEXT NOT NULL,
  normalized_name TEXT,
  strength TEXT,
  dose TEXT,
  frequency TEXT,
  duration TEXT,
  instructions TEXT,
  confidence_score NUMERIC CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  match_type TEXT NOT NULL DEFAULT 'unverified'
    CHECK (match_type IN ('exact', 'alias', 'fuzzy', 'ai_only', 'unverified')),
  doctor_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescription_medicine_matches_patient
  ON public.prescription_medicine_matches (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescription_medicine_matches_doctor
  ON public.prescription_medicine_matches (doctor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescription_medicine_matches_dictionary
  ON public.prescription_medicine_matches (medicine_dictionary_id);

CREATE TABLE IF NOT EXISTS public.medicine_dictionary_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_dictionary_id UUID NOT NULL REFERENCES public.medicine_dictionary(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'verified', 'rejected', 'deactivated', 'alias_added')),
  previous_status TEXT,
  next_status TEXT,
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  change_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.medicine_dictionary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_medicine_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_dictionary_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Verified medicines are readable" ON public.medicine_dictionary;
CREATE POLICY "Verified medicines are readable" ON public.medicine_dictionary
  FOR SELECT TO authenticated
  USING (active = TRUE AND verification_status = 'verified');

DROP POLICY IF EXISTS "Doctors can propose medicines" ON public.medicine_dictionary;
CREATE POLICY "Doctors can propose medicines" ON public.medicine_dictionary
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role_slug() IN ('doctor', 'admin'));

DROP POLICY IF EXISTS "Admins manage medicine dictionary" ON public.medicine_dictionary;
CREATE POLICY "Admins manage medicine dictionary" ON public.medicine_dictionary
  FOR UPDATE TO authenticated
  USING (public.current_user_role_slug() = 'admin')
  WITH CHECK (public.current_user_role_slug() = 'admin');

DROP POLICY IF EXISTS "Participants can view prescription matches" ON public.prescription_medicine_matches;
CREATE POLICY "Participants can view prescription matches" ON public.prescription_medicine_matches
  FOR SELECT TO authenticated
  USING (
    auth.uid() = patient_id
    OR auth.uid() = doctor_id
    OR public.current_user_role_slug() = 'admin'
  );

DROP POLICY IF EXISTS "Admins can view medicine audit" ON public.medicine_dictionary_audit;
CREATE POLICY "Admins can view medicine audit" ON public.medicine_dictionary_audit
  FOR SELECT TO authenticated
  USING (public.current_user_role_slug() = 'admin');

CREATE OR REPLACE FUNCTION public.guard_medicine_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.verification_status = 'verified'
     AND COALESCE(public.current_user_role_slug(), '') <> 'admin'
     AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Only an admin can verify a medicine dictionary entry';
  END IF;

  IF NEW.verification_status = 'verified' AND NEW.verified_at IS NULL THEN
    NEW.verified_at := NOW();
    NEW.verified_by := auth.uid();
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_medicine_verification ON public.medicine_dictionary;
CREATE TRIGGER trg_guard_medicine_verification
  BEFORE INSERT OR UPDATE ON public.medicine_dictionary
  FOR EACH ROW EXECUTE FUNCTION public.guard_medicine_verification();

CREATE OR REPLACE FUNCTION public.audit_medicine_dictionary_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  audit_action TEXT := 'updated';
BEGIN
  IF TG_OP = 'INSERT' THEN
    audit_action := 'created';
  ELSIF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    audit_action := CASE NEW.verification_status
      WHEN 'verified' THEN 'verified'
      WHEN 'rejected' THEN 'rejected'
      WHEN 'inactive' THEN 'deactivated'
      ELSE 'updated'
    END;
  ELSIF NEW.aliases IS DISTINCT FROM OLD.aliases THEN
    audit_action := 'alias_added';
  END IF;

  INSERT INTO public.medicine_dictionary_audit (
    medicine_dictionary_id, action, previous_status, next_status, changed_by, change_note
  ) VALUES (
    NEW.id, audit_action, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.verification_status END,
    NEW.verification_status, auth.uid(), NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_medicine_dictionary_change ON public.medicine_dictionary;
CREATE TRIGGER trg_audit_medicine_dictionary_change
  AFTER INSERT OR UPDATE ON public.medicine_dictionary
  FOR EACH ROW EXECUTE FUNCTION public.audit_medicine_dictionary_change();

CREATE OR REPLACE FUNCTION public.touch_prescription_medicine_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  IF NEW.doctor_confirmed = TRUE AND NEW.confirmed_at IS NULL THEN
    NEW.confirmed_at := NOW();
    NEW.confirmed_by := COALESCE(NEW.confirmed_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_prescription_medicine_match ON public.prescription_medicine_matches;
CREATE TRIGGER trg_touch_prescription_medicine_match
  BEFORE INSERT OR UPDATE ON public.prescription_medicine_matches
  FOR EACH ROW EXECUTE FUNCTION public.touch_prescription_medicine_match();

-- Safe starter aliases. They remain pending until an admin verifies them.
INSERT INTO public.medicine_dictionary
  (generic_name, brand_name, aliases, speech_variants, strength_value, strength_unit, dosage_form, route, normalized_key, source_reference)
VALUES
  ('Paracetamol', 'Dolo', ARRAY['dolo', 'dolo 650', 'pcm'], ARRAY['tolo', 'tolo 650', 'paracitamol'], 650, 'mg', 'tablet', 'oral', 'paracetamol|dolo|650|mg|tablet|india', 'CD4 starter catalog - clinical verification required'),
  ('Paracetamol', NULL, ARRAY['paracetamol', 'pcm'], ARRAY['paracitamol'], 500, 'mg', 'tablet', 'oral', 'paracetamol||500|mg|tablet|india', 'CD4 starter catalog - clinical verification required'),
  ('Azithromycin', NULL, ARRAY['azithromycin', 'azee', 'azithro'], ARRAY[]::TEXT[], NULL, 'mg', 'tablet', 'oral', 'azithromycin||tablet|india', 'CD4 starter catalog - clinical verification required'),
  ('Amoxicillin', NULL, ARRAY['amoxicillin', 'amoxycillin', 'amox'], ARRAY[]::TEXT[], NULL, 'mg', 'capsule', 'oral', 'amoxicillin||capsule|india', 'CD4 starter catalog - clinical verification required'),
  ('Cetirizine', NULL, ARRAY['cetirizine', 'cet'], ARRAY['cetrizine'], 10, 'mg', 'tablet', 'oral', 'cetirizine||10|mg|tablet|india', 'CD4 starter catalog - clinical verification required'),
  ('Levocetirizine', NULL, ARRAY['levocetirizine', 'levocet', 'levo cet'], ARRAY[]::TEXT[], 5, 'mg', 'tablet', 'oral', 'levocetirizine||5|mg|tablet|india', 'CD4 starter catalog - clinical verification required'),
  ('Pantoprazole', NULL, ARRAY['pantoprazole', 'pantocid', 'pantop'], ARRAY[]::TEXT[], 40, 'mg', 'tablet', 'oral', 'pantoprazole||40|mg|tablet|india', 'CD4 starter catalog - clinical verification required'),
  ('Ibuprofen', NULL, ARRAY['ibuprofen', 'brufen', 'ibu'], ARRAY[]::TEXT[], 400, 'mg', 'tablet', 'oral', 'ibuprofen||400|mg|tablet|india', 'CD4 starter catalog - clinical verification required'),
  ('Metformin', NULL, ARRAY['metformin', 'glycomet', 'met'], ARRAY[]::TEXT[], 500, 'mg', 'tablet', 'oral', 'metformin||500|mg|tablet|india', 'CD4 starter catalog - clinical verification required'),
  ('Amlodipine', NULL, ARRAY['amlodipine', 'amlo'], ARRAY['amlodipin'], 5, 'mg', 'tablet', 'oral', 'amlodipine||5|mg|tablet|india', 'CD4 starter catalog - clinical verification required')
ON CONFLICT (normalized_key) DO NOTHING;
