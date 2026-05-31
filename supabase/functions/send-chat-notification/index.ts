import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

const DEFAULT_CHANNEL_ID = "default"
const CALLS_CHANNEL_ID = "calls_ringtone_v2"
const parseEnvInt = (key: string, fallback: number): number => {
  const raw = Deno.env.get(key)
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}
const parseEnvBool = (key: string, fallback: boolean): boolean => {
  const raw = (Deno.env.get(key) || "").trim().toLowerCase()
  if (!raw) return fallback
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}
const RECIPIENT_ACTIVE_WINDOW_MS = Math.max(
  15_000,
  Math.min(10 * 60 * 1000, parseEnvInt("CHAT_NOTIFICATION_ACTIVE_WINDOW_MS", 90_000))
)
const SUPPRESS_RECENTLY_ACTIVE = parseEnvBool("CHAT_NOTIFICATION_SUPPRESS_RECENT_ACTIVE", false)
const CHAT_MESSAGE_READ_CHECK_DELAY_MS = Math.max(
  0,
  Math.min(5_000, parseEnvInt("CHAT_NOTIFICATION_READ_CHECK_DELAY_MS", 900))
)

const safeJsonParse = async (req: Request) => {
  try {
    return await req.json()
  } catch {
    return null
  }
}

const createServiceClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }
  return createClient(supabaseUrl, serviceRoleKey)
}

const getRecipientIdFromRoom = (room: any, senderId: string): string | null => {
  const patientId = typeof room?.patient_id === "string" ? room.patient_id : ""
  const doctorId = typeof room?.doctor_id === "string" ? room.doctor_id : ""
  if (!patientId || !doctorId) return null
  return senderId === patientId ? doctorId : patientId
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const toMillis = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

const isRecipientRecentlyActive = (lastSeenAt: unknown): boolean => {
  const lastSeenMs = toMillis(lastSeenAt)
  if (lastSeenMs === null) return false
  return Date.now() - lastSeenMs <= RECIPIENT_ACTIVE_WINDOW_MS
}

const isMessageAlreadyRead = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  messageId: string,
  roomId: string
): Promise<boolean> => {
  if (!serviceClient || !messageId || !roomId) return false

  const { data, error } = await serviceClient
    .from("chat_messages")
    .select("is_read")
    .eq("id", messageId)
    .eq("room_id", roomId)
    .maybeSingle()

  if (error || !data) return false
  return Boolean((data as any).is_read)
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
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    const ticketErrors = getExpoPushTicketErrors(payload)

    return {
      ok: res.ok && ticketErrors.length === 0,
      status: res.status,
      payload,
      ticketErrors,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const body = await safeJsonParse(req)
    if (!body || typeof body !== "object") {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "invalid_json_body",
      })
    }

    const record = body.record || null
    const table = typeof body.table === "string" && body.table.trim() ? body.table.trim() : "chat_messages"

    if (!record || typeof record !== "object") {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "missing_record_data",
      })
    }

    const roomId = typeof record.room_id === "string" ? record.room_id : ""
    if (!roomId) {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "missing_room_id",
      })
    }

    const senderId =
      (typeof record.sender_id === "string" ? record.sender_id : "") ||
      (typeof record.caller_id === "string" ? record.caller_id : "")

    if (!senderId) {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "missing_sender_id",
      })
    }

    const serviceClient = createServiceClient()
    if (!serviceClient) {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "service_env_missing",
      })
    }

    const authorizationHeader = req.headers.get("authorization") || req.headers.get("Authorization") || ""
    const bearerToken = authorizationHeader.toLowerCase().startsWith("bearer ")
      ? authorizationHeader.slice(7).trim()
      : ""

    let authenticatedUserId: string | null = null
    if (bearerToken) {
      const { data: authData, error: authError } = await serviceClient.auth.getUser(bearerToken)
      if (authError || !authData?.user?.id) {
        return jsonResponse({
          success: false,
          skipped: true,
          reason: "invalid_or_expired_token",
        })
      }

      authenticatedUserId = authData.user.id
      if (authenticatedUserId !== senderId) {
        return jsonResponse({
          success: false,
          skipped: true,
          reason: "sender_mismatch_with_authenticated_user",
        })
      }
    }

    const { data: room, error: roomError } = await serviceClient
      .from("chat_rooms")
      .select("id, patient_id, doctor_id")
      .eq("id", roomId)
      .single()

    if (roomError || !room) {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "room_not_found",
      })
    }

    if (
      authenticatedUserId &&
      authenticatedUserId !== room.patient_id &&
      authenticatedUserId !== room.doctor_id
    ) {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "authenticated_user_not_in_room",
      })
    }

    const recipientId = getRecipientIdFromRoom(room, senderId)
    if (!recipientId) {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "invalid_room_participants",
      })
    }

    const { data: senderProfile } = await serviceClient
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", senderId)
      .maybeSingle()

    const senderName = senderProfile?.first_name
      ? `${senderProfile.first_name}${senderProfile.last_name ? ` ${senderProfile.last_name}` : ""}`
      : "Someone"

    const { data: recipientProfile, error: recipientError } = await serviceClient
      .from("profiles")
      .select("push_token, last_seen_at, settings")
      .eq("id", recipientId)
      .maybeSingle()

    const recipientPushEnabled = isPushEnabledFromSettings((recipientProfile as any)?.settings)

    let title = senderName
    let notificationBody = ""
    const notificationData: Record<string, unknown> = { roomId, room_id: roomId }
    notificationData.recipientId = recipientId
    let channelId = DEFAULT_CHANNEL_ID

    if (table === "call_sessions") {
      if (record.status !== "ringing") {
        return jsonResponse({
          success: true,
          skipped: true,
          reason: "call_not_ringing",
        })
      }

      title = `📞 ${senderName}`
      notificationBody = `Incoming ${record.type === "video" ? "Video" : "Voice"} Call...`
      notificationData.type = "incoming_call"
      notificationData.callType = record.type
      notificationData.callId = record.id || null
      channelId = CALLS_CHANNEL_ID
      if (!recipientPushEnabled) {
        return jsonResponse({
          success: true,
          skipped: true,
          reason: "recipient_push_disabled",
        })
      }
    } else {
      const isEncrypted = Boolean(record.is_encrypted)
      const encryptedPreviewText =
        typeof record.notification_preview_text === "string"
          ? record.notification_preview_text
          : ""
      notificationBody = isEncrypted
        ? (encryptedPreviewText || "New secure message")
        : (record.text || "")
      if (record.type === "image") notificationBody = "📷 Photo"
      if (record.type === "file") notificationBody = "📄 Document"
      notificationData.type = "chat_message"
      notificationData.isEncrypted = isEncrypted
    }

    if (table !== "call_sessions") {
      const messageId = typeof record.id === "string" ? record.id.trim() : ""

      if (messageId && CHAT_MESSAGE_READ_CHECK_DELAY_MS > 0) {
        await sleep(CHAT_MESSAGE_READ_CHECK_DELAY_MS)
        const alreadyRead = await isMessageAlreadyRead(serviceClient, messageId, roomId)
        if (alreadyRead) {
          return jsonResponse({
            success: true,
            skipped: true,
            reason: "message_already_seen",
          })
        }
      }

      if (SUPPRESS_RECENTLY_ACTIVE && isRecipientRecentlyActive((recipientProfile as any)?.last_seen_at)) {
        return jsonResponse({
          success: true,
          skipped: true,
          reason: "recipient_recently_active",
        })
      }
    }

    // Persist as in-app notification first (skip for call ringing - those are transient)
    if (table !== "call_sessions") {
      try {
        await serviceClient
          .from("in_app_notifications")
          .insert({
            user_id: recipientId,
            type: "chat_message",
            title,
            body: clipText(notificationBody, 200),
            data: { roomId, room_id: roomId, senderName, senderId },
            is_read: false,
          })
      } catch (inAppErr) {
        console.warn("in_app_notifications insert failed:", inAppErr)
      }
    }

    if (recipientError || !recipientProfile?.push_token) {
      return jsonResponse({
        success: true,
        skipped: true,
        reason: "recipient_push_token_missing",
      })
    }

    if (!recipientPushEnabled) {
      return jsonResponse({
        success: true,
        skipped: true,
        reason: "recipient_push_disabled",
      })
    }

    const message: Record<string, unknown> = {
      to: recipientProfile.push_token,
      sound: "default",
      title,
      body: clipText(notificationBody, 200),
      data: notificationData,
      priority: "high",
      channelId,
    }

    if (table === "call_sessions" && record.status === "ringing") {
      message.categoryId = "incoming_call"
      message.categoryIdentifier = "incoming_call"
    }

    const expoResult = await sendExpoPush(message)
    if (!expoResult.ok) {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "expo_push_rejected",
        status: expoResult.status,
        expo: expoResult.payload || null,
      })
    }

    // Also persist as in-app notification (skip for call ringing - those are transient)
    // In-app notification was already processed above

    return jsonResponse({
      success: true,
      skipped: false,
      result: expoResult.payload || null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown notification function error"
    return jsonResponse({
      success: false,
      skipped: true,
      reason: "function_exception",
      error: clipText(message, 200),
    })
  }
})

