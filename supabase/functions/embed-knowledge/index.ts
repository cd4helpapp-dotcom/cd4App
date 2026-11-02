// @ts-nocheck
// Creates embeddings for the knowledge scripts, so they can run without an OpenAI key on the developer's machine.
// Only the service key may call this. The app never does.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ success: false, message: "POST required" }, 405)

  // The Supabase gateway has already checked this token's signature (verify_jwt is on), so its role can be trusted.
  // Comparing it to the key in this function's environment fails, because the two can be different valid forms of the key.
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim()
  let role = ""
  try {
    role = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role || ""
  } catch {
    role = ""
  }
  if (role !== "service_role") return json({ success: false, message: "Service key required" }, 403)

  const body = await request.json().catch(() => ({}))
  const texts = Array.isArray(body?.texts) ? body.texts.map((text: unknown) => String(text || "").slice(0, 8000)) : []
  if (!texts.length || texts.length > 64) return json({ success: false, message: "Send 1 to 64 texts" }, 400)

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY") || ""}` },
    body: JSON.stringify({ model: (Deno.env.get("RAG_EMBEDDING_MODEL") || "").trim() || "text-embedding-3-small", input: texts }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) return json({ success: false, message: payload?.error?.message || `Embedding failed: ${response.status}` }, 502)
  return json({ success: true, embeddings: payload.data.map((row: any) => row.embedding) })
})
