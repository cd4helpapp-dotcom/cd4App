-- Complete revenue ledger: admin visibility, doctor payout settlement and audit trail.

CREATE TABLE IF NOT EXISTS public.doctor_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','processing','paid','failed','reversed')),
  payment_reference TEXT,
  notes TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.appointment_payments
  ADD COLUMN IF NOT EXISTS payout_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payout_status IN ('pending','processing','paid','held'));
ALTER TABLE public.appointment_payments
  ADD COLUMN IF NOT EXISTS payout_id UUID REFERENCES public.doctor_payouts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_doctor_payouts_doctor_created
  ON public.doctor_payouts(doctor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_payments_payout_status
  ON public.appointment_payments(payout_status, doctor_id);

ALTER TABLE public.doctor_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all subscription payments" ON public.subscription_payments;
CREATE POLICY "Admins can view all subscription payments" ON public.subscription_payments
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.roles r WHERE r.id = auth.uid() AND lower(r.slug) = 'admin'));
DROP POLICY IF EXISTS "Admins can view all subscriptions" ON public.user_subscriptions;
CREATE POLICY "Admins can view all subscriptions" ON public.user_subscriptions
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.roles r WHERE r.id = auth.uid() AND lower(r.slug) = 'admin'));
DROP POLICY IF EXISTS "Admins can view all doctor payouts" ON public.doctor_payouts;
CREATE POLICY "Admins can view all doctor payouts" ON public.doctor_payouts
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.roles r WHERE r.id = auth.uid() AND lower(r.slug) = 'admin'));
DROP POLICY IF EXISTS "Doctors can view own payouts" ON public.doctor_payouts;
CREATE POLICY "Doctors can view own payouts" ON public.doctor_payouts
  FOR SELECT USING (auth.uid() = doctor_id);

CREATE OR REPLACE FUNCTION public.admin_settle_doctor_payout(
  p_doctor_id UUID,
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, payout_id UUID, amount NUMERIC, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin BOOLEAN;
  v_amount NUMERIC(12,2);
  v_payout_id UUID;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.roles WHERE id = auth.uid() AND lower(slug) = 'admin') INTO v_admin;
  IF NOT v_admin THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'admin_only'; RETURN; END IF;

  SELECT COALESCE(SUM(doctor_share), 0) INTO v_amount
  FROM public.appointment_payments
  WHERE doctor_id = p_doctor_id AND status = 'paid' AND payout_status = 'pending';
  IF v_amount <= 0 THEN RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'no_pending_balance'; RETURN; END IF;

  INSERT INTO public.doctor_payouts(doctor_id, created_by, amount, status, payment_reference, notes, paid_at)
  VALUES (p_doctor_id, auth.uid(), v_amount, 'paid', NULLIF(trim(p_payment_reference), ''), NULLIF(trim(p_notes), ''), timezone('utc', now()))
  RETURNING id INTO v_payout_id;

  UPDATE public.appointment_payments
  SET payout_status = 'paid', payout_id = v_payout_id, updated_at = timezone('utc', now())
  WHERE doctor_id = p_doctor_id AND status = 'paid' AND payout_status = 'pending';

  RETURN QUERY SELECT TRUE, v_payout_id, v_amount, 'payout_settled';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_settle_doctor_payout(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_settle_doctor_payout(UUID, TEXT, TEXT) TO authenticated;
