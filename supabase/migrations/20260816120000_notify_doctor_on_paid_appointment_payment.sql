-- Notify the doctor when an appointment payment becomes paid.
-- This covers both client-side payment verification and Razorpay webhooks.
CREATE OR REPLACE FUNCTION public.notify_doctor_on_paid_appointment_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_patient_name TEXT;
BEGIN
  IF NEW.status = 'paid'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid')
     AND NEW.doctor_id IS NOT NULL THEN
    SELECT NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '')
      INTO v_patient_name
    FROM public.profiles p
    WHERE p.id = NEW.patient_id;

    INSERT INTO public.in_app_notifications (
      user_id,
      type,
      title,
      body,
      data
    )
    VALUES (
      NEW.doctor_id,
      'payment',
      'Payment received',
      format(
        'Payment of ₹%s received from %s for an appointment.',
        trim(to_char(COALESCE(NEW.doctor_share, NEW.gross_amount), 'FM999999990.00')),
        COALESCE(v_patient_name, 'a patient')
      ),
      jsonb_build_object(
        'paymentId', NEW.id,
        'appointmentId', NEW.appointment_id,
        'doctorId', NEW.doctor_id,
        'patientId', NEW.patient_id,
        'amount', COALESCE(NEW.doctor_share, NEW.gross_amount),
        'currency', NEW.currency,
        'status', NEW.status
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointment_payment_paid_notification
  ON public.appointment_payments;

CREATE TRIGGER appointment_payment_paid_notification
AFTER INSERT OR UPDATE OF status ON public.appointment_payments
FOR EACH ROW
EXECUTE FUNCTION public.notify_doctor_on_paid_appointment_payment();

