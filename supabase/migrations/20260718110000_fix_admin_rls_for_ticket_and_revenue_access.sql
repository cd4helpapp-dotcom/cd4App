-- Fix admin authorization: profiles.role_id references roles.id; roles.id is not the user id.

CREATE OR REPLACE FUNCTION public.is_admin_user(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = p_user_id
      AND lower(r.slug) = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_user(UUID) TO authenticated, service_role;

-- Support tickets: admins can see and update every ticket.
DROP POLICY IF EXISTS support_tickets_admin_select_all ON public.support_tickets;
CREATE POLICY support_tickets_admin_select_all ON public.support_tickets
  FOR SELECT TO authenticated USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS support_tickets_admin_update_all ON public.support_tickets;
CREATE POLICY support_tickets_admin_update_all ON public.support_tickets
  FOR UPDATE TO authenticated
  USING (public.is_admin_user(auth.uid()))
  WITH CHECK (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS app_content_pages_admin_write ON public.app_content_pages;
CREATE POLICY app_content_pages_admin_write ON public.app_content_pages
  FOR ALL TO authenticated
  USING (public.is_admin_user(auth.uid()))
  WITH CHECK (public.is_admin_user(auth.uid()));

-- Revenue visibility.
DROP POLICY IF EXISTS "Admins can view all appointment payments" ON public.appointment_payments;
CREATE POLICY "Admins can view all appointment payments" ON public.appointment_payments
  FOR SELECT USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Admins can view all subscription payments" ON public.subscription_payments;
CREATE POLICY "Admins can view all subscription payments" ON public.subscription_payments
  FOR SELECT USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Admins can view all subscriptions" ON public.user_subscriptions;
CREATE POLICY "Admins can view all subscriptions" ON public.user_subscriptions
  FOR SELECT USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "Admins can view all doctor payouts" ON public.doctor_payouts;
CREATE POLICY "Admins can view all doctor payouts" ON public.doctor_payouts
  FOR SELECT USING (public.is_admin_user(auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_settle_doctor_payout(
  p_doctor_id UUID,
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, payout_id UUID, amount NUMERIC, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_amount NUMERIC(12,2);
  v_payout_id UUID;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'admin_only';
    RETURN;
  END IF;

  SELECT COALESCE(SUM(doctor_share), 0) INTO v_amount
  FROM public.appointment_payments
  WHERE doctor_id = p_doctor_id AND status = 'paid' AND payout_status = 'pending';
  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'no_pending_balance';
    RETURN;
  END IF;

  INSERT INTO public.doctor_payouts(doctor_id, created_by, amount, status, payment_reference, notes, paid_at)
  VALUES (p_doctor_id, auth.uid(), v_amount, 'paid', NULLIF(trim(p_payment_reference), ''), NULLIF(trim(p_notes), ''), timezone('utc', now()))
  RETURNING id INTO v_payout_id;

  UPDATE public.appointment_payments
  SET payout_status = 'paid', payout_id = v_payout_id, updated_at = timezone('utc', now())
  WHERE doctor_id = p_doctor_id AND status = 'paid' AND payout_status = 'pending';

  RETURN QUERY SELECT TRUE, v_payout_id, v_amount, 'payout_settled';
END;
$$;
