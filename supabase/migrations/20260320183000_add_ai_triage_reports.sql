-- Create AI Triage Reports table
CREATE TABLE IF NOT EXISTS public.ai_triage_reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    patient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    concern TEXT NOT NULL,
    chat_history JSONB NOT NULL,
    summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add ai_report_id to appointments
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_report_id UUID REFERENCES public.ai_triage_reports(id) ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE public.ai_triage_reports ENABLE ROW LEVEL SECURITY;

-- Policies for AI Triage Reports
DROP POLICY IF EXISTS "Patients can insert their own reports" ON public.ai_triage_reports;
CREATE POLICY "Patients can insert their own reports" ON public.ai_triage_reports FOR INSERT WITH CHECK (auth.uid() = patient_id);

DROP POLICY IF EXISTS "Patients can view their own reports" ON public.ai_triage_reports;
CREATE POLICY "Patients can view their own reports" ON public.ai_triage_reports FOR SELECT USING (auth.uid() = patient_id);

DROP POLICY IF EXISTS "Doctors can view reports linked to their appointments" ON public.ai_triage_reports;
CREATE POLICY "Doctors can view reports linked to their appointments" ON public.ai_triage_reports FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.appointments
        WHERE appointments.ai_report_id = ai_triage_reports.id
        AND appointments.doctor_id = auth.uid()
    )
);
