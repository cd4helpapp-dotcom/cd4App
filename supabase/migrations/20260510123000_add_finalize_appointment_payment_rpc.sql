CREATE OR REPLACE FUNCTION public.finalize_appointment_payment(
  p_payment_id UUID,
  p_patient_id UUID,
  p_razorpay_payment_id TEXT,
  p_signature TEXT,
  p_ai_report_id UUID DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  appointment_id UUID,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment public.appointment_payments%ROWTYPE;
  v_slot public.slots%ROWTYPE;
  v_appointment_id UUID;
BEGIN
  SELECT *
  INTO v_payment
  FROM public.appointment_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'payment_not_found';
    RETURN;
  END IF;

  IF v_payment.patient_id <> p_patient_id THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'payment_patient_mismatch';
    RETURN;
  END IF;

  IF v_payment.status = 'paid' AND v_payment.appointment_id IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_payment.appointment_id, 'already_booked';
    RETURN;
  END IF;

  IF v_payment.status <> 'created' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'payment_status_invalid';
    RETURN;
  END IF;

  SELECT *
  INTO v_slot
  FROM public.slots
  WHERE id = v_payment.slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'slot_not_found';
    RETURN;
  END IF;

  IF v_slot.is_booked THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'slot_already_booked';
    RETURN;
  END IF;

  INSERT INTO public.appointments (
    patient_id,
    doctor_id,
    slot_id,
    status,
    ai_report_id
  )
  VALUES (
    p_patient_id,
    v_payment.doctor_id,
    v_payment.slot_id,
    'confirmed',
    p_ai_report_id
  )
  RETURNING id INTO v_appointment_id;

  UPDATE public.slots
  SET
    is_booked = TRUE,
    appointment_id = v_appointment_id
  WHERE id = v_payment.slot_id;

  UPDATE public.appointment_payments
  SET
    appointment_id = v_appointment_id,
    payment_id = p_razorpay_payment_id,
    signature = p_signature,
    status = 'paid',
    paid_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  WHERE id = v_payment.id;

  RETURN QUERY SELECT TRUE, v_appointment_id, 'booked';
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_appointment_payment(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_appointment_payment(UUID, UUID, TEXT, TEXT, UUID) TO service_role;
