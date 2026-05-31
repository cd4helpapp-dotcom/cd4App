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

const MONTHLY_PRICE_INR = Math.max(1, Number(Deno.env.get("PRO_MONTHLY_PRICE_INR") || "99"));
const YEARLY_PRICE_INR = Math.max(1, Number(Deno.env.get("PRO_YEARLY_PRICE_INR") || "999"));
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") || "";
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
const IS_RAZORPAY_LIVE = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);

const jsonResponse = (payload: Record<string, unknown>, status: number = 200) =>
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

const ACTIVE_STATUSES = new Set(["active", "trialing", "grace"]);

const parseIsoMs = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const isSubscriptionCurrentlyActive = (row: any, nowMs: number): boolean => {
  if (!row || typeof row !== "object") return false;
  if (!ACTIVE_STATUSES.has(String(row.status || "").toLowerCase())) return false;
  const expiresMs = parseIsoMs(row.expires_at);
  return expiresMs === null || expiresMs > nowMs;
};

const normalizeSubscription = (row: any) => {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id,
    userId: row.user_id,
    planCode: row.plan_code,
    billingCycle: row.billing_cycle,
    status: row.status,
    currency: row.currency,
    amountPaid: row.amount_paid,
    paymentProvider: row.payment_provider,
    paymentId: row.payment_id,
    paymentOrderId: row.payment_order_id,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    nextBillingAt: row.next_billing_at,
    cancelledAt: row.cancelled_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const fetchActiveSubscription = async (serviceClient: any, userId: string) => {
  const { data, error } = await serviceClient
    .from("user_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("plan_code", "pro")
    .in("status", ["active", "trialing", "grace"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
};

const fetchLatestSubscription = async (serviceClient: any, userId: string) => {
  const { data, error } = await serviceClient
    .from("user_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("plan_code", "pro")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
};

const createTestIdentifiers = () => {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  return {
    paymentId: `TESTPAY-${token}`,
    orderId: `TESTORD-${token}`,
  };
};

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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return jsonResponse({ success: false, message: "service_env_missing" }, 500);
    }

    const accessToken = extractBearerToken(req);
    if (!accessToken) {
      return jsonResponse({ success: false, message: "missing_bearer_token" }, 401);
    }

    const { data: authData, error: authError } = await serviceClient.auth.getUser(accessToken);
    if (authError || !authData?.user?.id) {
      return jsonResponse({ success: false, message: "invalid_or_expired_token" }, 401);
    }
    const userId = authData.user.id;

    const body = await req.json().catch(() => ({}));
    const actionRaw = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "status";
    const action = actionRaw || "status";
    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    if (action === "status") {
      const active = await fetchActiveSubscription(serviceClient, userId);
      const latest = active || (await fetchLatestSubscription(serviceClient, userId));
      return jsonResponse({
        success: true,
        active: isSubscriptionCurrentlyActive(latest, nowMs),
        subscription: normalizeSubscription(latest),
      });
    }

    if (action === "create_order") {
      const billingCycleRaw = typeof body?.billingCycle === "string" ? body.billingCycle.trim().toLowerCase() : "yearly";
      const billingCycle = billingCycleRaw === "monthly" ? "monthly" : "yearly";
      const amount = billingCycle === "monthly" ? MONTHLY_PRICE_INR : YEARLY_PRICE_INR;
      const orderPayload =
        IS_RAZORPAY_LIVE
          ? await createRazorpayOrder(amount * 100, `sub_${Date.now()}`)
          : { id: `order_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`, testMode: true };
      const orderId = String(orderPayload.id);
      return jsonResponse({
        success: true,
        order: {
          order_id: orderId,
          amount,
          currency: "INR",
          plan_code: "pro",
          billing_cycle: billingCycle,
          provider: "razorpay",
          mode: IS_RAZORPAY_LIVE ? "live" : "test",
        },
      });
    }

    if (action === "verify_payment" || action === "activate_test") {
      const billingCycleRaw = typeof body?.billingCycle === "string" ? body.billingCycle.trim().toLowerCase() : "yearly";
      const billingCycle = billingCycleRaw === "monthly" ? "monthly" : "yearly";
      const amount = billingCycle === "monthly" ? MONTHLY_PRICE_INR : YEARLY_PRICE_INR;
      const durationDays = billingCycle === "monthly" ? 30 : 365;
      const expiresAt = new Date(nowMs + durationDays * 24 * 60 * 60 * 1000).toISOString();
      const fallback = createTestIdentifiers();
      const paymentId = typeof body?.paymentId === "string" && body.paymentId.trim() ? body.paymentId.trim() : fallback.paymentId;
      const orderId = typeof body?.orderId === "string" && body.orderId.trim() ? body.orderId.trim() : fallback.orderId;
      const signature = typeof body?.signature === "string" ? body.signature.trim() : "";

      if (action === "verify_payment" && (!paymentId || !orderId || !signature)) {
        return jsonResponse({ success: false, message: "order_payment_signature_required" }, 400);
      }
      if (action === "verify_payment" && RAZORPAY_KEY_SECRET) {
        const expected = await computeHmacSha256Hex(`${orderId}|${paymentId}`, RAZORPAY_KEY_SECRET);
        if (expected !== signature) {
          return jsonResponse({ success: false, message: "invalid_payment_signature" }, 400);
        }
      }

      const existingActive = await fetchActiveSubscription(serviceClient, userId);
      if (isSubscriptionCurrentlyActive(existingActive, nowMs)) {
        return jsonResponse({
          success: true,
          alreadyActive: true,
          active: true,
          subscription: normalizeSubscription(existingActive),
        });
      }

      const { error: closePreviousError } = await serviceClient
        .from("user_subscriptions")
        .update({
          status: "cancelled",
          cancelled_at: nowIso,
          updated_at: nowIso,
        })
        .eq("user_id", userId)
        .eq("plan_code", "pro")
        .in("status", ["active", "trialing", "grace", "pending"]);

      if (closePreviousError) {
        return jsonResponse({ success: false, message: `close_previous_failed:${closePreviousError.message}` }, 400);
      }

      const { data: subscriptionRow, error: insertSubscriptionError } = await serviceClient
        .from("user_subscriptions")
        .insert({
          user_id: userId,
          plan_code: "pro",
          billing_cycle: billingCycle,
          status: "active",
          currency: "INR",
          amount_paid: amount,
          payment_provider: "razorpay",
          payment_id: paymentId,
          payment_order_id: orderId,
          started_at: nowIso,
          expires_at: expiresAt,
          next_billing_at: expiresAt,
          metadata: {
            source: IS_RAZORPAY_LIVE ? "upgrade_pro_live_mode" : "upgrade_pro_test_mode",
            activatedFrom: "app_upgrade_pro_screen",
          },
        })
        .select("*")
        .single();

      if (insertSubscriptionError || !subscriptionRow) {
        return jsonResponse(
          { success: false, message: `insert_subscription_failed:${insertSubscriptionError?.message || "unknown"}` },
          400,
        );
      }

      const { data: paymentRow, error: paymentError } = await serviceClient
        .from("subscription_payments")
        .insert({
          user_id: userId,
          subscription_id: subscriptionRow.id,
          plan_code: "pro",
          billing_cycle: billingCycle,
          amount,
          currency: "INR",
          provider: "razorpay",
          payment_id: paymentId,
          order_id: orderId,
          status: "paid",
          paid_at: nowIso,
          raw_payload: {
            action,
            requestPlan: body?.plan || null,
            requestBillingCycle: billingCycle,
            testMode: !IS_RAZORPAY_LIVE,
            verifiedVia: action,
          },
        })
        .select("id, payment_id, order_id, status, paid_at")
        .single();

      if (paymentError) {
        return jsonResponse({ success: false, message: `insert_payment_failed:${paymentError.message}` }, 400);
      }

      return jsonResponse({
        success: true,
        alreadyActive: false,
        active: true,
        subscription: normalizeSubscription(subscriptionRow),
        payment: paymentRow,
      });
    }

    
    if (action === "cancel") {
      const latest = await fetchLatestSubscription(serviceClient, userId);
      if (!latest) {
        return jsonResponse({ success: false, message: "subscription_not_found" }, 404);
      }

      const status = String(latest.status || "").toLowerCase();
      if (status === "cancelled" || status === "expired") {
        return jsonResponse({
          success: true,
          alreadyCancelled: true,
          active: isSubscriptionCurrentlyActive(latest, nowMs),
          subscription: normalizeSubscription(latest),
        });
      }

      const requestedReason =
        typeof body?.reason === "string" && body.reason.trim().length > 0
          ? body.reason.trim().slice(0, 200)
          : "user_requested_cancel";
      const expiresMs = parseIsoMs(latest.expires_at);
      const shouldKeepAccessUntilExpiry = expiresMs !== null && expiresMs > nowMs;
      const nextStatus = shouldKeepAccessUntilExpiry ? "grace" : "cancelled";
      const metadata =
        latest.metadata && typeof latest.metadata === "object" && !Array.isArray(latest.metadata)
          ? latest.metadata
          : {};

      const { data: updatedRow, error: updateError } = await serviceClient
        .from("user_subscriptions")
        .update({
          status: nextStatus,
          cancelled_at: nowIso,
          next_billing_at: null,
          expires_at: shouldKeepAccessUntilExpiry ? latest.expires_at : nowIso,
          metadata: {
            ...metadata,
            cancellation: {
              requestedAt: nowIso,
              reason: requestedReason,
              source: "settings_subscription_screen",
            },
          },
          updated_at: nowIso,
        })
        .eq("id", latest.id)
        .select("*")
        .single();

      if (updateError || !updatedRow) {
        return jsonResponse(
          { success: false, message: `cancel_subscription_failed:${updateError?.message || "unknown"}` },
          400,
        );
      }

      return jsonResponse({
        success: true,
        alreadyCancelled: false,
        active: isSubscriptionCurrentlyActive(updatedRow, nowMs),
        subscription: normalizeSubscription(updatedRow),
      });
    }

    return jsonResponse({ success: false, message: "unsupported_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "manage_pro_subscription_unknown_error";
    return jsonResponse({ success: false, message }, 400);
  }
});

