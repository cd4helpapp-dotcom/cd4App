-- Persist the compact clinical context so AI chat can resume after reloads.
ALTER TABLE public.ai_chat_conversations
ADD COLUMN IF NOT EXISTS clinical_summary TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.ai_chat_conversations.clinical_summary IS
  'Compact, AI-generated factual clinical context used to resume the conversation safely.';
