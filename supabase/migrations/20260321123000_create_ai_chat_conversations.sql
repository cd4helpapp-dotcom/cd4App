-- Migration: 20260321123000_create_ai_chat_conversations.sql
-- Description: Adds persistent AI chat conversations/messages with RLS and recency updates.

CREATE TABLE IF NOT EXISTS public.ai_chat_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'assistant' CHECK (mode IN ('assistant', 'guided')),
    concern TEXT NOT NULL DEFAULT 'General',
    title TEXT NOT NULL DEFAULT 'AI Conversation',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_chat_conversations_id_user_unique UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sender TEXT NOT NULL CHECK (sender IN ('user', 'ai')),
    text TEXT NOT NULL,
    show_consult_now BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_chat_messages_conversation_fk
        FOREIGN KEY (conversation_id, user_id)
        REFERENCES public.ai_chat_conversations(id, user_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_conversations_user_mode_concern_updated
    ON public.ai_chat_conversations(user_id, mode, concern, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_conversation_created
    ON public.ai_chat_messages(conversation_id, created_at ASC);

ALTER TABLE public.ai_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own AI conversations" ON public.ai_chat_conversations;
CREATE POLICY "Users can view their own AI conversations"
    ON public.ai_chat_conversations
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own AI conversations" ON public.ai_chat_conversations;
CREATE POLICY "Users can insert their own AI conversations"
    ON public.ai_chat_conversations
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own AI conversations" ON public.ai_chat_conversations;
CREATE POLICY "Users can update their own AI conversations"
    ON public.ai_chat_conversations
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own AI conversations" ON public.ai_chat_conversations;
CREATE POLICY "Users can delete their own AI conversations"
    ON public.ai_chat_conversations
    FOR DELETE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own AI messages" ON public.ai_chat_messages;
CREATE POLICY "Users can view their own AI messages"
    ON public.ai_chat_messages
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own AI messages" ON public.ai_chat_messages;
CREATE POLICY "Users can insert their own AI messages"
    ON public.ai_chat_messages
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own AI messages" ON public.ai_chat_messages;
CREATE POLICY "Users can update their own AI messages"
    ON public.ai_chat_messages
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own AI messages" ON public.ai_chat_messages;
CREATE POLICY "Users can delete their own AI messages"
    ON public.ai_chat_messages
    FOR DELETE
    USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_ai_chat_conversation_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_ai_chat_conversation_updated_at ON public.ai_chat_conversations;
CREATE TRIGGER trg_set_ai_chat_conversation_updated_at
    BEFORE UPDATE ON public.ai_chat_conversations
    FOR EACH ROW
    EXECUTE FUNCTION public.set_ai_chat_conversation_updated_at();

CREATE OR REPLACE FUNCTION public.touch_ai_chat_conversation_from_message()
RETURNS trigger AS $$
BEGIN
    UPDATE public.ai_chat_conversations
    SET updated_at = COALESCE(NEW.created_at, NOW())
    WHERE id = NEW.conversation_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_touch_ai_chat_conversation_from_message ON public.ai_chat_messages;
CREATE TRIGGER trg_touch_ai_chat_conversation_from_message
    AFTER INSERT ON public.ai_chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_ai_chat_conversation_from_message();
