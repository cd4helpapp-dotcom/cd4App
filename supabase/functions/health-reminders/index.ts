// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-health-reminders-secret",
}

const jsonResponse = (payload: Record<string, unknown>, status: number = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

const clipText = (value: string, maxLength: number): string => {
  const text = (value || "").trim()
  if (!text) return ""
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

const createServiceClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey)
}

const extractBearerToken = (req: Request): string => {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || ""
  if (!authHeader.toLowerCase().startsWith("bearer ")) return ""
  return authHeader.slice(7).trim()
}

const getRequestIp = (req: Request): string | null => {
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || ""
  const first = forwarded.split(",")[0]?.trim()
  return first || null
}

const logSecurityEvent = async (serviceClient: any, args: {
  eventType: string
  severity: "info" | "warn" | "error" | "critical"
  userId?: string | null
  ip?: string | null
  context?: Record<string, unknown>
}) => {
  try {
    await serviceClient.from("security_audit_logs").insert({
      event_type: args.eventType,
      severity: args.severity,
      user_id: args.userId || null,
      ip: args.ip || null,
      source: "health-reminders",
      context: args.context || {},
    })
  } catch {
    // never block reminder run on telemetry failure
  }
}

const enforceRateLimit = async (serviceClient: any, args: {
  scope: string
  subject: string
  maxRequests: number
  windowSeconds: number
}) => {
  const { data, error } = await serviceClient.rpc("security_check_rate_limit", {
    p_scope: args.scope,
    p_subject: args.subject,
    p_window_seconds: Math.max(1, Math.floor(args.windowSeconds)),
    p_max_requests: Math.max(1, Math.floor(args.maxRequests)),
  })

  if (error) {
    return { allowed: true, retryAfterSec: 0, currentCount: null }
  }

  const row = Array.isArray(data) ? data[0] : data
  return {
    allowed: Boolean(row?.allowed),
    retryAfterSec: typeof row?.retry_after_sec === "number" ? row.retry_after_sec : 0,
    currentCount: typeof row?.current_count === "number" ? row.current_count : null,
  }
}

const isPushEnabledFromSettings = (settings: unknown): boolean => {
  if (!settings || typeof settings !== "object") return true
  const notifications = (settings as any).notifications
  if (!notifications || typeof notifications !== "object") return true
  const push = (notifications as any).push
  if (typeof push === "boolean") return push
  return true
}

const getExpoPushTicketErrors = (payload: any): any[] => {
  const tickets = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : []
  const ticketErrors = tickets.filter((ticket: any) => ticket?.status === "error")
  const requestErrors = Array.isArray(payload?.errors) ? payload.errors : []
  return [...ticketErrors, ...requestErrors]
}

const sendExpoPush = async (message: Record<string, unknown>) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: controller.signal,
    })
    let payload: any = null
    try { payload = await res.json() } catch { payload = null }
    const ticketErrors = getExpoPushTicketErrors(payload)
    return { ok: res.ok && ticketErrors.length === 0, status: res.status, payload, ticketErrors }
  } finally {
    clearTimeout(timeoutId)
  }
}

const CRITICAL_HINT_PATTERNS: RegExp[] = [
  /\b(urgent|critical|emergency|severe|immediate medical|hospital|er|icu)\b/i,
  /\b(difficulty breathing|chest pain|persistent vomiting|severe weakness|dehydration)\b/i,
  /\b(high risk|danger|warning sign|red flag)\b/i,
]

const containsCriticalHint = (value: unknown): boolean => {
  if (typeof value !== "string") return false
  const text = value.trim()
  if (!text) return false
  return CRITICAL_HINT_PATTERNS.some((pattern) => pattern.test(text))
}

const toTextList = (value: unknown, maxItems = 16): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(0, maxItems)
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\n|;|•|,/g)
      .map((item) => item.trim())
      .filter((item) => item.length > 1)
      .slice(0, maxItems)
  }
  return []
}

const isCriticalPrescriptionFromStructured = (structured: any): boolean => {
  if (!structured || typeof structured !== "object") return false
  const cautionFlags = toTextList(structured.caution_flags ?? structured.cautionFlags, 20)
  const prescriptionDetails =
    structured.prescription_details && typeof structured.prescription_details === "object"
      ? structured.prescription_details
      : structured.prescriptionDetails && typeof structured.prescriptionDetails === "object"
      ? structured.prescriptionDetails
      : {}
  const redFlags = toTextList(
    (prescriptionDetails as any).red_flags ??
      (prescriptionDetails as any).warning_signs ??
      (prescriptionDetails as any).warningSigns,
    20,
  )
  const summary = typeof structured.summary === "string" ? structured.summary : ""
  const explanation = typeof structured.patient_friendly_explanation === "string"
    ? structured.patient_friendly_explanation
    : ""

  return (
    cautionFlags.some(containsCriticalHint) ||
    redFlags.some(containsCriticalHint) ||
    containsCriticalHint(summary) ||
    containsCriticalHint(explanation)
  )
}

// ─── AI-Based Contextual Health Reminders ────────────────────────────────
// Logic:
//   1. Look at each user's AI conversations from YESTERDAY
//   2. Extract health topics they discussed (BP, sugar, headache, etc.)
//   3. If they discussed a topic yesterday, send ONE follow-up push today
//   4. If they did NOT discuss anything yesterday → send NOTHING (no spam)
//   5. Max 1 reminder per user per run

const HEALTH_TOPIC_MAP: Record<string, { keywords: string[]; title: string; body: string }> = {
  blood_pressure: {
    keywords: ['bp', 'blood pressure', 'hypertension', 'systolic', 'diastolic'],
    title: '🩺 BP Follow-up',
    body: 'Kal aapne BP ke baare mein pucha tha. Aaj apna BP check karke CD4 mein update karein!',
  },
  sugar: {
    keywords: ['sugar', 'diabetes', 'glucose', 'insulin', 'hba1c', 'fasting sugar'],
    title: '🍬 Sugar Level Check',
    body: 'Kal aapne sugar ke baare mein baat ki thi. Aaj apna sugar level check karein aur CD4 mein track karein.',
  },
  headache: {
    keywords: ['headache', 'sir dard', 'migraine', 'head pain'],
    title: '🤕 How are you feeling?',
    body: 'Kal aapne headache ke baare mein pucha tha. Kya aaj better feel ho raha hai? CD4 mein update karein.',
  },
  heart: {
    keywords: ['heart', 'chest pain', 'pulse', 'palpitation', 'dil'],
    title: '❤️ Heart Health Follow-up',
    body: 'Kal aapne heart/pulse ke baare mein baat ki thi. Aaj apni pulse check karein aur CD4 mein save karein.',
  },
  weight: {
    keywords: ['weight', 'wajan', 'obesity', 'bmi', 'motapa'],
    title: '⚖️ Weight Tracking',
    body: 'Kal aapne weight ke baare mein baat ki thi. Aaj apna weight track karein!',
  },
  fever: {
    keywords: ['fever', 'bukhar', 'temperature', 'tapman'],
    title: '🌡️ Fever Follow-up',
    body: 'Kal aapko bukhar tha. Kya aaj theek ho? Temperature check karke CD4 mein batayein.',
  },
  stomach: {
    keywords: ['stomach', 'pet dard', 'acidity', 'digestion', 'vomit', 'diarrhea', 'ulti', 'dast'],
    title: '🤢 Stomach Follow-up',
    body: 'Kal aapne pet ki problem ke baare mein pucha tha. Kya aaj better hai? CD4 mein update karein.',
  },
  medicine: {
    keywords: ['medicine', 'dawai', 'tablet', 'capsule', 'dose', 'side effect'],
    title: '💊 Medicine Reminder',
    body: 'Kal aapne medicine ke baare mein baat ki thi. Apni dawai zamanay pe lein aur koi side effect ho toh CD4 mein batayein.',
  },
  reports: {
    keywords: ['report', 'lab', 'test', 'scan', 'xray', 'mri', 'cbc', 'thyroid'],
    title: '📋 Report Follow-up',
    body: 'Kal aapne reports ke baare mein baat ki thi. Koi nayi report hai toh CD4 mein scan karein — AI analyze kar dega!',
  },
  breathing: {
    keywords: ['breathing', 'saans', 'asthma', 'cough', 'khansi', 'lungs'],
    title: '🫁 Breathing Check',
    body: 'Kal aapne saans/cough ke baare mein pucha tha. Aaj kaisa feel ho raha hai? CD4 mein update karein.',
  },
}

const normalize = (text: string): string =>
  (text || '').trim().toLowerCase().replace(/\s+/g, ' ')

const detectTopicsFromText = (text: string): string[] => {
  const normalizedText = normalize(text)
  const matched: string[] = []
  for (const [topicId, config] of Object.entries(HEALTH_TOPIC_MAP)) {
    if (config.keywords.some(kw => normalizedText.includes(kw))) {
      matched.push(topicId)
    }
  }
  return matched
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const serviceClient = createServiceClient()
    if (!serviceClient) {
      return jsonResponse({ success: false, reason: "service_env_missing" }, 500)
    }
    const requestIp = getRequestIp(req)

    const configuredCronSecret = (Deno.env.get("HEALTH_REMINDERS_CRON_SECRET") || "").trim()
    const providedCronSecret = (req.headers.get("x-health-reminders-secret") || "").trim()
    const isCronInvocation =
      Boolean(configuredCronSecret) &&
      Boolean(providedCronSecret) &&
      configuredCronSecret === providedCronSecret

    let actorUserId: string | null = null
    if (!isCronInvocation) {
      const accessToken = extractBearerToken(req)
      if (!accessToken) {
        await logSecurityEvent(serviceClient, {
          eventType: "health_reminders_missing_token",
          severity: "warn",
          ip: requestIp,
        })
        return jsonResponse({ success: false, reason: "missing_bearer_token" }, 401)
      }

      const { data: authData, error: authError } = await serviceClient.auth.getUser(accessToken)
      if (authError || !authData?.user?.id) {
        await logSecurityEvent(serviceClient, {
          eventType: "health_reminders_invalid_token",
          severity: "warn",
          ip: requestIp,
        })
        return jsonResponse({ success: false, reason: "invalid_or_expired_token" }, 401)
      }
      actorUserId = authData.user.id

      const { data: actorProfile } = await serviceClient
        .from("profiles")
        .select("role_id")
        .eq("id", actorUserId)
        .maybeSingle()
      let actorRole = ""
      if (actorProfile?.role_id) {
        const { data: roleRow } = await serviceClient
          .from("roles")
          .select("slug")
          .eq("id", actorProfile.role_id)
          .maybeSingle()
        actorRole = String(roleRow?.slug || "").toLowerCase()
      }
      if (actorRole !== "admin") {
        await logSecurityEvent(serviceClient, {
          eventType: "health_reminders_forbidden",
          severity: "warn",
          userId: actorUserId,
          ip: requestIp,
          context: { actorRole: actorRole || "unknown" },
        })
        return jsonResponse({ success: false, reason: "admin_or_cron_required" }, 403)
      }

      const rateLimit = await enforceRateLimit(serviceClient, {
        scope: "health-reminders-manual",
        subject: actorUserId,
        maxRequests: 3,
        windowSeconds: 10 * 60,
      })
      if (!rateLimit.allowed) {
        await logSecurityEvent(serviceClient, {
          eventType: "health_reminders_rate_limited",
          severity: "warn",
          userId: actorUserId,
          ip: requestIp,
          context: {
            retryAfterSec: rateLimit.retryAfterSec,
            currentCount: rateLimit.currentCount,
          },
        })
        return jsonResponse({
          success: false,
          reason: "rate_limit_exceeded",
          retryAfterSec: rateLimit.retryAfterSec,
        }, 429)
      }
    }

    const now = new Date()
    const sent: string[] = []
    const skipped: string[] = []
    const errors: string[] = []
    const prescriptionRemindersSent: string[] = []

    // Time window: yesterday 00:00 to yesterday 23:59 (IST, UTC+5:30)
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
    const todayISTStart = new Date(now.getTime() + IST_OFFSET_MS)
    todayISTStart.setUTCHours(0, 0, 0, 0)
    const yesterdayISTStart = new Date(todayISTStart.getTime() - 24 * 60 * 60 * 1000)
    const yesterdayUTCStart = new Date(yesterdayISTStart.getTime() - IST_OFFSET_MS)
    const yesterdayUTCEnd = new Date(todayISTStart.getTime() - IST_OFFSET_MS)

    const yesterdayStartIso = yesterdayUTCStart.toISOString()
    const yesterdayEndIso = yesterdayUTCEnd.toISOString()

    // Also check today's actions — if user ALREADY interacted today, skip them (they're active, no need to remind)
    const todayUTCStart = new Date(todayISTStart.getTime() - IST_OFFSET_MS)
    const todayStartIso = todayUTCStart.toISOString()

    const [
      { data: yesterdayVoiceActions },
      { data: yesterdayChatActions },
      { data: yesterdayChatMessages },
      { data: todayActions },
      { data: todayChatMessages },
    ] = await Promise.all([
      serviceClient
        .from("ai_agent_actions")
        .select("user_id, payload")
        .eq("action", "voice_chat")
        .gte("created_at", yesterdayStartIso)
        .lte("created_at", yesterdayEndIso)
        .limit(1200),
      serviceClient
        .from("ai_agent_actions")
        .select("user_id, payload")
        .eq("action", "chat_ai_response")
        .gte("created_at", yesterdayStartIso)
        .lte("created_at", yesterdayEndIso)
        .limit(1200),
      // New source: persisted AI chat user messages (primary source for typed AI chat).
      serviceClient
        .from("ai_chat_messages")
        .select("user_id, text")
        .eq("sender", "user")
        .gte("created_at", yesterdayStartIso)
        .lte("created_at", yesterdayEndIso)
        .limit(3000),
      serviceClient
        .from("ai_agent_actions")
        .select("user_id")
        .gte("created_at", todayStartIso)
        .limit(1200),
      serviceClient
        .from("ai_chat_messages")
        .select("user_id")
        .eq("sender", "user")
        .gte("created_at", todayStartIso)
        .limit(3000),
    ])

    const activeToday = new Set<string>()
    for (const row of [...(todayActions || []), ...(todayChatMessages || [])]) {
      const uid = row?.user_id
      if (typeof uid === "string" && uid.trim().length > 0) {
        activeToday.add(uid)
      }
    }

    // Merge yesterday's voice + chat action payloads per user
    const allYesterday = [...(yesterdayVoiceActions || []), ...(yesterdayChatActions || [])]
    const userTopicMap = new Map<string, Set<string>>()

    for (const action of allYesterday) {
      const uid = action.user_id
      if (!uid) continue
      // Skip users who already used the app today — they don't need reminding
      if (activeToday.has(uid)) continue

      const payloadStr = JSON.stringify(action.payload || {})
      const topics = detectTopicsFromText(payloadStr)
      if (topics.length > 0) {
        if (!userTopicMap.has(uid)) userTopicMap.set(uid, new Set())
        topics.forEach(t => userTopicMap.get(uid)!.add(t))
      }
    }

    // Also scan yesterday typed chat text content for health topics.
    for (const chatMessage of yesterdayChatMessages || []) {
      const uid = chatMessage?.user_id
      if (!uid) continue
      if (activeToday.has(uid)) continue

      const topics = detectTopicsFromText(String(chatMessage?.text || ""))
      if (topics.length > 0) {
        if (!userTopicMap.has(uid)) userTopicMap.set(uid, new Set())
        topics.forEach((topicId) => userTopicMap.get(uid)!.add(topicId))
      }
    }

    if (userTopicMap.size === 0) {
      console.log('[health-reminders] No users had relevant health conversations yesterday. Nothing to send.')
      await logSecurityEvent(serviceClient, {
        eventType: "health_reminders_no_targets",
        severity: "info",
        userId: actorUserId,
        ip: requestIp,
        context: { invocationType: isCronInvocation ? "cron" : "manual" },
      })
      return jsonResponse({
        success: true,
        totalUsers: 0,
        sent: 0,
        reason: 'no_relevant_conversations_yesterday',
      })
    }

    // Fetch push tokens for relevant users
    const userIds = Array.from(userTopicMap.keys())
    const { data: profiles } = await serviceClient
      .from("profiles")
      .select("id, push_token, settings")
      .in("id", userIds)
      .not("push_token", "is", null)

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return jsonResponse({ success: true, totalUsers: userIds.length, sent: 0, reason: 'no_push_tokens' })
    }

    for (const profile of profiles) {
      if (!profile.push_token) continue
      if (!isPushEnabledFromSettings(profile.settings)) continue
      const topics = userTopicMap.get(profile.id)
      if (!topics || topics.size === 0) continue

      // Pick first matched topic for the reminder (max 1 per user)
      const topicId = Array.from(topics)[0]
      const topicConfig = HEALTH_TOPIC_MAP[topicId]
      if (!topicConfig) continue

      try {
        const result = await sendExpoPush({
          to: profile.push_token,
          sound: "default",
          title: topicConfig.title,
          body: topicConfig.body,
          data: { type: "health_reminder_ai", topicId, reminderId: `ai_${topicId}` },
          priority: "default",
          // Keep using an already-provisioned Android channel for backward compatibility
          // with existing app builds that may not yet include a dedicated reminders channel.
          channelId: "appointments",
        })
        if (result.ok) {
          sent.push(`${profile.id}:${topicId}`)
        } else {
          skipped.push(`${profile.id}:${topicId}:push_failed`)
        }
      } catch (err: any) {
        errors.push(`${profile.id}:${topicId}:${clipText(err?.message || 'unknown', 80)}`)
      }
    }

    // Critical prescription 12h reminder (once per latest prescription)
    const PRESCRIPTION_REMINDER_DELAY_MS = 12 * 60 * 60 * 1000
    const reminderCutoffIso = new Date(now.getTime() - PRESCRIPTION_REMINDER_DELAY_MS).toISOString()

    const { data: recentPrescriptionRows } = await serviceClient
      .from("medical_reports")
      .select("id, patient_id, source, report_type, analysis_status, analyzed_at, created_at, ai_structured")
      .eq("source", "prescription_upload")
      .eq("analysis_status", "completed")
      .lte("created_at", reminderCutoffIso)
      .order("created_at", { ascending: false })
      .limit(2000)

    const latestPrescriptionPerUser = new Map<string, any>()
    for (const row of recentPrescriptionRows || []) {
      const uid = String(row?.patient_id || "").trim()
      if (!uid) continue
      if (activeToday.has(uid)) continue
      if (latestPrescriptionPerUser.has(uid)) continue
      latestPrescriptionPerUser.set(uid, row)
    }

    if (latestPrescriptionPerUser.size > 0) {
      const candidateIds = Array.from(latestPrescriptionPerUser.values()).map((row) => row.id)
      const { data: sentNotifications } = await serviceClient
        .from("in_app_notifications")
        .select("user_id, data")
        .eq("type", "critical_prescription_12h_followup")
        .in("user_id", Array.from(latestPrescriptionPerUser.keys()))
        .gte("created_at", new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(5000)

      const alreadySentKeys = new Set<string>()
      for (const item of sentNotifications || []) {
        const uid = String((item as any)?.user_id || "").trim()
        const reportId = String((item as any)?.data?.reportId || "").trim()
        if (!uid || !reportId) continue
        alreadySentKeys.add(`${uid}:${reportId}`)
      }

      const { data: rxProfiles } = await serviceClient
        .from("profiles")
        .select("id, push_token, settings")
        .in("id", Array.from(latestPrescriptionPerUser.keys()))
        .not("push_token", "is", null)

      const profileById = new Map<string, any>()
      for (const profile of rxProfiles || []) {
        profileById.set(String(profile.id), profile)
      }

      for (const row of latestPrescriptionPerUser.values()) {
        const uid = String(row.patient_id || "").trim()
        const reportId = String(row.id || "").trim()
        if (!uid || !reportId) continue
        if (alreadySentKeys.has(`${uid}:${reportId}`)) continue
        if (!candidateIds.includes(reportId)) continue
        if (!isCriticalPrescriptionFromStructured(row.ai_structured || {})) continue

        const profile = profileById.get(uid)
        if (!profile?.push_token) continue
        if (!isPushEnabledFromSettings(profile.settings)) continue

        const title = "Prescription Follow-up Reminder"
        const body =
          "Aapki recent prescription me critical watchouts mile the. Kya ab symptoms better hain? Please doctor advice follow karein."

        try {
          await serviceClient.from("in_app_notifications").insert({
            user_id: uid,
            type: "critical_prescription_12h_followup",
            title,
            body,
            data: {
              reportId,
              source: "health_reminders",
              reminderAfterHours: 12,
            },
          })

          const pushResult = await sendExpoPush({
            to: profile.push_token,
            sound: "default",
            title,
            body,
            data: {
              type: "critical_prescription_12h_followup",
              reportId,
              reminderAfterHours: 12,
            },
            priority: "default",
            channelId: "appointments",
          })

          if (pushResult.ok) {
            prescriptionRemindersSent.push(`${uid}:${reportId}`)
          } else {
            skipped.push(`${uid}:critical_rx_12h:push_failed`)
          }
        } catch (err: any) {
          errors.push(`${uid}:critical_rx_12h:${clipText(err?.message || "unknown", 80)}`)
        }
      }
    }

    console.log(`[health-reminders] AI-based. Sent: ${sent.length}, Skipped: ${skipped.length}, Errors: ${errors.length}`)

    await logSecurityEvent(serviceClient, {
      eventType: "health_reminders_completed",
      severity: errors.length > 0 ? "warn" : "info",
      userId: actorUserId,
      ip: requestIp,
      context: {
        invocationType: isCronInvocation ? "cron" : "manual",
        sent: sent.length,
        skipped: skipped.length,
        errors: errors.length,
        criticalPrescriptionRemindersSent: prescriptionRemindersSent.length,
      },
    })

    return jsonResponse({
      success: true,
      totalUsersWithConversations: userTopicMap.size,
      totalUsersWithTokens: profiles.length,
      sent: sent.length,
      criticalPrescriptionRemindersSent: prescriptionRemindersSent.length,
      skipped: skipped.length,
      errors: errors.length,
      dataSources: {
        yesterdayVoiceActions: (yesterdayVoiceActions || []).length,
        yesterdayLegacyChatActions: (yesterdayChatActions || []).length,
        yesterdayChatMessages: (yesterdayChatMessages || []).length,
        activeTodayUsers: activeToday.size,
      },
      // Do not expose per-user reminder identifiers in API response.
      invocationType: isCronInvocation ? "cron" : "manual",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown health-reminders error"
    const serviceClient = createServiceClient()
    if (serviceClient) {
      await logSecurityEvent(serviceClient, {
        eventType: "health_reminders_exception",
        severity: "error",
        context: { message: clipText(message, 200) },
      })
    }
    return jsonResponse({ success: false, reason: "function_exception", error: clipText(message, 200) })
  }
})

