-- Preserve structured AI booking context across app reloads and conversation switches.
ALTER TABLE public.ai_chat_messages
ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.ai_chat_messages.metadata IS
  'Structured AI response context such as doctor recommendations, slot options, booking prompts, and agent steps.';
