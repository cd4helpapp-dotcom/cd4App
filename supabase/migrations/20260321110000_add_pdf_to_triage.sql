-- Add PDF URL to triage reports
ALTER TABLE public.ai_triage_reports ADD COLUMN IF NOT EXISTS pdf_url TEXT;

-- Create Storage Bucket for AI Reports
INSERT INTO storage.buckets (id, name, public)
VALUES ('ai-reports', 'ai-reports', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies for AI Reports
-- Allow authenticated users to upload their own reports (handled by service role in Edge Function, but good to have)
CREATE POLICY "Users can upload their own reports"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'ai-reports');

-- Allow doctors and the patient to view the reports
CREATE POLICY "Reports are viewable by authenticated users"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'ai-reports');
