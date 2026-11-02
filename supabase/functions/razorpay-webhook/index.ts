import { createClient } from "npm:@supabase/supabase-js@2";
import { finalizePaidBooking, sendDoctorBrief } from "../_shared/appointmentBooking.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature",
};

const RAZORPAY_WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const serviceClient = (() => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
})();

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const computeHmacSha256Hex = async (message: string, secret: string): Promise<string> => {
  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return hex(signature);
};

const mapPaymentEntityStatus = (value: string): "paid" | "failed" | null => {
  const v = String(value || "").toLowerCase();
  if (v === "captured") return "paid";
  if (v === "failed") return "failed";
  return null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, message: "method_not_allowed" }, 405);
  if (!serviceClient) return jsonResponse({ success: false, message: "service_env_missing" }, 500);

  try {
    const signature = req.headers.get("x-razorpay-signature") || "";
    const rawBody = await req.text();
    if (!signature || !RAZORPAY_WEBHOOK_SECRET) {
      return jsonResponse({ success: false, message: "webhook_secret_or_signature_missing" }, 400);
    }

    const expected = await computeHmacSha256Hex(rawBody, RAZORPAY_WEBHOOK_SECRET);
    if (expected !== signature) {
      return jsonResponse({ success: false, message: "invalid_webhook_signature" }, 401);
    }

    const payload = JSON.parse(rawBody || "{}");
    const eventId = String(payload?.id || "").trim();
    const eventType = String(payload?.event || "").trim();
    if (!eventId || !eventType) return jsonResponse({ success: false, message: "invalid_event_payload" }, 400);

    const { data: existing } = await serviceClient
      .from("payment_webhook_events")
      .select("id, processed")
      .eq("provider", "razorpay")
      .eq("event_id", eventId)
      .maybeSingle();
    // An event that failed part-way is processed again when Razorpay retries it.
    if (existing?.processed) return jsonResponse({ success: true, deduplicated: true });

    let eventRow = existing;
    if (!eventRow?.id) {
      const { data: insertedEvent, error: insertEventError } = await serviceClient
        .from("payment_webhook_events")
        .insert({
          provider: "razorpay",
          event_id: eventId,
          event_type: eventType,
          payload,
          processed: false,
        })
        .select("id")
        .single();
      if (insertEventError || !insertedEvent?.id) {
        return jsonResponse({ success: false, message: insertEventError?.message || "event_log_insert_failed" }, 400);
      }
      eventRow = insertedEvent;
    }

    const paymentEntity = payload?.payload?.payment?.entity || {};
    const paymentId = String(paymentEntity?.id || "").trim();
    const orderId = String(paymentEntity?.order_id || "").trim();
    const status = mapPaymentEntityStatus(String(paymentEntity?.status || ""));
    const paidAtIso = paymentEntity?.captured_at
      ? new Date(Number(paymentEntity.captured_at) * 1000).toISOString()
      : new Date().toISOString();

    if (status && (paymentId || orderId)) {
      // Refund events also carry the payment entity, and must not book anything.
      const { data: appointmentPayment } = orderId && !eventType.startsWith("refund.")
        ? await serviceClient.from("appointment_payments").select("*").eq("order_id", orderId).maybeSingle()
        : { data: null };

      if (appointmentPayment && status === "paid") {
        // The patient may have closed the app after paying, so the booking is made here too.
        const bookingContext = appointmentPayment.metadata?.booking_context || {};
        const booking = await finalizePaidBooking({
          serviceClient,
          paymentRow: appointmentPayment,
          razorpayPaymentId: paymentId,
          aiReportId: bookingContext.ai_report_id || null,
        });
        if (booking.success) {
          // Razorpay expects a quick answer and writing the PDF takes seconds, so it runs after this response.
          // @ts-ignore EdgeRuntime is provided by the Supabase runtime.
          EdgeRuntime.waitUntil(sendDoctorBrief(serviceClient, booking.appointmentId, bookingContext));
        }
        if (!booking.success && !String(booking.code).startsWith("slot_taken_refunded") && booking.code !== "payment_status_invalid") {
          await serviceClient
            .from("payment_webhook_events")
            .update({
              processed: false,
              processed_at: null,
              processing_error: `appointment_booking_failed:${booking.code}`,
            })
            .eq("id", eventRow.id);
          return jsonResponse({ success: false, message: "appointment_booking_failed" }, 500);
        }
      }

      if (appointmentPayment && status === "failed") {
        // Only an unpaid order can fail: a late failure of an earlier attempt must not undo a successful payment.
        await serviceClient
          .from("appointment_payments")
          .update({
            status: "failed",
            metadata: { ...(appointmentPayment.metadata || {}), webhook_event: eventType, webhook_synced_at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          })
          .eq("id", appointmentPayment.id)
          .eq("status", "created");
      }

      const subscriptionPaymentUpdate = serviceClient
        .from("subscription_payments")
        .update({
          status,
          payment_id: paymentId || undefined,
          paid_at: status === "paid" ? paidAtIso : null,
          raw_payload: payload,
          updated_at: new Date().toISOString(),
        })
        .or(`payment_id.eq.${paymentId},order_id.eq.${orderId}`);
      // A late failure of an earlier attempt must not undo a successful payment.
      const { error: subscriptionPaymentUpdateError } = await (status === "failed"
        ? subscriptionPaymentUpdate.neq("status", "paid")
        : subscriptionPaymentUpdate);
      if (subscriptionPaymentUpdateError) {
        await serviceClient
          .from("payment_webhook_events")
          .update({
            processed: false,
            processed_at: null,
            processing_error: `subscription_payment_update_failed:${subscriptionPaymentUpdateError.message}`,
          })
          .eq("id", eventRow.id);
        return jsonResponse({ success: false, message: "subscription_payment_update_failed" }, 500);
      }
    }

    if (eventType.startsWith("refund.")) {
      const refundEntity = payload?.payload?.refund?.entity || {};
      const sourcePaymentId = String(refundEntity?.payment_id || "").trim();
      if (sourcePaymentId) {
        const { data: refundedPayment } = await serviceClient
          .from("appointment_payments")
          .select("metadata")
          .eq("payment_id", sourcePaymentId)
          .maybeSingle();
        const refundFailed = eventType === "refund.failed";
        const { error: refundUpdateError } = await serviceClient
          .from("appointment_payments")
          .update({
            status: refundFailed ? "paid" : "refunded",
            metadata: {
              ...(refundedPayment?.metadata || {}),
              needs_manual_refund: refundFailed,
              webhook_event: eventType,
              refund_id: String(refundEntity?.id || ""),
              refund_status: String(refundEntity?.status || ""),
              webhook_synced_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq("payment_id", sourcePaymentId);
        if (refundUpdateError) {
          await serviceClient
            .from("payment_webhook_events")
            .update({
              processed: false,
              processed_at: null,
              processing_error: `refund_update_failed:${refundUpdateError.message}`,
            })
            .eq("id", eventRow.id);
          return jsonResponse({ success: false, message: "refund_update_failed" }, 500);
        }
      }
    }

    await serviceClient
      .from("payment_webhook_events")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        processing_error: null,
      })
      .eq("id", eventRow.id);

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ success: false, message: error instanceof Error ? error.message : "webhook_failed" }, 400);
  }
});
