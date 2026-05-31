-- Migration: 20260321170000_add_ai_agent_memory_and_audit.sql
-- Description: Adds AI conversation memory + agent action audit logs for orchestrated AI flow.

CREATE TABLE IF NOT EXISTS public.ai_chat_conversation_memory (
    conversation_id UUID PRIMARY KEY REFERENCES public.ai_chat_conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    summary TEXT NOT NULL DEFAULT '',
    key_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_user_message TEXT,
    last_ai_message TEXT,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_memory_user_updated
    ON public.ai_chat_conversation_memory(user_id, updated_at DESC);

ALTER TABLE public.ai_chat_conversation_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own AI memory" ON public.ai_chat_conversation_memory;
CREATE POLICY "Users can view their own AI memory"
    ON public.ai_chat_conversation_memory
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own AI memory" ON public.ai_chat_conversation_memory;
CREATE POLICY "Users can insert their own AI memory"
    ON public.ai_chat_conversation_memory
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own AI memory" ON public.ai_chat_conversation_memory;
CREATE POLICY "Users can update their own AI memory"
    ON public.ai_chat_conversation_memory
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own AI memory" ON public.ai_chat_conversation_memory;
CREATE POLICY "Users can delete their own AI memory"
    ON public.ai_chat_conversation_memory
    FOR DELETE
    USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.ai_agent_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES public.ai_chat_conversations(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'success'
        CHECK (status IN ('success', 'fallback', 'error')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_actions_user_created
    ON public.ai_agent_actions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_agent_actions_conversation_created
    ON public.ai_agent_actions(conversation_id, created_at DESC);

ALTER TABLE public.ai_agent_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own AI agent actions" ON public.ai_agent_actions;
CREATE POLICY "Users can view their own AI agent actions"
    ON public.ai_agent_actions
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own AI agent actions" ON public.ai_agent_actions;
CREATE POLICY "Users can insert their own AI agent actions"
    ON public.ai_agent_actions
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);
