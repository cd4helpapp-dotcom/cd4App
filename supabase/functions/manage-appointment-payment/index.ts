// Local TS-server compatibility for Supabase Edge (Deno) runtime.
declare const Deno: {
  env: { get: (key: string) => string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};
// @ts-ignore - resolved by Deno runtime/module resolver.
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore - resolved by Deno runtime/module resolver.
import { finalizePaidBooking, notifyAppointmentChange, refundPayment, SLOT_REFUNDED_MESSAGE } from "../_shared/appointmentBooking.ts";
// @ts-ignore - resolved by Deno runtime/module resolver.
import {
  sendPaymentSuccessEmail,
  sendRefundEmail,
  sendAppointmentCancelledEmail,
  sendAppointmentRescheduledEmail,
} from "../_shared/emailService.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APPOINTMENT_FEE_INR = 500;
const DOCTOR_SHARE_RATIO = 0.7;
const PLATFORM_SHARE_RATIO = 0.3;
const SLOT_HOLD_MINUTES = 5;

const formatSlotForMessage = (date: string, startTime: string) => {
  const start = new Date(`${date}T${String(startTime || "00:00:00").slice(0, 8)}+05:30`);
  return start.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
};

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const createServiceClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
};

const extractBearerToken = (req: Request): string => {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
};

const makeTestToken = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") || "";
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
const IS_RAZORPAY_LIVE = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const computeHmacSha256Hex = async (message: string, secret: string): Promise<string> => {
  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return hex(signature);
};

const createRazorpayOrder = async (amountPaise: number, receipt: string) => {
  const auth = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      receipt,
      payment_capture: 1,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.error?.description || "razorpay_order_create_failed");
  }
  return payload;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const serviceClient = createServiceClient();
    if (!serviceClient) return jsonResponse({ success: false, message: "service_env_missing" }, 500);

    const accessToken = extractBearerToken(req);
    if (!accessToken) return jsonResponse({ success: false, message: "missing_bearer_token" }, 401);

    const { data: authData, error: authError } = await serviceClient.auth.getUser(accessToken);
    if (authError || !authData?.user?.id) return jsonResponse({ success: false, message: "invalid_token" }, 401);

    const patientId = authData.user.id;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "create_order").trim().toLowerCase();

    if (action === "create_order") {
      const doctorId = String(body?.doctorId || "").trim();
      const slotId = String(body?.slotId || "").trim();
      if (!doctorId || !slotId) return jsonResponse({ success: false, message: "doctorId_and_slotId_required" }, 400);
      const appointmentType = String(body?.appointmentType || "consultation").trim() === "second_opinion"
        ? "second_opinion"
        : "consultation";
      // Kept on the order so the webhook can prepare the doctor's PDF if the patient closes the app after paying.
      const bookingContext = {
        concern: String(body?.concern || "").trim().slice(0, 300) || undefined,
        conversation_id: String(body?.conversationId || "").trim() || undefined,
        ai_report_id: String(body?.aiReportId || "").trim() || undefined,
      };

      // Guards before any money moves. These return HTTP 200 + success:false so the app can show the message.
      const { data: slotRow } = await serviceClient
        .from("slots")
        .select("id, doctor_id, date, start_time, is_booked")
        .eq("id", slotId)
        .maybeSingle();
      if (!slotRow || String(slotRow.doctor_id) !== doctorId) {
        return jsonResponse({ success: false, message: "This slot does not belong to the selected doctor. Please choose a slot again." });
      }
      if (slotRow.is_booked) {
        return jsonResponse({ success: false, message: "Sorry, this slot was just booked by someone else. Please choose another slot." });
      }
      const slotStart = new Date(`${slotRow.date}T${String(slotRow.start_time || "00:00:00").slice(0, 8)}+05:30`);
      if (Number.isFinite(slotStart.getTime()) && slotStart.getTime() < Date.now()) {
        return jsonResponse({ success: false, message: "This slot has already passed. Please choose a later slot." });
      }
      // One booking per doctor per rolling 30 days (same rule as the appointments RLS policy and the Appointments tab).
      const cooldownSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await serviceClient
        .from("appointments")
        .select("created_at")
        .eq("patient_id", patientId)
        .eq("doctor_id", doctorId)
        .in("status", ["pending", "confirmed", "completed"])
        .gte("created_at", cooldownSince)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recent?.created_at) {
        const nextDate = new Date(new Date(recent.created_at).getTime() + 30 * 24 * 60 * 60 * 1000)
          .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
        return jsonResponse({ success: false, code: "booking_cooldown", message: `You already booked this doctor in the last 30 days. You can book again on ${nextDate}.` });
      }

      // Hold the slot while another patient is on the payment screen. The refund in finalizePaidBooking covers the rest.
      const holdSince = new Date(Date.now() - SLOT_HOLD_MINUTES * 60 * 1000).toISOString();
      const { data: otherHold } = await serviceClient
        .from("appointment_payments")
        .select("id")
        .eq("slot_id", slotId)
        .eq("status", "created")
        .neq("patient_id", patientId)
        .gte("created_at", holdSince)
        .limit(1)
        .maybeSingle();
      if (otherHold?.id) {
        return jsonResponse({ success: false, code: "slot_on_hold", message: "Another patient is completing payment for this slot. Please choose another slot, or try again in a few minutes." });
      }

      // Fetch the doctor's fee from the doctors_public table
      const { data: doctorRow, error: doctorError } = await serviceClient
        .from("doctors_public")
        .select("fee")
        .eq("id", doctorId)
        .maybeSingle();

      if (doctorError) {
        return jsonResponse({ success: false, message: doctorError.message || "doctor_not_found" }, 400);
      }

      let docFee = APPOINTMENT_FEE_INR; // fallback 500
      if (doctorRow?.fee) {
        const numeric = Number(String(doctorRow.fee).replace(/[^\d.]/g, ""));
        if (Number.isFinite(numeric) && numeric > 0) {
          docFee = numeric;
        }
      }

      const orderPayload =
        IS_RAZORPAY_LIVE
          ? await createRazorpayOrder(docFee * 100, `apt_${Date.now()}`)
          : { id: makeTestToken("order"), testMode: true };
      const orderId = String(orderPayload.id);
      const doctorShare = Number((docFee * DOCTOR_SHARE_RATIO).toFixed(2));
      const platformShare = Number((docFee * PLATFORM_SHARE_RATIO).toFixed(2));

      const { data: paymentRow, error: paymentError } = await serviceClient
        .from("appointment_payments")
        .insert({
          patient_id: patientId,
          doctor_id: doctorId,
          slot_id: slotId,
          provider: "razorpay",
          order_id: orderId,
          status: "created",
          gross_amount: docFee,
          doctor_share: doctorShare,
          platform_commission: platformShare,
          currency: "INR",
          metadata: { mode: IS_RAZORPAY_LIVE ? "live" : "test", action: "create_order", appointment_type: appointmentType, booking_context: bookingContext },
        })
        .select("id, order_id, gross_amount, doctor_share, platform_commission, currency")
        .single();

      if (paymentError || !paymentRow) {
        return jsonResponse({ success: false, message: paymentError?.message || "payment_create_failed" }, 400);
      }

      return jsonResponse({
        success: true,
        payment: paymentRow,
        amountPaise: docFee * 100,
        keyId: RAZORPAY_KEY_ID || null,
        mode: IS_RAZORPAY_LIVE ? "live" : "test",
      });
    }

    if (action === "verify_and_book") {
      const orderId = String(body?.orderId || "").trim();
      const paymentId = String(body?.paymentId || "").trim();
      const signature = String(body?.signature || "").trim();
      const doctorId = String(body?.doctorId || "").trim();
      const slotId = String(body?.slotId || "").trim();
      const aiReportId = body?.aiReportId ? String(body.aiReportId) : null;

      if (!orderId) {
        return jsonResponse({ success: false, message: "orderId_required" }, 400);
      }

      const { data: paymentRow, error: fetchError } = await serviceClient
        .from("appointment_payments")
        .select("*")
        .eq("order_id", orderId)
        .eq("patient_id", patientId)
        .maybeSingle();

      if (fetchError || !paymentRow) return jsonResponse({ success: false, message: "payment_not_found" }, 404);
      if (paymentRow.appointment_id) {
        return jsonResponse({ success: true, alreadyBooked: true, appointmentId: paymentRow.appointment_id });
      }
      if (String(paymentRow.status) === "refunded") {
        return jsonResponse({ success: false, code: "slot_taken_refunded", message: SLOT_REFUNDED_MESSAGE });
      }
      if (doctorId && doctorId !== String(paymentRow.doctor_id || "")) {
        return jsonResponse({ success: false, message: "doctor_mismatch_for_order" }, 400);
      }
      if (slotId && slotId !== String(paymentRow.slot_id || "")) {
        return jsonResponse({ success: false, message: "slot_mismatch_for_order" }, 400);
      }
      if (!paymentId || !signature) {
        return jsonResponse({ success: false, message: "payment_id_and_signature_required" }, 400);
      }
      if (RAZORPAY_KEY_SECRET) {
        const payload = `${orderId}|${paymentId}`;
        const expected = await computeHmacSha256Hex(payload, RAZORPAY_KEY_SECRET);
        if (expected !== signature) {
          return jsonResponse({ success: false, message: "invalid_payment_signature" }, 400);
        }
      } else if (paymentRow.metadata?.mode !== "test") {
        // Only an order created without Razorpay keys has no signature to check.
        return jsonResponse({ success: false, message: "invalid_payment_signature" }, 400);
      }

      const boundDoctorId = String(paymentRow.doctor_id || "");
      const boundSlotId = String(paymentRow.slot_id || "");
      if (!boundDoctorId || !boundSlotId) {
        return jsonResponse({ success: false, message: "payment_row_missing_bound_entities" }, 400);
      }

      const booking = await finalizePaidBooking({ serviceClient, paymentRow, razorpayPaymentId: paymentId, signature, aiReportId });
      if (!booking.success) {
        // Lost-slot outcomes use HTTP 200 so the app can read the code and show the refund message.
        const isLostSlot = String(booking.code).startsWith("slot_taken");
        return jsonResponse({ success: false, code: booking.code, message: booking.message }, isLostSlot ? 200 : 400);
      }

      if (booking.appointmentId && !booking.alreadyBooked) {
        const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
        const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
        if (supabaseUrl && serviceRoleKey) {
          fetch(`${supabaseUrl}/functions/v1/send-appointment-notification`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ appointmentId: booking.appointmentId }),
          }).catch((err) => console.warn("[manage-appointment-payment] auto email trigger error:", err));
        }

        // Send payment success receipt email
        void (async () => {
          try {
            const { data: pUser } = await serviceClient.from("profiles").select("email, full_name, name").eq("id", patientId).maybeSingle();
            const { data: dUser } = await serviceClient.from("profiles").select("full_name, name").eq("id", boundDoctorId).maybeSingle();
            const email = (pUser?.email || "").trim();
            if (email) {
              await sendPaymentSuccessEmail({
                toEmail: email,
                patientName: pUser?.full_name || pUser?.name || "Patient",
                amount: Number(paymentRow.amount || 50000) / 100,
                paymentId,
                orderId,
                doctorName: dUser?.full_name || dUser?.name || "Doctor",
              });
            }
          } catch (e) {
            console.warn("[manage-appointment-payment] payment success email error:", e);
          }
        })();
      }

      return jsonResponse({
        success: true,
        alreadyBooked: booking.alreadyBooked,
        appointmentId: booking.appointmentId,
        paymentId,
      });
    }

    if (action === "cancel_appointment") {
      const { data: result, error } = await serviceClient.rpc("cancel_appointment_booking", {
        p_appointment_id: String(body?.appointmentId || "").trim(),
        p_actor_id: patientId,
      });
      if (error) return jsonResponse({ success: false, message: error.message || "cancel_failed" }, 400);
      if (!result?.success) return jsonResponse({ success: false, code: result?.message, message: result?.message });

      let refund = "none";
      if (result.payment_row_id && result.razorpay_payment_id) {
        refund = (await refundPayment(serviceClient, result.payment_row_id, result.razorpay_payment_id, "appointment_cancelled")) ? "started" : "pending";
      }
      const when = formatSlotForMessage(result.date, result.start_time);
      const appointmentData = { appointmentId: body?.appointmentId };
      await Promise.all(
        result.cancelled_by === "patient"
          ? [notifyAppointmentChange({ serviceClient, userId: result.doctor_id, title: "Appointment cancelled", body: `The patient cancelled the consultation on ${when}. The slot is open again.`, data: appointmentData })]
          : [notifyAppointmentChange({ serviceClient, userId: result.patient_id, title: "Appointment cancelled", body: `Your doctor cancelled the consultation on ${when}. You will get a full refund. Please book another slot.`, data: appointmentData })]
      );

      // Send cancellation and refund email to patient
      void (async () => {
        try {
          const { data: pUser } = await serviceClient.from("profiles").select("email, full_name, name").eq("id", result.patient_id).maybeSingle();
          const { data: dUser } = await serviceClient.from("profiles").select("full_name, name").eq("id", result.doctor_id).maybeSingle();
          const email = (pUser?.email || "").trim();
          if (email) {
            const refundMsg = refund === "started"
              ? "A full refund of ₹" + (result.amount ? Number(result.amount) / 100 : 500) + " has been initiated to your source account (takes 5-7 business days)."
              : "Consultation slot has been cancelled.";
            await sendAppointmentCancelledEmail({
              toEmail: email,
              recipientName: pUser?.full_name || pUser?.name || "Patient",
              doctorName: dUser?.full_name || dUser?.name || "Doctor",
              slotDate: result.date || "Scheduled Date",
              slotTime: result.start_time || "Scheduled Time",
              cancelledBy: result.cancelled_by || "system",
              refundStatus: refundMsg,
              appointmentId: body?.appointmentId,
            });

            if (refund === "started") {
              await sendRefundEmail({
                toEmail: email,
                patientName: pUser?.full_name || pUser?.name || "Patient",
                amount: result.amount ? Number(result.amount) / 100 : 500,
                paymentId: result.razorpay_payment_id,
                reason: `Appointment cancelled by ${result.cancelled_by || "doctor/patient"}`,
              });
            }
          }
        } catch (e) {
          console.warn("[manage-appointment-payment] cancel email error:", e);
        }
      })();

      return jsonResponse({ success: true, refund });
    }

    if (action === "reschedule_appointment") {
      const { data: result, error } = await serviceClient.rpc("reschedule_appointment_booking", {
        p_appointment_id: String(body?.appointmentId || "").trim(),
        p_patient_id: patientId,
        p_new_slot_id: String(body?.slotId || "").trim(),
      });
      if (error) return jsonResponse({ success: false, message: error.message || "reschedule_failed" }, 400);
      if (!result?.success) return jsonResponse({ success: false, code: result?.message, message: result?.message });

      await notifyAppointmentChange({
        serviceClient,
        userId: result.doctor_id,
        title: "Appointment rescheduled",
        body: `A patient moved their consultation to ${formatSlotForMessage(result.date, result.start_time)}.`,
        data: { appointmentId: body?.appointmentId },
      });

      // Send rescheduled email to patient
      void (async () => {
        try {
          const { data: pUser } = await serviceClient.from("profiles").select("email, full_name, name").eq("id", result.patient_id).maybeSingle();
          const { data: dUser } = await serviceClient.from("profiles").select("full_name, name").eq("id", result.doctor_id).maybeSingle();
          const email = (pUser?.email || "").trim();
          if (email) {
            await sendAppointmentRescheduledEmail({
              toEmail: email,
              patientName: pUser?.full_name || pUser?.name || "Patient",
              doctorName: dUser?.full_name || dUser?.name || "Doctor",
              newDate: result.date || "Updated Date",
              newTime: result.start_time || "Updated Time",
              appointmentId: body?.appointmentId,
            });
          }
        } catch (e) {
          console.warn("[manage-appointment-payment] reschedule email error:", e);
        }
      })();

      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: false, message: "unsupported_action" }, 400);
  } catch (error) {
    return jsonResponse({ success: false, message: error instanceof Error ? error.message : "unknown_error" }, 400);
  }
});
