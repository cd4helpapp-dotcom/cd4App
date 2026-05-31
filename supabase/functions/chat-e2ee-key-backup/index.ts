import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

const base64ToBytes = (value: string): Uint8Array => {
  const normalized = (value || "").trim()
  const binary = atob(normalized)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

const clip = (value: string, max: number): string => {
  const text = (value || "").trim()
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

const deriveWrapKeyMaterial = async (raw: string): Promise<Uint8Array> => {
  const normalized = raw.trim()
  let sourceBytes: Uint8Array
  try {
    sourceBytes = base64ToBytes(normalized)
  } catch {
    sourceBytes = utf8Encoder.encode(normalized)
  }

  const digest = await crypto.subtle.digest("SHA-256", sourceBytes)
  return new Uint8Array(digest)
}

const importWrapKey = async (raw: string): Promise<CryptoKey> => {
  const keyMaterial = await deriveWrapKeyMaterial(raw)
  return crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  )
}

const encryptSecretKey = async (key: CryptoKey, secretKey: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plainBytes = utf8Encoder.encode(secretKey)
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plainBytes,
  )
  const cipherBytes = new Uint8Array(cipherBuffer)
  return `${bytesToBase64(iv)}.${bytesToBase64(cipherBytes)}`
}

const decryptSecretKey = async (key: CryptoKey, wrappedSecret: string): Promise<string> => {
  const [ivPart, cipherPart] = (wrappedSecret || "").split(".")
  if (!ivPart || !cipherPart) {
    throw new Error("invalid_wrapped_secret_key")
  }
  const iv = base64ToBytes(ivPart)
  const cipherBytes = base64ToBytes(cipherPart)
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipherBytes,
  )
  return utf8Decoder.decode(plainBuffer)
}

const looksLikeBase64Key = (value: string): boolean => {
  const normalized = (value || "").trim()
  if (!normalized) return false
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) return false
  try {
    const bytes = base64ToBytes(normalized)
    return bytes.length === 32
  } catch {
    return false
  }
}

const getBearerToken = (req: Request): string => {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || ""
  if (!auth.toLowerCase().startsWith("bearer ")) return ""
  return auth.slice(7).trim()
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  const wrapKeyRaw = Deno.env.get("E2EE_BACKUP_WRAP_KEY") || ""

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, reason: "service_env_missing" }, 500)
  }

  if (!wrapKeyRaw.trim()) {
    return jsonResponse({ success: false, skipped: true, reason: "wrap_key_missing" }, 200)
  }

  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : ""
  if (action !== "backup" && action !== "restore") {
    return jsonResponse({ success: false, reason: "invalid_action" }, 400)
  }

  const token = getBearerToken(req)
  if (!token) {
    return jsonResponse({ success: false, reason: "missing_bearer_token" }, 401)
  }

  const service = createClient(supabaseUrl, serviceRoleKey)
  const { data: authData, error: authError } = await service.auth.getUser(token)
  if (authError || !authData?.user?.id) {
    return jsonResponse({ success: false, reason: "invalid_or_expired_token" }, 401)
  }

  const userId = authData.user.id
  const wrapKey = await importWrapKey(wrapKeyRaw)

  if (action === "backup") {
    const publicKey = typeof body?.publicKey === "string" ? body.publicKey.trim() : ""
    const secretKey = typeof body?.secretKey === "string" ? body.secretKey.trim() : ""

    if (!looksLikeBase64Key(publicKey) || !looksLikeBase64Key(secretKey)) {
      return jsonResponse({ success: false, reason: "invalid_key_payload" }, 400)
    }

    try {
      const wrappedSecret = await encryptSecretKey(wrapKey, secretKey)
      const { error } = await service
        .from("chat_e2ee_key_backups")
        .upsert(
          {
            user_id: userId,
            public_key: publicKey,
            wrapped_secret_key: wrappedSecret,
            wrap_alg: "aes-gcm-v1",
          },
          { onConflict: "user_id" },
        )

      if (error) {
        return jsonResponse({ success: false, reason: "backup_upsert_failed", error: clip(error.message || "", 180) }, 500)
      }

      return jsonResponse({ success: true, skipped: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : "backup_encrypt_failed"
      return jsonResponse({ success: false, reason: "backup_encrypt_failed", error: clip(message, 180) }, 500)
    }
  }

  const { data: row, error: selectError } = await service
    .from("chat_e2ee_key_backups")
    .select("public_key, wrapped_secret_key")
    .eq("user_id", userId)
    .maybeSingle()

  if (selectError) {
    return jsonResponse({ success: false, reason: "backup_select_failed", error: clip(selectError.message || "", 180) }, 500)
  }

  if (!row?.public_key || !row?.wrapped_secret_key) {
    return jsonResponse({ success: false, reason: "backup_not_found" }, 200)
  }

  try {
    const secretKey = await decryptSecretKey(wrapKey, row.wrapped_secret_key)
    if (!looksLikeBase64Key(row.public_key) || !looksLikeBase64Key(secretKey)) {
      return jsonResponse({ success: false, reason: "backup_payload_invalid" }, 200)
    }

    return jsonResponse({
      success: true,
      skipped: false,
      data: {
        publicKey: row.public_key,
        secretKey,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "backup_decrypt_failed"
    return jsonResponse({ success: false, reason: "backup_decrypt_failed", error: clip(message, 180) }, 500)
  }
})


