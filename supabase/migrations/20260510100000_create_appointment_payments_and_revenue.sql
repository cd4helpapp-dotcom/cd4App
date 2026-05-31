CREATE TABLE IF NOT EXISTS public.appointment_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NULL REFERENCES public.appointments(id) ON DELETE SET NULL,
  patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  order_id TEXT NOT NULL,
  payment_id TEXT NULL,
  signature TEXT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed','refunded')),
  gross_amount NUMERIC(10,2) NOT NULL,
  doctor_share NUMERIC(10,2) NOT NULL,
  platform_commission NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  paid_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_appointment_payments_doctor_created_at
  ON public.appointment_payments(doctor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_payments_status
  ON public.appointment_payments(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointment_payments_order_id
  ON public.appointment_payments(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointment_payments_payment_id
  ON public.appointment_payments(payment_id)
  WHERE payment_id IS NOT NULL;

ALTER TABLE public.appointment_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients can view own appointment payments" ON public.appointment_payments;
CREATE POLICY "Patients can view own appointment payments"
  ON public.appointment_payments FOR SELECT
  USING (auth.uid() = patient_id);

DROP POLICY IF EXISTS "Doctors can view own appointment payments" ON public.appointment_payments;
CREATE POLICY "Doctors can view own appointment payments"
  ON public.appointment_payments FOR SELECT
  USING (auth.uid() = doctor_id);

DROP POLICY IF EXISTS "Admins can view all appointment payments" ON public.appointment_payments;
CREATE POLICY "Admins can view all appointment payments"
  ON public.appointment_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = auth.uid() AND lower(r.slug) = 'admin'
    )
  );
