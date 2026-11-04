// @ts-nocheck
import { sendRefundEmail } from "./emailService.ts";
// The one path from "Razorpay has the money" to "the patient has a booking", used by both the app's verify call and
// the webhook, whichever arrives first. A slot lost to another patient is refunded here, so nobody pays without a slot.

const SLOT_LOST_REASONS = new Set(["slot_already_booked", "slot_not_found"]);

export const SLOT_REFUNDED_MESSAGE =
  "This slot was booked by another patient just before your payment completed. Your payment is being refunded automatically to your original payment method. Please choose another slot.";
export const SLOT_REFUND_PENDING_MESSAGE =
  "This slot was booked by another patient just before your payment completed. Your refund is being processed. If it does not reach you in 7 working days, contact support with your payment ID.";

const updatePayment = (serviceClient, id, fields) =>
  serviceClient
    .from("appointment_payments")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);

const razorpayCall = async (path, init = {}) => {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
  if (!keyId || !keySecret) return { ok: false, error: "razorpay_keys_missing" };
  try {
    const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
      ...init,
      headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`, "Content-Type": "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, payload };
    const detail = payload?.error || {};
    return { ok: false, error: [detail.code, detail.description, detail.reason, detail.field].filter(Boolean).join(" | ") || `http_${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "razorpay_call_failed" };
  }
};

// A paid order can stay "authorized": the money is only held, and Razorpay returns it after some days unless it is captured.
// Returns the payment's status after any capture, or null if Razorpay could not be reached.
export const ensureCaptured = async (razorpayPaymentId) => {
  const current = await razorpayCall(`payments/${razorpayPaymentId}`, { method: "GET" });
  if (!current.ok) return { status: null, error: current.error };
  if (current.payload?.status !== "authorized") return { status: current.payload?.status || null };
  const captured = await razorpayCall(`payments/${razorpayPaymentId}/capture`, {
    method: "POST",
    body: JSON.stringify({ amount: current.payload.amount, currency: current.payload.currency || "INR" }),
  });
  return captured.ok ? { status: "captured" } : { status: "authorized", error: captured.error };
};

const requestRazorpayRefund = async (razorpayPaymentId, reason) => {
  // Only a captured payment can be refunded.
  const { status, error: captureError } = await ensureCaptured(razorpayPaymentId);
  const refunded = await razorpayCall(`payments/${razorpayPaymentId}/refund`, {
    method: "POST",
    body: JSON.stringify({ notes: { reason } }),
  });
  if (refunded.ok && refunded.payload?.id) return { refund: refunded.payload };
  return { error: `${refunded.error || "razorpay_refund_failed"} (payment status: ${status || "unknown"}${captureError ? `, capture: ${captureError}` : ""})` };
};

// Returns true once the patient's money is on its way back (or no real money moved).
export const refundPayment = async (serviceClient, paymentRowId, razorpayPaymentId, reason = "slot_unavailable") => {
  const readRow = async () =>
    (await serviceClient.from("appointment_payments").select("status, metadata, payout_status, patient_id, amount").eq("id", paymentRowId).maybeSingle()).data;

  const row = await readRow();
  if (row?.status === "refunded") return true;
  const metadata = row?.metadata || {};
  if (metadata.mode === "test") {
    await updatePayment(serviceClient, paymentRowId, { status: "failed" });
    return true;
  }

  const { refund, error } = await requestRazorpayRefund(razorpayPaymentId, reason);
  if (refund) {
    await updatePayment(serviceClient, paymentRowId, {
      status: "refunded",
      payment_id: razorpayPaymentId,
      // A doctor already paid out for this consultation has to be recovered by hand.
      metadata: { ...metadata, refund_id: refund.id, refund_status: refund.status, refund_reason: reason, needs_manual_refund: false, refund_after_payout: row?.payout_status === "paid" },
    });
    if (row?.patient_id && reason !== "appointment_cancelled") {
      void (async () => {
        try {
          const { data: pUser } = await serviceClient.from("profiles").select("email, full_name, name").eq("id", row.patient_id).maybeSingle();
          const email = (pUser?.email || "").trim();
          if (email) {
            await sendRefundEmail({
              toEmail: email,
              patientName: pUser?.full_name || pUser?.name || "Patient",
              amount: row.amount ? Number(row.amount) / 100 : 500,
              refundId: refund.id,
              paymentId: razorpayPaymentId,
              reason: reason === "slot_unavailable" ? "Selected consultation slot became unavailable" : reason,
            });
          }
        } catch (e) {
          console.warn("[appointmentBooking] refund email error:", e);
        }
      })();
    }
    return true;
  }

  // The app and the webhook can race here, and Razorpay rejects the second refund: that is not a failure.
  if ((await readRow())?.status === "refunded") return true;
  await updatePayment(serviceClient, paymentRowId, {
    status: "paid",
    payment_id: razorpayPaymentId,
    metadata: { ...metadata, refund_reason: reason, needs_manual_refund: true, refund_error: String(error).slice(0, 300) },
  });
  return false;
};

export const finalizePaidBooking = async ({ serviceClient, paymentRow, razorpayPaymentId, signature = null, aiReportId = null }) => {
  const { data, error } = await serviceClient.rpc("finalize_appointment_payment", {
    p_payment_id: paymentRow.id,
    p_patient_id: paymentRow.patient_id,
    p_razorpay_payment_id: razorpayPaymentId,
    p_signature: signature,
    p_ai_report_id: aiReportId,
  });
  if (error) return { success: false, code: "finalize_error", message: error.message || "finalize_payment_failed" };

  const result = Array.isArray(data) ? data[0] : data;
  if (result?.success) {
    // Booked means paid: make sure the money was actually taken, not only held. A failure here must not undo the booking.
    if (result.message !== "already_booked" && paymentRow.metadata?.mode !== "test" && razorpayPaymentId) {
      const capture = await ensureCaptured(razorpayPaymentId);
      if (capture.error) {
        console.warn("[booking] capture check failed", capture.error);
        await updatePayment(serviceClient, paymentRow.id, { metadata: { ...(paymentRow.metadata || {}), capture_error: String(capture.error).slice(0, 300) } });
      }
    }
    return { success: true, appointmentId: result.appointment_id, alreadyBooked: result.message === "already_booked" };
  }
  if (SLOT_LOST_REASONS.has(result?.message)) {
    return (await refundPayment(serviceClient, paymentRow.id, razorpayPaymentId))
      ? { success: false, code: "slot_taken_refunded", message: SLOT_REFUNDED_MESSAGE }
      : { success: false, code: "slot_taken_refund_pending", message: SLOT_REFUND_PENDING_MESSAGE };
  }
  return { success: false, code: result?.message || "finalize_payment_failed", message: result?.message || "finalize_payment_failed" };
};

// Tells the other party about a cancelled or moved consultation. A failed push must not undo the change itself.
export const notifyAppointmentChange = async ({ serviceClient, userId, title, body, data }) => {
  try {
    await serviceClient.from("in_app_notifications").insert({ user_id: userId, type: "appointment_update", title, body, data });
    const { data: profile } = await serviceClient.from("profiles").select("push_token, settings").eq("id", userId).maybeSingle();
    const pushOff = profile?.settings?.notifications?.push === false;
    if (profile?.push_token && !pushOff) {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: profile.push_token, sound: "default", title, body, data }),
      });
    }
  } catch (error) {
    console.warn("appointment change notification failed:", error);
  }
};

// Sends the doctor's PDF from the server, for a patient who closed the app after paying.
// send-appointment-notification claims each appointment once, so this and the app's own call cannot both send it.
export const sendDoctorBrief = async (serviceClient, appointmentId, context = {}) => {
  try {
    const { error } = await serviceClient.functions.invoke("send-appointment-notification", {
      body: { appointmentId, concern: context.concern || undefined, conversationId: context.conversation_id || undefined },
    });
    if (error) console.warn("doctor brief from server failed:", error.message);
  } catch (error) {
    console.warn("doctor brief from server failed:", error);
  }
};
