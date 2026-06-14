// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type ParsedSseEvent = {
  event: string
  data: any
}

const splitTextIntoStreamingChunks = (value: string, maxChunkSize: number = 24): string[] => {
  const text = String(value || "")
  if (!text.trim()) return []

  const chunks: string[] = []
  let cursor = 0
  const safeMax = Math.max(16, maxChunkSize)

  while (cursor < text.length) {
    let end = Math.min(cursor + safeMax, text.length)
    if (end < text.length) {
      const slice = text.slice(cursor, end)
      const breakAt = Math.max(
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf(", "),
        slice.lastIndexOf(" ")
      )
      if (breakAt > 6) {
        end = cursor + breakAt + 1
      }
    }
    const part = text.slice(cursor, end)
    if (part) chunks.push(part)
    cursor = end
  }

  return chunks
}

const parseSseBuffer = (buffer: string): { events: ParsedSseEvent[]; rest: string } => {
  const normalized = buffer.replace(/\r\n/g, "\n")
  const events: ParsedSseEvent[] = []
  let cursor = 0

  while (true) {
    const boundary = normalized.indexOf("\n\n", cursor)
    if (boundary < 0) break

    const block = normalized.slice(cursor, boundary).trim()
    cursor = boundary + 2
    if (!block) continue

    let eventName = "message"
    const dataParts: string[] = []
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message"
      } else if (line.startsWith("data:")) {
        dataParts.push(line.slice(5).trim())
      }
    }

    const rawData = dataParts.join("\n")
    if (!rawData) continue

    let data: any = rawData
    try {
      data = JSON.parse(rawData)
    } catch {
      // keep text payload
    }

    events.push({ event: eventName, data })
  }

  return {
    events,
    rest: normalized.slice(cursor),
  }
}

const safeJsonParse = (raw: string): any => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const getWsBaseFromSupabaseUrl = (supabaseUrl: string): string => {
  if (!supabaseUrl) return ""
  if (supabaseUrl.startsWith("https://")) return `wss://${supabaseUrl.slice("https://".length)}`
  if (supabaseUrl.startsWith("http://")) return `ws://${supabaseUrl.slice("http://".length)}`
  return supabaseUrl
}

const toMessageText = (value: unknown, fallback = "Unknown websocket error"): string => {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (value && typeof value === "object" && typeof (value as any).message === "string") {
    const message = (value as any).message.trim()
    if (message) return message
  }
  return fallback
}

const sendWs = (socket: WebSocket, payload: any) => {
  if (socket.readyState !== WebSocket.OPEN) return
  try {
    socket.send(JSON.stringify(payload))
  } catch {
    // noop
  }
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
      source: "chat-agent-ws",
      context: args.context || {},
    })
  } catch {
    // never block websocket flow on telemetry failures
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

const normalizeChatPayload = (payload: any) => {
  return {
    message: typeof payload?.message === "string" ? payload.message.trim() : "",
    concern: typeof payload?.concern === "string" ? payload.concern.trim() : "General",
    conversationId: typeof payload?.conversationId === "string" ? payload.conversationId : null,
    mode: typeof payload?.mode === "string" ? payload.mode : "assistant",
    history: Array.isArray(payload?.history) ? payload.history : [],
    locationCity: typeof payload?.locationCity === "string" ? payload.locationCity : null,
    searchAreaCity: typeof payload?.searchAreaCity === "string" ? payload.searchAreaCity : null,
    fastResponse: payload?.fastResponse === true,
    quick: payload?.quick === true,
    replyInVoice: payload?.replyInVoice === true,
  }
}

const normalizeVoicePayload = (payload: any) => {
  return {
    text: typeof payload?.text === "string" ? payload.text.trim() : "",
    concern: typeof payload?.concern === "string" ? payload.concern.trim() : "General Assistant",
    conversationId: typeof payload?.conversationId === "string" ? payload.conversationId : null,
    mode: typeof payload?.mode === "string" ? payload.mode : "assistant",
    history: Array.isArray(payload?.history) ? payload.history : [],
    locationCity: typeof payload?.locationCity === "string" ? payload.locationCity : null,
    searchAreaCity: typeof payload?.searchAreaCity === "string" ? payload.searchAreaCity : null,
    preferredCity: typeof payload?.preferredCity === "string" ? payload.preferredCity : null,
    voicePersona: typeof payload?.voicePersona === "string" ? payload.voicePersona : "female",
    preferLocalPlayback: payload?.preferLocalPlayback === true,
  }
}

const invokeChatAiOverSse = async (args: {
  supabaseUrl: string
  apiKey: string
  accessToken: string
  payload: any
  signal?: AbortSignal
  onDelta: (text: string) => void
}) => {
  const response = await fetch(`${args.supabaseUrl}/functions/v1/chat-ai`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      apikey: args.apiKey,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      ...normalizeChatPayload(args.payload),
      stream: true,
    }),
    signal: args.signal,
  })

  if (!response.ok) {
    const rawError = await response.text().catch(() => "")
    const parsedError = safeJsonParse(rawError)
    throw new Error(toMessageText(parsedError || rawError || `chat-ai failed (${response.status})`))
  }

  const reader = response.body?.getReader?.()
  if (!reader) {
    const rawText = await response.text().catch(() => "")
    const parsedTextPayload = safeJsonParse(rawText)
    if (parsedTextPayload && typeof parsedTextPayload === "object") {
      return parsedTextPayload
    }
    throw new Error("chat-ai stream reader unavailable")
  }

  const decoder = new TextDecoder()
  let buffer = ""
  let finalPayload: any = null
  let streamedText = ""
  let deltaSeen = false
  let shouldStop = false

  const handleEvent = (event: ParsedSseEvent) => {
    if (event.event === "error") {
      throw new Error(toMessageText(event.data, "AI streaming failed"))
    }

    if (event.event === "delta") {
      const text =
        typeof event.data?.text === "string"
          ? event.data.text
          : typeof event.data === "string"
            ? event.data
            : ""
      if (text) {
        streamedText += text
        deltaSeen = true
        args.onDelta(text)
      }
      return
    }

    if (event.event === "done") {
      finalPayload = event.data
      shouldStop = true
      return
    }

    if (event.event === "message") {
      const payload = event.data
      const isStructured =
        payload &&
        typeof payload === "object" &&
        (
          payload.success === true ||
          typeof payload?.data?.reply === "string" ||
          typeof payload?.data?.text === "string" ||
          Boolean(payload?.data?.rateLimit)
        )
      if (isStructured) {
        finalPayload = payload
        shouldStop = true
      } else if (typeof payload === "string" && payload.trim()) {
        streamedText += payload
        args.onDelta(payload)
      }
    }
  }

  while (!shouldStop) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseBuffer(buffer)
    buffer = parsed.rest
    for (const event of parsed.events) {
      handleEvent(event)
      if (shouldStop) break
    }
  }

  const tail = decoder.decode()
  if (tail) {
    buffer += tail
    const parsed = parseSseBuffer(buffer)
    for (const event of parsed.events) {
      handleEvent(event)
      if (shouldStop) break
    }
  }

  if (!finalPayload) {
    if (streamedText.trim()) {
      finalPayload = {
        success: true,
        data: {
          reply: streamedText.trim(),
          source: "ws_stream",
        },
      }
    } else {
      throw new Error("chat-ai stream completed without payload")
    }
  }

  // Upstream may sometimes return only final structured payload without delta events.
  // In that case we synthesize chunk deltas here so UI still renders line-by-line.
  if (!deltaSeen && !streamedText.trim()) {
    const replyText =
      typeof finalPayload?.data?.reply === "string"
        ? finalPayload.data.reply
        : typeof finalPayload?.message === "string"
          ? finalPayload.message
          : ""
    const synthesizedChunks = splitTextIntoStreamingChunks(replyText)
    if (synthesizedChunks.length > 0) {
      const baseDelayMs =
        synthesizedChunks.length > 140
          ? 7
          : synthesizedChunks.length > 90
            ? 9
            : synthesizedChunks.length > 50
              ? 12
              : 16
      for (let index = 0; index < synthesizedChunks.length; index += 1) {
        const chunk = synthesizedChunks[index]
        streamedText += chunk
        args.onDelta(chunk)
        if (index > 0) {
          const trimmedChunk = chunk.trimEnd()
          const punctuationPause = /[.!?]$/.test(trimmedChunk)
            ? 26
            : /[,;:]$/.test(trimmedChunk)
              ? 12
              : 0
          await new Promise((resolve) => setTimeout(resolve, baseDelayMs + punctuationPause))
        }
      }
    }
  }

  return finalPayload
}

const invokeVoiceChatStreaming = async (args: {
  supabaseUrl: string
  apiKey: string
  accessToken: string
  payload: any
  socket: WebSocket
  requestId: string
  signal?: AbortSignal
}) => {
  const response = await fetch(`${args.supabaseUrl}/functions/v1/voice-chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      apikey: args.apiKey,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      ...normalizeVoicePayload(args.payload),
      stream: true,
    }),
    signal: args.signal,
  })

  if (!response.ok) {
    const rawError = await response.text().catch(() => "")
    const parsedError = safeJsonParse(rawError)
    throw new Error(toMessageText(parsedError || rawError || `voice-chat failed (${response.status})`))
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error("voice-chat stream reader unavailable")
  }

  const decoder = new TextDecoder()
  let buffer = ""
  let finalPayload: any = null
  let shouldStop = false

  const handleVoiceEvent = (event: ParsedSseEvent) => {
    if (event.event === "error") {
      throw new Error(toMessageText(event.data, "Voice streaming failed"))
    }

    if (event.event === "delta") {
      const text =
        typeof event.data?.text === "string"
          ? event.data.text
          : typeof event.data === "string"
            ? event.data
            : ""
      if (text) {
        sendWs(args.socket, {
          type: "delta",
          requestId: args.requestId,
          text,
          ts: Date.now(),
        })
      }
      return
    }

    if (event.event === "audio-chunk") {
      const audioChunk = event.data;
      if (audioChunk && typeof audioChunk.audio === "string") {
        const binaryString = atob(audioChunk.audio)
        const audioBytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          audioBytes[i] = binaryString.charCodeAt(i)
        }

        const textEncoder = new TextEncoder()
        const textBytes = textEncoder.encode(audioChunk.text || "")
        const packet = new Uint8Array(8 + textBytes.length + audioBytes.length)
        const view = new DataView(packet.buffer)
        
        view.setUint32(0, typeof audioChunk.index === 'number' ? audioChunk.index : 0, true)
        view.setUint32(4, textBytes.length, true)
        packet.set(textBytes, 8)
        packet.set(audioBytes, 8 + textBytes.length)

        if (args.socket.readyState === WebSocket.OPEN) {
          args.socket.send(packet)
        }
      }
      return
    }

    if (event.event === "done") {
      finalPayload = event.data
      shouldStop = true
      return
    }
  }

  while (!shouldStop) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseBuffer(buffer)
    buffer = parsed.rest
    for (const event of parsed.events) {
      handleVoiceEvent(event)
      if (shouldStop) break
    }
  }

  const tail = decoder.decode()
  if (tail) {
    buffer += tail
    const parsed = parseSseBuffer(buffer)
    for (const event of parsed.events) {
      handleVoiceEvent(event)
      if (shouldStop) break
    }
  }

  return finalPayload
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const upgradeHeader = req.headers.get("upgrade") || ""
  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response(
      JSON.stringify({
        success: true,
        message: "WebSocket endpoint. Connect using ws/wss and pass access token in query param ?token=",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim()
  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim()
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey).trim()
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return new Response("Environment not configured", { status: 500 })
  }

  const requestUrl = new URL(req.url)
  const accessToken =
    requestUrl.searchParams.get("token") ||
    requestUrl.searchParams.get("access_token") ||
    ""
  const requestIp = getRequestIp(req)

  if (!accessToken) {
    return new Response("Unauthorized: token missing", { status: 401 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
  if (authError || !authData?.user) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { socket, response } = Deno.upgradeWebSocket(req)
  const userId = authData.user.id
  let liveAccessToken = accessToken
  const WS_FLOOD_WINDOW_MS = 10_000
  const WS_FLOOD_MAX_MESSAGES = 80
  let wsFloodWindowStartedAt = Date.now()
  let wsFloodMessageCount = 0

  const wsPendingRequests = new Map<string, AbortController>()

  const cancelRequest = (requestId: string) => {
    const active = wsPendingRequests.get(requestId)
    if (active) {
      try {
        active.abort()
      } catch {
        // noop
      }
      wsPendingRequests.delete(requestId)
    }
  }

  socket.onopen = () => {
    void logSecurityEvent(supabase, {
      eventType: "chat_agent_ws_connected",
      severity: "info",
      userId,
      ip: requestIp,
    })
    sendWs(socket, {
      type: "session.ready",
      userId,
      transport: "websocket",
      mode: "chat-agent-ws",
      wsBase: getWsBaseFromSupabaseUrl(supabaseUrl),
      ts: Date.now(),
    })
  }

  socket.onmessage = async (event) => {
    let incoming: any = null
    try {
      incoming = typeof event.data === "string" ? JSON.parse(event.data) : null
    } catch {
      incoming = null
    }

    if (!incoming || typeof incoming !== "object") {
      sendWs(socket, { type: "error", message: "Invalid websocket payload" })
      return
    }

    const requestId =
      typeof incoming.requestId === "string" && incoming.requestId.trim()
        ? incoming.requestId.trim()
        : crypto.randomUUID()

    const type = typeof incoming.type === "string" ? incoming.type.trim() : ""
    const payload = incoming.payload || {}

    const now = Date.now()
    if (now - wsFloodWindowStartedAt > WS_FLOOD_WINDOW_MS) {
      wsFloodWindowStartedAt = now
      wsFloodMessageCount = 0
    }
    wsFloodMessageCount += 1
    if (wsFloodMessageCount > WS_FLOOD_MAX_MESSAGES) {
      void logSecurityEvent(supabase, {
        eventType: "chat_agent_ws_socket_flood",
        severity: "warn",
        userId,
        ip: requestIp,
        context: {
          count: wsFloodMessageCount,
          windowMs: WS_FLOOD_WINDOW_MS,
          type,
        },
      })
      sendWs(socket, {
        type: "error",
        requestId,
        message: "rate_limit_exceeded",
        retryAfterSec: 10,
        ts: Date.now(),
      })
      return
    }

    if (type === "ping") {
      sendWs(socket, { type: "pong", requestId, ts: Date.now() })
      return
    }

    if (type === "auth.update") {
      const nextToken =
        typeof incoming?.token === "string" ? incoming.token.trim() : ""
      if (!nextToken) {
        sendWs(socket, { type: "error", requestId, message: "auth.update requires token" })
        return
      }
      const { data: tokenData, error: tokenError } = await supabase.auth.getUser(nextToken)
      if (tokenError || !tokenData?.user?.id) {
        void logSecurityEvent(supabase, {
          eventType: "chat_agent_ws_auth_update_invalid_token",
          severity: "warn",
          userId,
          ip: requestIp,
        })
        sendWs(socket, { type: "error", requestId, message: "invalid_auth_update_token", ts: Date.now() })
        return
      }
      if (tokenData.user.id !== userId) {
        void logSecurityEvent(supabase, {
          eventType: "chat_agent_ws_auth_update_user_mismatch",
          severity: "critical",
          userId,
          ip: requestIp,
          context: { nextUserId: tokenData.user.id },
        })
        sendWs(socket, { type: "error", requestId, message: "auth_update_user_mismatch", ts: Date.now() })
        return
      }
      liveAccessToken = nextToken
      sendWs(socket, { type: "auth.updated", requestId, ts: Date.now() })
      return
    }

    if (type === "cancel") {
      const targetRequestId =
        typeof incoming?.targetRequestId === "string" ? incoming.targetRequestId.trim() : requestId
      cancelRequest(targetRequestId)
      sendWs(socket, { type: "cancelled", requestId: targetRequestId, ts: Date.now() })
      return
    }

    if (type !== "chat.message" && type !== "voice.message") {
      sendWs(socket, { type: "error", requestId, message: `Unsupported message type: ${type}` })
      return
    }

    const abortController = new AbortController()
    wsPendingRequests.set(requestId, abortController)
    sendWs(socket, { type: "ack", requestId, channel: type, ts: Date.now() })

    try {
      const requestRateLimit = await enforceRateLimit(supabase, {
        scope: "chat-agent-ws-request",
        subject: userId,
        maxRequests: 40,
        windowSeconds: 60,
      })
      if (!requestRateLimit.allowed) {
        void logSecurityEvent(supabase, {
          eventType: "chat_agent_ws_rate_limited",
          severity: "warn",
          userId,
          ip: requestIp,
          context: {
            type,
            retryAfterSec: requestRateLimit.retryAfterSec,
            currentCount: requestRateLimit.currentCount,
          },
        })
        sendWs(socket, {
          type: "error",
          requestId,
          message: "rate_limit_exceeded",
          retryAfterSec: requestRateLimit.retryAfterSec,
          ts: Date.now(),
        })
        return
      }

      if (type === "chat.message") {
        const finalPayload = await invokeChatAiOverSse({
          supabaseUrl,
          apiKey: anonKey,
          accessToken: liveAccessToken,
          payload,
          signal: abortController.signal,
          onDelta: (deltaText) => {
            sendWs(socket, {
              type: "delta",
              requestId,
              text: deltaText,
              ts: Date.now(),
            })
          },
        })

        sendWs(socket, {
          type: "done",
          requestId,
          payload: finalPayload,
          ts: Date.now(),
        })
      } else {
        sendWs(socket, {
          type: "stage",
          requestId,
          stage: "processing_voice",
          ts: Date.now(),
        })
        const finalPayload = await invokeVoiceChatStreaming({
          supabaseUrl,
          apiKey: anonKey,
          accessToken: liveAccessToken,
          payload,
          socket,
          requestId,
          signal: abortController.signal,
        })
        sendWs(socket, {
          type: "done",
          requestId,
          payload: finalPayload,
          ts: Date.now(),
        })
      }
    } catch (error) {
      const wasCancelled =
        abortController.signal.aborted ||
        (error && typeof error === "object" && (error as any).name === "AbortError")
      if (wasCancelled) {
        sendWs(socket, {
          type: "cancelled",
          requestId,
          ts: Date.now(),
        })
      } else {
        sendWs(socket, {
          type: "error",
          requestId,
          message: toMessageText(error, "WebSocket request failed"),
          ts: Date.now(),
        })
      }
    } finally {
      wsPendingRequests.delete(requestId)
    }
  }

  socket.onclose = () => {
    for (const [requestId] of wsPendingRequests.entries()) {
      cancelRequest(requestId)
    }
    wsPendingRequests.clear()
    void logSecurityEvent(supabase, {
      eventType: "chat_agent_ws_disconnected",
      severity: "info",
      userId,
      ip: requestIp,
    })
  }

  socket.onerror = () => {
    for (const [requestId] of wsPendingRequests.entries()) {
      cancelRequest(requestId)
    }
    wsPendingRequests.clear()
    void logSecurityEvent(supabase, {
      eventType: "chat_agent_ws_socket_error",
      severity: "warn",
      userId,
      ip: requestIp,
    })
  }

  return response
})
