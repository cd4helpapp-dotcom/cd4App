-- Create patient-uploaded medical reports + AI report chat support

CREATE TABLE IF NOT EXISTS public.medical_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    file_size_bytes BIGINT,
    source TEXT NOT NULL DEFAULT 'upload',
    report_type TEXT,
    analysis_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (analysis_status IN ('pending', 'processing', 'completed', 'failed')),
    ai_summary TEXT,
    ai_key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    ai_structured JSONB NOT NULL DEFAULT '{}'::jsonb,
    extracted_text TEXT,
    analysis_error TEXT,
    analyzed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (patient_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_medical_reports_patient_created
    ON public.medical_reports(patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_medical_reports_status_created
    ON public.medical_reports(analysis_status, created_at DESC);

ALTER TABLE public.medical_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients can insert own medical reports" ON public.medical_reports;
CREATE POLICY "Patients can insert own medical reports"
    ON public.medical_reports
    FOR INSERT
    WITH CHECK (auth.uid() = patient_id);

DROP POLICY IF EXISTS "Patients can view own medical reports" ON public.medical_reports;
CREATE POLICY "Patients can view own medical reports"
    ON public.medical_reports
    FOR SELECT
    USING (auth.uid() = patient_id);

DROP POLICY IF EXISTS "Patients can update own medical reports" ON public.medical_reports;
CREATE POLICY "Patients can update own medical reports"
    ON public.medical_reports
    FOR UPDATE
    USING (auth.uid() = patient_id)
    WITH CHECK (auth.uid() = patient_id);

DROP POLICY IF EXISTS "Patients can delete own medical reports" ON public.medical_reports;
CREATE POLICY "Patients can delete own medical reports"
    ON public.medical_reports
    FOR DELETE
    USING (auth.uid() = patient_id);

CREATE TABLE IF NOT EXISTS public.medical_report_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES public.medical_reports(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medical_report_chat_report_created
    ON public.medical_report_chat_messages(report_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_medical_report_chat_patient_created
    ON public.medical_report_chat_messages(patient_id, created_at DESC);

ALTER TABLE public.medical_report_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients can insert own report chat messages" ON public.medical_report_chat_messages;
CREATE POLICY "Patients can insert own report chat messages"
    ON public.medical_report_chat_messages
    FOR INSERT
    WITH CHECK (
        auth.uid() = patient_id
        AND EXISTS (
            SELECT 1
            FROM public.medical_reports
            WHERE medical_reports.id = medical_report_chat_messages.report_id
              AND medical_reports.patient_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Patients can view own report chat messages" ON public.medical_report_chat_messages;
CREATE POLICY "Patients can view own report chat messages"
    ON public.medical_report_chat_messages
    FOR SELECT
    USING (auth.uid() = patient_id);

DROP POLICY IF EXISTS "Patients can delete own report chat messages" ON public.medical_report_chat_messages;
CREATE POLICY "Patients can delete own report chat messages"
    ON public.medical_report_chat_messages
    FOR DELETE
    USING (auth.uid() = patient_id);

-- Private storage bucket for uploaded medical reports
INSERT INTO storage.buckets (id, name, public)
VALUES ('medical-reports', 'medical-reports', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can view own medical report files" ON storage.objects;
CREATE POLICY "Users can view own medical report files"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'medical-reports'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can upload own medical report files" ON storage.objects;
CREATE POLICY "Users can upload own medical report files"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'medical-reports'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can update own medical report files" ON storage.objects;
CREATE POLICY "Users can update own medical report files"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'medical-reports'
        AND auth.uid()::text = (storage.foldername(name))[1]
    )
    WITH CHECK (
        bucket_id = 'medical-reports'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can delete own medical report files" ON storage.objects;
CREATE POLICY "Users can delete own medical report files"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'medical-reports'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );
