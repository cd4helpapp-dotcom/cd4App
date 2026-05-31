-- Pro subscription tracking (plan + payment audit)
-- Created: 2026-04-28

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL DEFAULT 'pro',
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'trialing', 'grace', 'cancelled', 'expired')),
  currency TEXT NOT NULL DEFAULT 'INR',
  amount_paid NUMERIC(10,2),
  payment_provider TEXT,
  payment_id TEXT,
  payment_order_id TEXT,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  next_billing_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_created
  ON public.user_subscriptions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status_expires
  ON public.user_subscriptions (status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_active_pro_subscription
  ON public.user_subscriptions (user_id, plan_code)
  WHERE status IN ('active', 'trialing', 'grace');

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.user_subscriptions(id) ON DELETE SET NULL,
  plan_code TEXT NOT NULL DEFAULT 'pro',
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  provider TEXT,
  payment_id TEXT,
  order_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'failed', 'refunded')),
  paid_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_subscription_payment_payment_id
  ON public.subscription_payments (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_payments_user_created
  ON public.subscription_payments (user_id, created_at DESC);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION public.subscription_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_subscriptions_updated_at ON public.user_subscriptions;
CREATE TRIGGER trg_user_subscriptions_updated_at
BEFORE UPDATE ON public.user_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.subscription_update_updated_at();

DROP TRIGGER IF EXISTS trg_subscription_payments_updated_at ON public.subscription_payments;
CREATE TRIGGER trg_subscription_payments_updated_at
BEFORE UPDATE ON public.subscription_payments
FOR EACH ROW
EXECUTE FUNCTION public.subscription_update_updated_at();

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

-- User can read own subscription rows
DROP POLICY IF EXISTS "Users can read own subscriptions" ON public.user_subscriptions;
CREATE POLICY "Users can read own subscriptions"
  ON public.user_subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- User can read own payment rows
DROP POLICY IF EXISTS "Users can read own subscription payments" ON public.subscription_payments;
CREATE POLICY "Users can read own subscription payments"
  ON public.subscription_payments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Edge functions (service role) manage writes
DROP POLICY IF EXISTS "Service role full access subscriptions" ON public.user_subscriptions;
CREATE POLICY "Service role full access subscriptions"
  ON public.user_subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access subscription payments" ON public.subscription_payments;
CREATE POLICY "Service role full access subscription payments"
  ON public.subscription_payments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
