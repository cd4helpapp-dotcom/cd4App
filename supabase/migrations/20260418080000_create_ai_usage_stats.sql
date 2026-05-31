-- Migration to create ai_usage_stats table for rate limiting
-- Created: 2026-04-18

CREATE TABLE IF NOT EXISTS public.ai_usage_stats (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    day_key TEXT NOT NULL, -- Format: YYYY-MM-DD
    message_count INTEGER DEFAULT 0,
    burst_count INTEGER DEFAULT 0,
    burst_window_started_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, day_key)
);

-- Enable RLS
ALTER TABLE public.ai_usage_stats ENABLE ROW LEVEL SECURITY;

-- Allow service_role to do everything (Edge Functions use Service Role for rate capping)
CREATE POLICY "Service role full access on ai_usage_stats" 
ON public.ai_usage_stats 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_ai_usage_stats_user_day ON public.ai_usage_stats(user_id, day_key);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_ai_usage_stats_updated_at
    BEFORE UPDATE ON public.ai_usage_stats
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
