import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ success: false, message: "Method not allowed" }, 405)

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    const authHeader = req.headers.get("authorization") || ""
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim()
    if (!supabaseUrl || !serviceRoleKey || !accessToken) {
      return jsonResponse({ success: false, message: "Authentication required" }, 401)
    }

    const service = createClient(supabaseUrl, serviceRoleKey)
    const { data: authData, error: authError } = await service.auth.getUser(accessToken)
    const userId = authData?.user?.id
    if (authError || !userId) return jsonResponse({ success: false, message: "Authentication required" }, 401)

    // Storage objects are not removed by a database/auth cascade, so clean the
    // user's report and profile media before deleting the Auth user.
    const storageTargets = [
      { bucket: "medical-reports", prefix: userId },
      { bucket: "cd4-storage", prefix: `profile-pictures/${userId}` },
    ]
    for (const target of storageTargets) {
      const { data: objects } = await service.storage.from(target.bucket).list(target.prefix, { limit: 1000 })
      const paths = (objects || []).map((object) => `${target.prefix}/${object.name}`)
      if (paths.length > 0) await service.storage.from(target.bucket).remove(paths)
    }

    // This table intentionally uses ON DELETE SET NULL for support audit
    // history, so remove the user's support messages explicitly as part of
    // their deletion request.
    await service.from("support_tickets").delete().eq("user_id", userId)

    const { error: deleteError } = await service.auth.admin.deleteUser(userId)
    if (deleteError) {
      console.error("[delete-account] auth delete failed:", deleteError.message)
      return jsonResponse({ success: false, message: "Could not delete the account right now." }, 500)
    }

    return jsonResponse({ success: true })
  } catch (error: any) {
    console.error("[delete-account] unexpected error:", error?.message || error)
    return jsonResponse({ success: false, message: "Could not delete the account right now." }, 500)
  }
})
