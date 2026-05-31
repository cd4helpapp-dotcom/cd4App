import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (payload: Record<string, unknown>, status: number = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const createServiceClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return createClient(supabaseUrl, serviceRoleKey);
};

const extractBearerToken = (req: Request): string => {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
};

const isLikelyExpoToken = (value: string): boolean =>
  value.startsWith("ExponentPushToken[") || value.startsWith("ExpoPushToken[");

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

    const body = await req.json().catch(() => null);
    const rawToken = typeof body?.token === "string" ? body.token.trim() : "";
    const shouldClear = !rawToken;

    if (!shouldClear && !isLikelyExpoToken(rawToken)) {
      return jsonResponse({ success: false, message: "invalid_push_token_format" }, 400);
    }

    if (shouldClear) {
      const { error } = await serviceClient
        .from("profiles")
        .update({ push_token: null })
        .eq("id", userId);

      if (error) {
        return jsonResponse({ success: false, message: `clear_failed:${error.message}` }, 400);
      }

      return jsonResponse({ success: true, cleared: true });
    }

    // Ensure one device token maps to one logged-in user at a time.
    const { error: clearOthersError } = await serviceClient
      .from("profiles")
      .update({ push_token: null })
      .eq("push_token", rawToken)
      .neq("id", userId);

    if (clearOthersError) {
      return jsonResponse({ success: false, message: `clear_others_failed:${clearOthersError.message}` }, 400);
    }

    const { error: bindError } = await serviceClient
      .from("profiles")
      .update({ push_token: rawToken })
      .eq("id", userId);

    if (bindError) {
      return jsonResponse({ success: false, message: `bind_failed:${bindError.message}` }, 400);
    }

    return jsonResponse({ success: true, cleared: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "register_push_token_unknown_error";
    return jsonResponse({ success: false, message }, 400);
  }
});


