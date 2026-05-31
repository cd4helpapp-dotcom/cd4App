import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { RtcTokenBuilder, RtcRole } from "npm:agora-access-token";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const getBearerToken = (req: Request): string => {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
};

const getRequestIp = (req: Request): string | null => {
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
  const first = forwarded.split(",")[0]?.trim();
  return first || null;
};

const createServiceClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return createClient(supabaseUrl, serviceRoleKey);
};

const logSecurityEvent = async (serviceClient: any, args: {
  eventType: string;
  severity: "info" | "warn" | "error" | "critical";
  userId?: string | null;
  ip?: string | null;
  context?: Record<string, unknown>;
}) => {
  try {
    await serviceClient.from("security_audit_logs").insert({
      event_type: args.eventType,
      severity: args.severity,
      user_id: args.userId || null,
      ip: args.ip || null,
      source: "get-agora-token",
      context: args.context || {},
    });
  } catch {
    // never block token generation on telemetry failure
  }
};

const enforceRateLimit = async (serviceClient: any, args: {
  scope: string;
  subject: string;
  maxRequests: number;
  windowSeconds: number;
}) => {
  const { data, error } = await serviceClient.rpc("security_check_rate_limit", {
    p_scope: args.scope,
    p_subject: args.subject,
    p_window_seconds: Math.max(1, Math.floor(args.windowSeconds)),
    p_max_requests: Math.max(1, Math.floor(args.maxRequests)),
  });

  if (error) {
    return { allowed: true, remaining: null, retryAfterSec: 0, currentCount: null };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean(row?.allowed),
    remaining: typeof row?.remaining === "number" ? row.remaining : null,
    retryAfterSec: typeof row?.retry_after_sec === "number" ? row.retry_after_sec : 0,
    currentCount: typeof row?.current_count === "number" ? row.current_count : null,
  };
};

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");

const normalizeRole = (value: unknown): "publisher" | "subscriber" =>
  String(value || "").trim().toLowerCase() === "subscriber" ? "subscriber" : "publisher";

const AGORA_UID_MAX = 2147483647;

const getAgoraUidFromUserId = (userId: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash % AGORA_UID_MAX) + 1;
};

const normalizeAgoraUid = (value: unknown, userId: string): number => {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= AGORA_UID_MAX) {
    return parsed;
  }
  return getAgoraUidFromUserId(userId);
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return jsonResponse({ success: false, error: "service_env_missing" }, 500);
    }

    const requestIp = getRequestIp(req);
    const accessToken = getBearerToken(req);
    if (!accessToken) {
      await logSecurityEvent(serviceClient, {
        eventType: "agora_token_missing_token",
        severity: "warn",
        ip: requestIp,
      });
      return jsonResponse({ success: false, error: "missing_bearer_token" }, 401);
    }

    const { data: authData, error: authError } = await serviceClient.auth.getUser(accessToken);
    if (authError || !authData?.user?.id) {
      await logSecurityEvent(serviceClient, {
        eventType: "agora_token_invalid_token",
        severity: "warn",
        ip: requestIp,
      });
      return jsonResponse({ success: false, error: "invalid_or_expired_token" }, 401);
    }
    const userId = authData.user.id;

    const rateLimit = await enforceRateLimit(serviceClient, {
      scope: "get-agora-token",
      subject: userId,
      maxRequests: 20,
      windowSeconds: 60,
    });
    if (!rateLimit.allowed) {
      await logSecurityEvent(serviceClient, {
        eventType: "agora_token_rate_limited",
        severity: "warn",
        userId,
        ip: requestIp,
        context: {
          retryAfterSec: rateLimit.retryAfterSec,
          currentCount: rateLimit.currentCount,
        },
      });
      return jsonResponse({
        success: false,
        error: "rate_limit_exceeded",
        retryAfterSec: rateLimit.retryAfterSec,
      }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const channelName = typeof body?.channelName === "string" ? body.channelName.trim() : "";
    const requestedUid = normalizeAgoraUid(body?.uid, userId);
    const role = normalizeRole(body?.role);

    if (!channelName || !isUuid(channelName)) {
      await logSecurityEvent(serviceClient, {
        eventType: "agora_token_invalid_channel",
        severity: "warn",
        userId,
        ip: requestIp,
        context: { channelNameLength: channelName.length },
      });
      return jsonResponse({ success: false, error: "invalid_channel_name" }, 400);
    }

    const { data: roomData, error: roomError } = await serviceClient
      .from("chat_rooms")
      .select("patient_id, doctor_id")
      .eq("id", channelName)
      .maybeSingle();

    if (roomError || !roomData) {
      return jsonResponse({ success: false, error: "room_not_found" }, 404);
    }

    if (roomData.patient_id !== userId && roomData.doctor_id !== userId) {
      await logSecurityEvent(serviceClient, {
        eventType: "agora_token_forbidden",
        severity: "warn",
        userId,
        ip: requestIp,
        context: { channelName },
      });
      return jsonResponse({ success: false, error: "not_allowed_for_room" }, 403);
    }

    const appId = Deno.env.get("AGORA_APP_ID") || "";
    const appCertificate = Deno.env.get("AGORA_APP_CERTIFICATE") || "";
    if (!appId || !appCertificate) {
      return jsonResponse({ success: false, error: "agora_credentials_missing" }, 500);
    }

    const rtcRole = role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      requestedUid,
      rtcRole,
      privilegeExpiredTs
    );

    await logSecurityEvent(serviceClient, {
      eventType: "agora_token_issued",
      severity: "info",
      userId,
      ip: requestIp,
      context: {
        channelName,
        role,
      },
    });

    return jsonResponse({ success: true, token, uid: requestedUid });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown get-agora-token error";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
