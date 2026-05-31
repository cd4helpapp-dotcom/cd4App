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

const normalizeEmail = (value: unknown): string => {
  if (typeof value !== "string") return ""
  return value.trim().toLowerCase()
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ success: false, reason: "service_env_missing" }, 500)
    }

    const body = await req.json().catch(() => ({}))
    const email = normalizeEmail(body?.email)
    if (!email || !/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/.test(email)) {
      return jsonResponse({ success: false, reason: "invalid_email" }, 400)
    }

    const service = createClient(supabaseUrl, serviceRoleKey)
    const { data, error } = await service
      .from("profiles")
      .select("id, roles:role_id(slug)")
      .eq("email", email)
      .limit(1)
      .maybeSingle()

    if (error) {
      return jsonResponse({ success: false, reason: "profile_lookup_failed" }, 500)
    }

    const roleSource = Array.isArray((data as any)?.roles)
      ? (data as any).roles[0]
      : (data as any)?.roles
    const role = typeof roleSource?.slug === "string" ? roleSource.slug : null

    return jsonResponse({
      success: true,
      exists: Boolean(data?.id),
      role,
    })
  } catch {
    return jsonResponse({ success: false, reason: "function_exception" }, 500)
  }
})
