-- Soft delete support for uploaded medical reports

ALTER TABLE public.medical_reports
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_medical_reports_patient_active_created
    ON public.medical_reports(patient_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_medical_reports_deleted_at
    ON public.medical_reports(deleted_at DESC);
