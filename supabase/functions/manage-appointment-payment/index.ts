// Local TS-server compatibility for Supabase Edge (Deno) runtime.
declare const Deno: {
  env: { get: (key: string) => string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};
// @ts-ignore - resolved by Deno runtime/module resolver.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APPOINTMENT_FEE_INR = 500;
const DOCTOR_SHARE_RATIO = 0.7;
const PLATFORM_SHARE_RATIO = 0.3;

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

      const orderPayload =
        IS_RAZORPAY_LIVE
          ? await createRazorpayOrder(APPOINTMENT_FEE_INR * 100, `apt_${Date.now()}`)
          : { id: makeTestToken("order"), testMode: true };
      const orderId = String(orderPayload.id);
      const doctorShare = Number((APPOINTMENT_FEE_INR * DOCTOR_SHARE_RATIO).toFixed(2));
      const platformShare = Number((APPOINTMENT_FEE_INR * PLATFORM_SHARE_RATIO).toFixed(2));

      const { data: paymentRow, error: paymentError } = await serviceClient
        .from("appointment_payments")
        .insert({
          patient_id: patientId,
          doctor_id: doctorId,
          slot_id: slotId,
          provider: "razorpay",
          order_id: orderId,
          status: "created",
          gross_amount: APPOINTMENT_FEE_INR,
          doctor_share: doctorShare,
          platform_commission: platformShare,
          currency: "INR",
          metadata: { mode: IS_RAZORPAY_LIVE ? "live" : "test", action: "create_order" },
        })
        .select("id, order_id, gross_amount, doctor_share, platform_commission, currency")
        .single();

      if (paymentError || !paymentRow) {
        return jsonResponse({ success: false, message: paymentError?.message || "payment_create_failed" }, 400);
      }

      return jsonResponse({
        success: true,
        payment: paymentRow,
        amountPaise: APPOINTMENT_FEE_INR * 100,
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
      if (String(paymentRow.status) === "paid" && paymentRow.appointment_id) {
        return jsonResponse({ success: true, alreadyBooked: true, appointmentId: paymentRow.appointment_id });
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
      }

      const boundDoctorId = String(paymentRow.doctor_id || "");
      const boundSlotId = String(paymentRow.slot_id || "");
      if (!boundDoctorId || !boundSlotId) {
        return jsonResponse({ success: false, message: "payment_row_missing_bound_entities" }, 400);
      }

      const { data: finalizeRows, error: finalizeError } = await serviceClient.rpc("finalize_appointment_payment", {
        p_payment_id: paymentRow.id,
        p_patient_id: patientId,
        p_razorpay_payment_id: paymentId,
        p_signature: signature,
        p_ai_report_id: aiReportId,
      });

      if (finalizeError) {
        return jsonResponse({ success: false, message: finalizeError.message || "finalize_payment_failed" }, 400);
      }

      const finalize = Array.isArray(finalizeRows) ? finalizeRows[0] : finalizeRows;
      if (!finalize?.success) {
        return jsonResponse({ success: false, message: finalize?.message || "finalize_payment_failed" }, 400);
      }

      return jsonResponse({
        success: true,
        alreadyBooked: finalize?.message === "already_booked",
        appointmentId: finalize?.appointment_id,
        paymentId,
      });
    }

    return jsonResponse({ success: false, message: "unsupported_action" }, 400);
  } catch (error) {
    return jsonResponse({ success: false, message: error instanceof Error ? error.message : "unknown_error" }, 400);
  }
});
