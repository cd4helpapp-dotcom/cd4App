-- Recoverable E2EE key backup for chat (preview/prod continuity across reinstall on same account).

CREATE TABLE IF NOT EXISTS public.chat_e2ee_key_backups (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  wrapped_secret_key TEXT NOT NULL,
  wrap_alg TEXT NOT NULL DEFAULT 'aes-gcm-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(public_key) >= 20),
  CHECK (char_length(wrapped_secret_key) >= 20)
);

CREATE INDEX IF NOT EXISTS idx_chat_e2ee_key_backups_updated
  ON public.chat_e2ee_key_backups(updated_at DESC);

CREATE OR REPLACE FUNCTION public.chat_e2ee_key_backups_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_e2ee_key_backups_touch_updated_at ON public.chat_e2ee_key_backups;
CREATE TRIGGER trg_chat_e2ee_key_backups_touch_updated_at
BEFORE UPDATE ON public.chat_e2ee_key_backups
FOR EACH ROW
EXECUTE FUNCTION public.chat_e2ee_key_backups_touch_updated_at();

ALTER TABLE public.chat_e2ee_key_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_e2ee_key_backups_select_own" ON public.chat_e2ee_key_backups;
DROP POLICY IF EXISTS "chat_e2ee_key_backups_insert_own" ON public.chat_e2ee_key_backups;
DROP POLICY IF EXISTS "chat_e2ee_key_backups_update_own" ON public.chat_e2ee_key_backups;

CREATE POLICY "chat_e2ee_key_backups_select_own"
ON public.chat_e2ee_key_backups
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "chat_e2ee_key_backups_insert_own"
ON public.chat_e2ee_key_backups
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat_e2ee_key_backups_update_own"
ON public.chat_e2ee_key_backups
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

