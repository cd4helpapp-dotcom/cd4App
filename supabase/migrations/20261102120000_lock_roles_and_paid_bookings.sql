-- Closes three holes in the patient-facing API:
--   1. Anyone could become admin: signup trusted the role in client metadata, and users could edit their own role_id.
--   2. Bookings could skip payment: patients could insert confirmed appointments directly. Doctors could self-verify.
--   3. A paid booking could fail: finalize rejected payments the webhook had already marked paid or failed.

-- 1. Roles ------------------------------------------------------------------------------------------------------------

-- Public signup can only produce patient or doctor (doctors stay unverified until an admin approves them).
-- Hospital accounts come from submit-hospital-onboarding through app_metadata, which public signup cannot set.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  target_role_slug TEXT;
  target_role_id UUID;
  normalized_email TEXT;
  doctor_city TEXT;
  doctor_specialization TEXT;
  doctor_experience TEXT;
  doctor_fee TEXT;
  doctor_bio TEXT;
  doctor_registration_number TEXT;
BEGIN
  normalized_email := lower(COALESCE(new.email, ''));

  IF normalized_email IN (
    'navinchandra665@gmail.com',
    'nitesh2kaushik@gmail.com',
    'prem31703@gmail.com'
  ) THEN
    target_role_slug := 'admin';
  ELSIF new.raw_app_meta_data->>'role' = 'hospital' THEN
    target_role_slug := 'hospital';
  ELSIF new.raw_user_meta_data->>'role' = 'doctor' THEN
    target_role_slug := 'doctor';
  ELSE
    target_role_slug := 'patient';
  END IF;

  SELECT id INTO target_role_id FROM public.roles WHERE slug = target_role_slug LIMIT 1;
  IF target_role_id IS NULL THEN
    SELECT id INTO target_role_id FROM public.roles WHERE slug = 'patient' LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, first_name, last_name, email, phone_number, role_id)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'first_name', 'User'),
    COALESCE(new.raw_user_meta_data->>'last_name', ''),
    new.email,
    new.phone,
    target_role_id
  )
  ON CONFLICT (id) DO UPDATE
  SET role_id = EXCLUDED.role_id,
      updated_at = NOW();

  IF target_role_slug = 'admin' THEN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin'),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
    WHERE id = new.id;
  END IF;

  IF target_role_slug = 'doctor' THEN
    doctor_city := COALESCE(NULLIF(new.raw_user_meta_data->>'city', ''), 'City Not Set');
    doctor_specialization := COALESCE(NULLIF(new.raw_user_meta_data->>'specialization', ''), 'General Medicine');
    doctor_experience := COALESCE(NULLIF(new.raw_user_meta_data->>'experience', ''), '0 Years');
    doctor_fee := COALESCE(NULLIF(new.raw_user_meta_data->>'fee', ''), '₹0');
    doctor_bio := COALESCE(new.raw_user_meta_data->>'bio', '');
    doctor_registration_number := COALESCE(
      NULLIF(new.raw_user_meta_data->>'registration_number', ''),
      'AUTO-' || replace(new.id::text, '-', '')
    );

    INSERT INTO public.doctors (
      id,
      city,
      specialization,
      experience,
      fee,
      bio,
      registration_number,
      kyc_verify,
      documents,
      rating
    )
    VALUES (
      new.id,
      doctor_city,
      doctor_specialization,
      doctor_experience,
      doctor_fee,
      doctor_bio,
      doctor_registration_number,
      false,
      ARRAY[]::text[],
      0
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- The guards below keep the old value instead of raising, so a normal "save profile" that sends these columns still works.
-- auth.uid() is NULL for the service role, the SQL editor and auth triggers, which stay allowed.
CREATE OR REPLACE FUNCTION public.guard_profile_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user(auth.uid()) THEN
    NEW.role_id := OLD.role_id;
    NEW.is_verified := OLD.is_verified;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_protected_columns ON public.profiles;
CREATE TRIGGER guard_profile_protected_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profile_protected_columns();

-- 2. Doctors, appointments, slots -------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_doctor_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user(auth.uid()) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.is_verified := FALSE;
      NEW.kyc_verify := FALSE;
      NEW.rating := 0;
    ELSE
      NEW.is_verified := OLD.is_verified;
      NEW.kyc_verify := OLD.kyc_verify;
      NEW.rating := OLD.rating;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_doctor_protected_columns ON public.doctors;
CREATE TRIGGER guard_doctor_protected_columns
BEFORE INSERT OR UPDATE ON public.doctors
FOR EACH ROW
EXECUTE FUNCTION public.guard_doctor_protected_columns();

-- Bookings are created only by finalize_appointment_payment (service role), after payment.
DROP POLICY IF EXISTS "Appointments insert by patient or admin" ON public.appointments;
DROP POLICY IF EXISTS "Appointments insert by admin" ON public.appointments;
CREATE POLICY "Appointments insert by admin"
ON public.appointments
FOR INSERT
TO authenticated
WITH CHECK (public.current_user_role_slug() = 'admin');

-- Participants may only mark a consultation completed (the call screen does this when a call ends).
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
    IF NOT (NEW.status = 'completed' AND OLD.status IN ('pending', 'confirmed')) THEN
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_appointment_protected_columns ON public.appointments;
CREATE TRIGGER guard_appointment_protected_columns
BEFORE UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.guard_appointment_protected_columns();

-- The app never updates slots; booking state changes only inside finalize_appointment_payment.
DROP POLICY IF EXISTS "Slots update by linked users" ON public.slots;
DROP POLICY IF EXISTS "Slots update by admin" ON public.slots;
CREATE POLICY "Slots update by admin"
ON public.slots
FOR UPDATE
TO authenticated
USING (public.current_user_role_slug() = 'admin')
WITH CHECK (public.current_user_role_slug() = 'admin');

-- Deleting a slot cascades to its payment rows, so keep it while a patient may still be paying for it.
DROP POLICY IF EXISTS "Slots delete own unbooked" ON public.slots;
CREATE POLICY "Slots delete own unbooked"
ON public.slots
FOR DELETE
TO authenticated
USING (
  doctor_id = auth.uid()
  AND COALESCE(is_booked, false) = false
  AND NOT EXISTS (
    SELECT 1
    FROM public.appointment_payments ap
    WHERE ap.slot_id = slots.id
      AND ap.status = 'created'
      AND ap.created_at > timezone('utc', now()) - interval '15 minutes'
  )
);

-- 3. Paid bookings ----------------------------------------------------------------------------------------------------

-- A failed attempt can be followed by a successful one on the same Razorpay order, so 'failed' can still book.
-- The webhook passes NULL for the signature, which only the app's verify call has.
CREATE OR REPLACE FUNCTION public.finalize_appointment_payment(
  p_payment_id UUID,
  p_patient_id UUID,
  p_razorpay_payment_id TEXT,
  p_signature TEXT,
  p_ai_report_id UUID DEFAULT NULL
)
RETURNS TABLE (success BOOLEAN, appointment_id UUID, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.appointment_payments%ROWTYPE;
  v_slot public.slots%ROWTYPE;
  v_appointment_id UUID;
  v_appointment_type TEXT;
BEGIN
  SELECT * INTO v_payment FROM public.appointment_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'payment_not_found'; RETURN; END IF;
  IF v_payment.patient_id <> p_patient_id THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'payment_patient_mismatch'; RETURN; END IF;
  IF v_payment.appointment_id IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_payment.appointment_id, 'already_booked'; RETURN;
  END IF;
  IF v_payment.status NOT IN ('created', 'failed', 'paid') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'payment_status_invalid'; RETURN;
  END IF;
  SELECT * INTO v_slot FROM public.slots WHERE id = v_payment.slot_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'slot_not_found'; RETURN; END IF;
  IF v_slot.is_booked THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'slot_already_booked'; RETURN; END IF;

  v_appointment_type := CASE WHEN v_payment.metadata ->> 'appointment_type' = 'second_opinion' THEN 'second_opinion' ELSE 'consultation' END;
  INSERT INTO public.appointments (patient_id, doctor_id, slot_id, status, ai_report_id, appointment_type)
  VALUES (p_patient_id, v_payment.doctor_id, v_payment.slot_id, 'confirmed', p_ai_report_id, v_appointment_type)
  RETURNING id INTO v_appointment_id;
  UPDATE public.slots SET is_booked = TRUE, appointment_id = v_appointment_id WHERE id = v_payment.slot_id;
  UPDATE public.appointment_payments
  SET appointment_id = v_appointment_id,
      payment_id = COALESCE(p_razorpay_payment_id, public.appointment_payments.payment_id),
      signature = COALESCE(p_signature, public.appointment_payments.signature),
      status = 'paid', paid_at = timezone('utc', now()), updated_at = timezone('utc', now())
  WHERE id = v_payment.id;
  RETURN QUERY SELECT TRUE, v_appointment_id, 'booked';
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_appointment_payment(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_appointment_payment(UUID, UUID, TEXT, TEXT, UUID) TO service_role;

-- A payment is 'paid' without a booking while its refund is being retried; the doctor has earned nothing in that case.
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
     AND NEW.appointment_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid' OR OLD.appointment_id IS NULL)
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
AFTER INSERT OR UPDATE OF status, appointment_id ON public.appointment_payments
FOR EACH ROW
EXECUTE FUNCTION public.notify_doctor_on_paid_appointment_payment();
