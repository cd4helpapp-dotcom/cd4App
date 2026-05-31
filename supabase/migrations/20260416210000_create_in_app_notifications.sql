-- Create in_app_notifications table
CREATE TABLE IF NOT EXISTS public.in_app_notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS in_app_notifications_user_id_idx ON public.in_app_notifications(user_id);
CREATE INDEX IF NOT EXISTS in_app_notifications_is_read_idx ON public.in_app_notifications(is_read);
CREATE INDEX IF NOT EXISTS in_app_notifications_created_at_idx ON public.in_app_notifications(created_at DESC);

-- Allow row level security
ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own notifications" 
    ON public.in_app_notifications FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications" 
    ON public.in_app_notifications FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "System can insert notifications" 
    ON public.in_app_notifications FOR INSERT 
    WITH CHECK (true);

-- Create a realtime publication for this table so users can subscribe to their notifications
-- We use a DO block to avoid error if it's already in the publication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'in_app_notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE in_app_notifications;
    END IF;
END $$;
