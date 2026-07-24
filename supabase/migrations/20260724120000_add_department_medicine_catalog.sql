-- Additive department metadata and conservative starter catalog.
-- These entries are pending by design. They are not used for automatic
-- prescription normalization until an authorised admin verifies them.

ALTER TABLE public.medicine_dictionary
  ADD COLUMN IF NOT EXISTS clinical_departments TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_medicine_dictionary_departments
  ON public.medicine_dictionary USING GIN (clinical_departments);

INSERT INTO public.medicine_dictionary
  (generic_name, brand_name, aliases, speech_variants, clinical_departments,
   strength_value, strength_unit, dosage_form, route, normalized_key, source_reference)
VALUES
  ('Oral Rehydration Salts', NULL, ARRAY['ors', 'oral rehydration solution', 'oral rehydration salts'], ARRAY[]::TEXT[], ARRAY['general-medicine', 'pediatrics', 'gastroenterology'], NULL, NULL, 'sachet', 'oral', 'oral-rehydration-salts||sachet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Ondansetron', NULL, ARRAY['ondansetron', 'ondan'], ARRAY[]::TEXT[], ARRAY['general-medicine', 'gastroenterology'], 4, 'mg', 'tablet', 'oral', 'ondansetron||4|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Omeprazole', NULL, ARRAY['omeprazole', 'omez'], ARRAY[]::TEXT[], ARRAY['gastroenterology'], 20, 'mg', 'capsule', 'oral', 'omeprazole||20|mg|capsule|india', 'CD4 department starter catalog; clinical verification required'),
  ('Rabeprazole', NULL, ARRAY['rabeprazole', 'rabeprazole'], ARRAY[]::TEXT[], ARRAY['gastroenterology'], 20, 'mg', 'tablet', 'oral', 'rabeprazole||20|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Sucralfate', NULL, ARRAY['sucralfate', 'sucral'], ARRAY[]::TEXT[], ARRAY['gastroenterology'], NULL, NULL, 'suspension', 'oral', 'sucralfate||suspension|india', 'CD4 department starter catalog; clinical verification required'),
  ('Lactulose', NULL, ARRAY['lactulose', 'lactul'], ARRAY[]::TEXT[], ARRAY['gastroenterology'], NULL, NULL, 'solution', 'oral', 'lactulose||solution|india', 'CD4 department starter catalog; clinical verification required'),
  ('Fexofenadine', NULL, ARRAY['fexofenadine', 'fexo'], ARRAY[]::TEXT[], ARRAY['respiratory-ent', 'allergy'], 120, 'mg', 'tablet', 'oral', 'fexofenadine||120|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Loratadine', NULL, ARRAY['loratadine', 'lora'], ARRAY[]::TEXT[], ARRAY['respiratory-ent', 'allergy'], 10, 'mg', 'tablet', 'oral', 'loratadine||10|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Montelukast', NULL, ARRAY['montelukast', 'montair', 'mont'], ARRAY[]::TEXT[], ARRAY['respiratory-ent', 'allergy'], 10, 'mg', 'tablet', 'oral', 'montelukast||10|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Salbutamol', NULL, ARRAY['salbutamol', 'albuterol', 'salbutamol inhaler'], ARRAY[]::TEXT[], ARRAY['respiratory-ent'], NULL, NULL, 'inhaler', 'inhaled', 'salbutamol||inhaler|india', 'CD4 department starter catalog; clinical verification required'),
  ('Budesonide', NULL, ARRAY['budesonide', 'budecort'], ARRAY[]::TEXT[], ARRAY['respiratory-ent'], NULL, NULL, 'inhaler', 'inhaled', 'budesonide||inhaler|india', 'CD4 department starter catalog; clinical verification required'),
  ('Clotrimazole', NULL, ARRAY['clotrimazole', 'candid'], ARRAY[]::TEXT[], ARRAY['dermatology'], 1, '%', 'cream', 'topical', 'clotrimazole||1|%|cream|india', 'CD4 department starter catalog; clinical verification required'),
  ('Terbinafine', NULL, ARRAY['terbinafine', 'terbisil'], ARRAY[]::TEXT[], ARRAY['dermatology'], 1, '%', 'cream', 'topical', 'terbinafine||1|%|cream|india', 'CD4 department starter catalog; clinical verification required'),
  ('Hydrocortisone', NULL, ARRAY['hydrocortisone'], ARRAY[]::TEXT[], ARRAY['dermatology'], 1, '%', 'cream', 'topical', 'hydrocortisone||1|%|cream|india', 'CD4 department starter catalog; clinical verification required'),
  ('Mupirocin', NULL, ARRAY['mupirocin', 'mupirocin ointment'], ARRAY[]::TEXT[], ARRAY['dermatology'], 2, '%', 'ointment', 'topical', 'mupirocin||2|%|ointment|india', 'CD4 department starter catalog; clinical verification required'),
  ('Losartan', NULL, ARRAY['losartan', 'losar'], ARRAY[]::TEXT[], ARRAY['cardiology', 'hypertension'], 50, 'mg', 'tablet', 'oral', 'losartan||50|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Telmisartan', NULL, ARRAY['telmisartan', 'telma'], ARRAY[]::TEXT[], ARRAY['cardiology', 'hypertension'], 40, 'mg', 'tablet', 'oral', 'telmisartan||40|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Atorvastatin', NULL, ARRAY['atorvastatin', 'atorva'], ARRAY[]::TEXT[], ARRAY['cardiology', 'lipid-management'], 10, 'mg', 'tablet', 'oral', 'atorvastatin||10|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Glimepiride', NULL, ARRAY['glimepiride', 'glim'], ARRAY[]::TEXT[], ARRAY['diabetes'], 1, 'mg', 'tablet', 'oral', 'glimepiride||1|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Folic Acid', NULL, ARRAY['folic acid', 'folate'], ARRAY[]::TEXT[], ARRAY['women-health', 'general-medicine'], 5, 'mg', 'tablet', 'oral', 'folic-acid||5|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Ferrous Sulfate', NULL, ARRAY['ferrous sulfate', 'iron tablet'], ARRAY[]::TEXT[], ARRAY['women-health', 'general-medicine'], NULL, NULL, 'tablet', 'oral', 'ferrous-sulfate||tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Calcium Carbonate', NULL, ARRAY['calcium carbonate', 'calcium tablet'], ARRAY[]::TEXT[], ARRAY['women-health', 'orthopedics'], 500, 'mg', 'tablet', 'oral', 'calcium-carbonate||500|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Diclofenac', NULL, ARRAY['diclofenac', 'diclo'], ARRAY[]::TEXT[], ARRAY['orthopedics'], 50, 'mg', 'tablet', 'oral', 'diclofenac||50|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Naproxen', NULL, ARRAY['naproxen', 'naprosyn'], ARRAY[]::TEXT[], ARRAY['orthopedics'], 250, 'mg', 'tablet', 'oral', 'naproxen||250|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Cefixime', NULL, ARRAY['cefixime', 'cefix'], ARRAY[]::TEXT[], ARRAY['infection', 'general-medicine'], 200, 'mg', 'tablet', 'oral', 'cefixime||200|mg|tablet|india', 'CD4 department starter catalog; clinical verification required'),
  ('Doxycycline', NULL, ARRAY['doxycycline', 'doxy'], ARRAY[]::TEXT[], ARRAY['infection', 'dermatology'], 100, 'mg', 'capsule', 'oral', 'doxycycline||100|mg|capsule|india', 'CD4 department starter catalog; clinical verification required')
ON CONFLICT (normalized_key) DO NOTHING;
