-- A doctor's signature or stamp for prescriptions. The image lives in the private doctor-kyc bucket, in the doctor's own folder.
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS signature_path TEXT;
