import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-security-ops-secret",
};

type JsonRecord = Record<string, unknown>;

const jsonResponse = (body: JsonRecord, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const toTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const getServiceClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(supabaseUrl, serviceRoleKey);
};

const extractBearerToken = (req: Request): string => {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
};

const getClientIp = (req: Request): string =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  req.headers.get("cf-connecting-ip") ||
  req.headers.get("x-real-ip") ||
  "";

const logSecurityEvent = async (args: {
  serviceClient: ReturnType<typeof getServiceClient>;
  eventType: string;
  severity?: "info" | "warn" | "error" | "critical";
  userId?: string | null;
  ip?: string | null;
  source?: string | null;
  context?: JsonRecord;
}) => {
  try {
    await args.serviceClient.from("security_audit_logs").insert({
      event_type: args.eventType,
      severity: args.severity || "info",
      user_id: args.userId || null,
      ip: args.ip || null,
      source: args.source || "security-ops-monitor",
      context: args.context || {},
    });
  } catch {
    // Best-effort logging: do not block monitor flow.
  }
};

const checkRateLimit = async (args: {
  serviceClient: ReturnType<typeof getServiceClient>;
  scope: string;
  subject: string;
  windowSeconds: number;
  maxRequests: number;
}) => {
  const { data, error } = await args.serviceClient.rpc("security_check_rate_limit", {
    p_scope: args.scope,
    p_subject: args.subject,
    p_window_seconds: args.windowSeconds,
    p_max_requests: args.maxRequests,
  });

  if (error || !Array.isArray(data) || data.length === 0) {
    return { allowed: true, remaining: null, retryAfterSec: 0, currentCount: null };
  }

  const row = data[0] || {};
  return {
    allowed: Boolean(row?.allowed),
    remaining: Number.isFinite(Number(row?.remaining)) ? Number(row.remaining) : null,
    retryAfterSec: Number.isFinite(Number(row?.retry_after_sec)) ? Number(row.retry_after_sec) : 0,
    currentCount: Number.isFinite(Number(row?.current_count)) ? Number(row.current_count) : null,
  };
};

const isAdminUser = async (serviceClient: ReturnType<typeof getServiceClient>, userId: string): Promise<boolean> => {
  if (!userId) return false;
  const { data, error } = await serviceClient
    .from("profiles")
    .select("id, roles:role_id(slug)")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return false;
  const rawSlug = Array.isArray((data as any).roles)
    ? (data as any).roles[0]?.slug
    : (data as any).roles?.slug;
  return toTrimmedString(rawSlug).toLowerCase() === "admin";
};

const runAnomalyMaterializer = async (serviceClient: ReturnType<typeof getServiceClient>): Promise<number> => {
  const threshold = Number(Deno.env.get("SECURITY_ANOMALY_MIN_EVENTS") || "20");
  const safeThreshold = Number.isFinite(threshold) && threshold > 0 ? Math.floor(threshold) : 20;
  const { data, error } = await serviceClient.rpc("security_create_anomaly_alerts", {
    p_min_events: safeThreshold,
  });
  if (error) return 0;
  const inserted = Number(data);
  return Number.isFinite(inserted) && inserted >= 0 ? inserted : 0;
};

const checkKeyRotationStatus = async (serviceClient: ReturnType<typeof getServiceClient>) => {
  const maxAgeDaysRaw = Number(Deno.env.get("SECURITY_KEY_ROTATION_MAX_AGE_DAYS") || "90");
  const maxAgeDays = Number.isFinite(maxAgeDaysRaw) && maxAgeDaysRaw > 0 ? Math.floor(maxAgeDaysRaw) : 90;

  const { data, error } = await serviceClient
    .from("security_key_rotations")
    .select("rotated_at, key_name, status")
    .eq("status", "completed")
    .order("rotated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.rotated_at) {
    return { overdue: true, ageDays: null as number | null, maxAgeDays, keyName: null as string | null };
  }

  const last = new Date(data.rotated_at);
  const ageMs = Date.now() - last.getTime();
  const ageDays = Number.isFinite(ageMs) ? Math.floor(ageMs / (24 * 60 * 60 * 1000)) : null;
  const overdue = ageDays === null ? true : ageDays > maxAgeDays;
  return {
    overdue,
    ageDays,
    maxAgeDays,
    keyName: toTrimmedString((data as any).key_name) || null,
  };
};

const checkPentestDueSoon = async (serviceClient: ReturnType<typeof getServiceClient>) => {
  const leadDaysRaw = Number(Deno.env.get("SECURITY_PENTEST_LEAD_DAYS") || "14");
  const leadDays = Number.isFinite(leadDaysRaw) && leadDaysRaw > 0 ? Math.floor(leadDaysRaw) : 14;
  const dueBeforeIso = new Date(Date.now() + leadDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await serviceClient
    .from("security_pentest_schedule")
    .select("id, scope, next_due_at, status")
    .in("status", ["scheduled", "in_progress", "overdue"])
    .lte("next_due_at", dueBeforeIso)
    .order("next_due_at", { ascending: true })
    .limit(20);

  if (error) return { due: [] as any[], leadDays };
  return { due: Array.isArray(data) ? data : [], leadDays };
};

const notifyAdmins = async (args: {
  serviceClient: ReturnType<typeof getServiceClient>;
  summary: {
    anomalyAlertsCreated: number;
    keyRotationOverdue: boolean;
    keyRotationAgeDays: number | null;
    keyRotationMaxAgeDays: number;
    pentestDueSoonCount: number;
    pentestLeadDays: number;
  };
}) => {
  const { serviceClient, summary } = args;
  const runDate = new Date().toISOString().slice(0, 10);

  const { data: adminRole } = await serviceClient
    .from("roles")
    .select("id")
    .eq("slug", "admin")
    .maybeSingle();
  const adminRoleId = toTrimmedString(adminRole?.id);
  if (!adminRoleId) return;

  const { data: admins } = await serviceClient
    .from("profiles")
    .select("id")
    .eq("role_id", adminRoleId);
  const adminIds = (admins || [])
    .map((row: any) => toTrimmedString(row?.id))
    .filter(Boolean);
  if (!adminIds.length) return;

  const needsAlert =
    summary.anomalyAlertsCreated > 0 ||
    summary.keyRotationOverdue ||
    summary.pentestDueSoonCount > 0;
  if (!needsAlert) return;

  // De-duplicate one security ops summary notification per admin per day.
  const { data: existing } = await serviceClient
    .from("in_app_notifications")
    .select("user_id, data")
    .eq("type", "security_ops_alert")
    .in("user_id", adminIds)
    .gte("created_at", `${runDate}T00:00:00.000Z`);

  const notifiedToday = new Set<string>();
  (existing || []).forEach((row: any) => {
    const userId = toTrimmedString(row?.user_id);
    const rowRunDate = toTrimmedString(row?.data?.runDate);
    if (userId && rowRunDate === runDate) {
      notifiedToday.add(userId);
    }
  });

  const bodyParts: string[] = [];
  if (summary.anomalyAlertsCreated > 0) {
    bodyParts.push(`${summary.anomalyAlertsCreated} anomaly alert(s) created`);
  }
  if (summary.keyRotationOverdue) {
    const age = summary.keyRotationAgeDays === null ? "unknown" : `${summary.keyRotationAgeDays}d`;
    bodyParts.push(`key rotation overdue (age ${age}, limit ${summary.keyRotationMaxAgeDays}d)`);
  }
  if (summary.pentestDueSoonCount > 0) {
    bodyParts.push(`${summary.pentestDueSoonCount} pen-test item(s) due in ${summary.pentestLeadDays}d`);
  }

  const title = "Security Ops Alert";
  const body = bodyParts.join(" | ").slice(0, 300) || "Security ops action required.";
  const rows = adminIds
    .filter((id) => !notifiedToday.has(id))
    .map((id) => ({
      user_id: id,
      type: "security_ops_alert",
      title,
      body,
      data: {
        runDate,
        ...summary,
      },
    }));

  if (!rows.length) return;
  await serviceClient.from("in_app_notifications").insert(rows);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "method_not_allowed" }, 405);
  }

  const serviceClient = getServiceClient();
  const ip = getClientIp(req);
  const cronSecretConfigured = toTrimmedString(Deno.env.get("SECURITY_OPS_CRON_SECRET"));
  const providedCronSecret = toTrimmedString(req.headers.get("x-security-ops-secret"));
  const cronAuthorized =
    Boolean(cronSecretConfigured) && providedCronSecret.length > 0 && providedCronSecret === cronSecretConfigured;

  let invokingUserId: string | null = null;

  if (!cronAuthorized) {
    const accessToken = extractBearerToken(req);
    if (!accessToken) {
      await logSecurityEvent({
        serviceClient,
        eventType: "security_ops_monitor_missing_token",
        severity: "warn",
        ip,
        context: { cronAttempted: Boolean(providedCronSecret) },
      });
      return jsonResponse({ success: false, error: "missing_bearer_token" }, 401);
    }

    const { data: authData, error: authError } = await serviceClient.auth.getUser(accessToken);
    const userId = toTrimmedString(authData?.user?.id);
    if (authError || !userId) {
      await logSecurityEvent({
        serviceClient,
        eventType: "security_ops_monitor_invalid_token",
        severity: "warn",
        ip,
      });
      return jsonResponse({ success: false, error: "invalid_or_expired_token" }, 401);
    }

    const admin = await isAdminUser(serviceClient, userId);
    if (!admin) {
      await logSecurityEvent({
        serviceClient,
        eventType: "security_ops_monitor_forbidden",
        severity: "warn",
        ip,
        userId,
      });
      return jsonResponse({ success: false, error: "admin_required" }, 403);
    }

    const rateLimit = await checkRateLimit({
      serviceClient,
      scope: "security_ops_monitor_manual",
      subject: userId,
      windowSeconds: 60,
      maxRequests: 5,
    });
    if (!rateLimit.allowed) {
      await logSecurityEvent({
        serviceClient,
        eventType: "security_ops_monitor_rate_limited",
        severity: "warn",
        ip,
        userId,
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

    invokingUserId = userId;
  }

  try {
    const anomalyAlertsCreated = await runAnomalyMaterializer(serviceClient);
    const keyRotationStatus = await checkKeyRotationStatus(serviceClient);
    const pentestStatus = await checkPentestDueSoon(serviceClient);

    if (keyRotationStatus.overdue) {
      await logSecurityEvent({
        serviceClient,
        eventType: "security_key_rotation_overdue",
        severity: "warn",
        userId: invokingUserId,
        ip,
        context: {
          ageDays: keyRotationStatus.ageDays,
          maxAgeDays: keyRotationStatus.maxAgeDays,
          keyName: keyRotationStatus.keyName,
        },
      });
    }

    if (pentestStatus.due.length > 0) {
      await logSecurityEvent({
        serviceClient,
        eventType: "security_pentest_due",
        severity: "warn",
        userId: invokingUserId,
        ip,
        context: {
          leadDays: pentestStatus.leadDays,
          dueCount: pentestStatus.due.length,
          dueItems: pentestStatus.due.map((row: any) => ({
            id: row.id,
            scope: row.scope,
            next_due_at: row.next_due_at,
            status: row.status,
          })),
        },
      });
    }

    const summary = {
      anomalyAlertsCreated,
      keyRotationOverdue: keyRotationStatus.overdue,
      keyRotationAgeDays: keyRotationStatus.ageDays,
      keyRotationMaxAgeDays: keyRotationStatus.maxAgeDays,
      pentestDueSoonCount: pentestStatus.due.length,
      pentestLeadDays: pentestStatus.leadDays,
    };

    await notifyAdmins({ serviceClient, summary });
    await logSecurityEvent({
      serviceClient,
      eventType: "security_ops_monitor_completed",
      severity: "info",
      userId: invokingUserId,
      ip,
      context: {
        cronAuthorized,
        ...summary,
      },
    });

    return jsonResponse({
      success: true,
      source: cronAuthorized ? "cron" : "admin",
      summary,
    });
  } catch (error) {
    await logSecurityEvent({
      serviceClient,
      eventType: "security_ops_monitor_exception",
      severity: "error",
      userId: invokingUserId,
      ip,
      context: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return jsonResponse({ success: false, error: "security_ops_monitor_failed" }, 500);
  }
});
