-- Cancel and reschedule for booked consultations, one-time doctor notification, and CD4 legal text.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS doctor_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT CHECK (cancelled_by IN ('patient', 'doctor', 'admin'));

-- Same guard as 20261102120000, now also covering the new columns.
CREATE OR REPLACE FUNCTION public.guard_appointment_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user(auth.uid()) THEN
    NEW.patient_id := OLD.patient_id;
    NEW.doctor_id := OLD.doctor_id;
    NEW.slot_id := OLD.slot_id;
    NEW.ai_report_id := OLD.ai_report_id;
    NEW.appointment_type := OLD.appointment_type;
    NEW.doctor_notified_at := OLD.doctor_notified_at;
    NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancelled_by := OLD.cancelled_by;
    IF NOT (NEW.status = 'completed' AND OLD.status IN ('pending', 'confirmed')) THEN
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Patients can cancel up to 2 hours before the slot; doctors until it starts. The caller refunds the returned payment.
-- A slot a patient cancelled reopens for booking. A slot the doctor cancelled stays closed, because the doctor is unavailable then.
CREATE OR REPLACE FUNCTION public.cancel_appointment_booking(p_appointment_id UUID, p_actor_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_slot public.slots%ROWTYPE;
  v_starts_at TIMESTAMPTZ;
  v_actor TEXT;
  v_payment public.appointment_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'message', 'not_found'); END IF;

  v_actor := CASE
    WHEN v_appointment.patient_id = p_actor_id THEN 'patient'
    WHEN v_appointment.doctor_id = p_actor_id THEN 'doctor'
    WHEN public.is_admin_user(p_actor_id) THEN 'admin'
  END;
  IF v_actor IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'not_allowed'); END IF;
  IF v_appointment.status NOT IN ('pending', 'confirmed') THEN RETURN jsonb_build_object('success', false, 'message', 'not_active'); END IF;

  SELECT * INTO v_slot FROM public.slots WHERE id = v_appointment.slot_id FOR UPDATE;
  v_starts_at := (v_slot.date + v_slot.start_time) AT TIME ZONE 'Asia/Kolkata';
  IF v_starts_at <= now() THEN RETURN jsonb_build_object('success', false, 'message', 'already_started'); END IF;
  IF v_actor = 'patient' AND v_starts_at < now() + interval '2 hours' THEN
    RETURN jsonb_build_object('success', false, 'message', 'too_late');
  END IF;

  UPDATE public.appointments
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor
  WHERE id = v_appointment.id;
  UPDATE public.slots
  SET is_booked = (v_actor <> 'patient'), appointment_id = NULL
  WHERE id = v_slot.id;

  SELECT * INTO v_payment FROM public.appointment_payments
  WHERE appointment_id = v_appointment.id AND status = 'paid'
  LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_by', v_actor,
    'patient_id', v_appointment.patient_id,
    'doctor_id', v_appointment.doctor_id,
    'date', v_slot.date,
    'start_time', v_slot.start_time,
    'payment_row_id', v_payment.id,
    'razorpay_payment_id', v_payment.payment_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_appointment_booking(p_appointment_id UUID, p_patient_id UUID, p_new_slot_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appointment public.appointments%ROWTYPE;
  v_old public.slots%ROWTYPE;
  v_new public.slots%ROWTYPE;
BEGIN
  SELECT * INTO v_appointment FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'message', 'not_found'); END IF;
  IF v_appointment.patient_id <> p_patient_id THEN RETURN jsonb_build_object('success', false, 'message', 'not_allowed'); END IF;
  IF v_appointment.status NOT IN ('pending', 'confirmed') THEN RETURN jsonb_build_object('success', false, 'message', 'not_active'); END IF;

  SELECT * INTO v_old FROM public.slots WHERE id = v_appointment.slot_id FOR UPDATE;
  IF (v_old.date + v_old.start_time) AT TIME ZONE 'Asia/Kolkata' < now() + interval '2 hours' THEN
    RETURN jsonb_build_object('success', false, 'message', 'too_late');
  END IF;

  SELECT * INTO v_new FROM public.slots WHERE id = p_new_slot_id FOR UPDATE;
  IF NOT FOUND OR v_new.doctor_id <> v_appointment.doctor_id OR v_new.is_booked
     OR (v_new.date + v_new.start_time) AT TIME ZONE 'Asia/Kolkata' <= now() THEN
    RETURN jsonb_build_object('success', false, 'message', 'slot_unavailable');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.appointment_payments ap
    WHERE ap.slot_id = v_new.id AND ap.status = 'created' AND ap.patient_id <> p_patient_id
      AND ap.created_at > timezone('utc', now()) - interval '5 minutes'
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'slot_on_hold');
  END IF;

  UPDATE public.slots SET is_booked = FALSE, appointment_id = NULL WHERE id = v_old.id;
  UPDATE public.slots SET is_booked = TRUE, appointment_id = v_appointment.id WHERE id = v_new.id;
  UPDATE public.appointments SET slot_id = v_new.id WHERE id = v_appointment.id;
  UPDATE public.appointment_payments SET slot_id = v_new.id WHERE appointment_id = v_appointment.id;

  RETURN jsonb_build_object(
    'success', true,
    'patient_id', v_appointment.patient_id,
    'doctor_id', v_appointment.doctor_id,
    'date', v_new.date,
    'start_time', v_new.start_time
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_appointment_booking(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_appointment_booking(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.reschedule_appointment_booking(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment_booking(UUID, UUID, UUID) TO service_role;

-- Only a patient's own AI report can be linked to their booking.
CREATE OR REPLACE FUNCTION public.guard_appointment_report_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.ai_report_id IS NOT NULL AND NEW.ai_report_id IS DISTINCT FROM COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.ai_report_id END, NULL)
     AND NOT EXISTS (SELECT 1 FROM public.ai_triage_reports r WHERE r.id = NEW.ai_report_id AND r.patient_id = NEW.patient_id) THEN
    NEW.ai_report_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_appointment_report_owner ON public.appointments;
CREATE TRIGGER guard_appointment_report_owner
BEFORE INSERT OR UPDATE OF ai_report_id ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.guard_appointment_report_owner();

-- Legal pages still carried the old product name. Only those rows change, so text an admin has since edited stays.
UPDATE public.app_content_pages
SET title = 'Contact & Support',
    body = $legal$For help with your account, appointments, payments or reports, write to support@cd4.app.

Please include your registered email or phone number, a short description of the issue and a screenshot if you have one. For a payment question, include the payment ID shown in Payment history.

We usually reply within 24 to 48 hours.

In a medical emergency do not wait for a reply. Call 112 or go to the nearest hospital.$legal$,
    updated_at = now()
WHERE key = 'support' AND (body ILIKE '%reveda%' OR title ILIKE '%reveda%');

UPDATE public.app_content_pages
SET title = 'Terms & Service',
    body = $legal$By using CD4 you agree to these terms.

# What CD4 is
CD4 connects patients with verified doctors and provides AI-assisted health information. CD4 AI guidance and report explanations are for information only. They are not a diagnosis, a prescription or a replacement for a doctor.

# Emergencies
CD4 is not an emergency service. For a medical emergency, call 112 or go to the nearest hospital.

# Your account
Keep your login private and give accurate information. Confirm medical decisions with a qualified doctor. Misuse, abuse or attempts at unauthorised access may lead to your account being restricted.

# Consultations and payments
The consultation fee is shown before you pay and is charged through Razorpay. You can cancel or reschedule from My appointments up to 2 hours before your slot. A cancelled consultation is refunded in full to your original payment method, which usually takes 5 to 7 working days. If a doctor cancels, you are refunded in full. Within 2 hours of the slot, contact support.

# Doctors
Doctors are independent professionals and are responsible for the medical advice they give.

# Questions
Write to support@cd4.app.$legal$,
    updated_at = now()
WHERE key = 'terms' AND (body ILIKE '%reveda%' OR title ILIKE '%reveda%');

UPDATE public.app_content_pages
SET title = 'Privacy Policy',
    body = $legal$CD4 protects your personal and health information. This policy explains what we collect, why, and the choices you have.

# Information we collect
Account details: name, email, phone number, age, gender and profile photo.
Health information: symptoms and questions you share, conversations with CD4 AI, reports and prescriptions you upload, and consultation records.
Voice and media: microphone input for the voice assistant and calls, and camera for video consultations and photographing documents.
Location: used to show nearby doctors and services.
Payments: payment IDs and status. Card and bank details are handled by Razorpay and are not stored by CD4.

# How we use it
To run consultations, chat and appointments, provide AI health guidance and report explanations, prepare a short summary for the doctor you book, send reminders and alerts, and keep the service secure.

# Who sees your information
The doctor you book sees your summary and the reports linked to that appointment. We use service providers only to run CD4: Supabase (database and storage), Agora (calls), OpenAI and Google (AI processing), Razorpay (payments), Google Sign-In and Expo (sign-in and notifications). We do not sell your personal or health data.

# Security
Data is encrypted in transit and access is limited by account role.

# Keeping and deleting data
We keep data while your account is active or as the law requires. To delete your account and health data, go to Settings, Help & Support, Delete account, or write to support@cd4.app. Deletion is completed within 30 days.

# Medical disclaimer
CD4 AI gives information only. It is not medical advice, a diagnosis or treatment. In an emergency call 112 or go to the nearest hospital.

# Children
CD4 is not for unsupervised use by anyone under 18. Minors may use it only with a parent or guardian.

# Changes and contact
We post changes here with a new date. For questions or complaints, write to support@cd4.app.$legal$,
    updated_at = now()
WHERE key = 'privacy_policy' AND (body ILIKE '%reveda%' OR title ILIKE '%reveda%');
