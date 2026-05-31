// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_OPENAI_MODEL = "gpt-5.4";
const DEFAULT_OPENAI_FALLBACK_MODEL = "gpt-4.1";

const clipText = (value: string, maxLength: number): string => {
  const text = (value || "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};

const getOpenAIModelCandidates = (): string[] => {
  const primary = (Deno.env.get("PRESCRIPTION_PARSE_OPENAI_MODEL") || Deno.env.get("OPENAI_MODEL") || "").trim();
  const fallback = (
    Deno.env.get("PRESCRIPTION_PARSE_OPENAI_MODEL_FALLBACK") ||
    Deno.env.get("OPENAI_MODEL_FALLBACK") ||
    ""
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const deduped = [primary || DEFAULT_OPENAI_MODEL, ...fallback, DEFAULT_OPENAI_FALLBACK_MODEL].filter(
    (model, index, arr) => model && arr.indexOf(model) === index
  );
  return deduped.length ? deduped : [DEFAULT_OPENAI_MODEL];
};

const createServiceClient = () => {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) {
    throw new Error("Supabase service role is not configured.");
  }
  return createClient(url, key);
};

const parseJsonSafely = (raw: string): any => {
  const text = (raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
};

const normalizeFrequency = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (lowered === "od") return "once daily";
  if (lowered === "bd") return "twice daily";
  if (lowered === "tds") return "three times daily";
  if (lowered === "sos") return "as needed";
  return text;
};

const normalizeMedicineName = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.toLowerCase() === "pcm") return "Paracetamol";
  return text;
};

const normalizeMedicineRow = (value: any) => {
  if (!value || typeof value !== "object") return null;
  return {
    medicine_name: normalizeMedicineName(value.medicine_name ?? value.medicine ?? value.name),
    dosage: typeof value.dosage === "string" && value.dosage.trim() ? value.dosage.trim() : null,
    frequency: normalizeFrequency(value.frequency),
    duration: typeof value.duration === "string" && value.duration.trim() ? value.duration.trim() : null,
    instructions:
      typeof value.instructions === "string" && value.instructions.trim() ? value.instructions.trim() : null,
  };
};

const normalizeOutput = (value: any) => {
  const rows = Array.isArray(value?.medicines) ? value.medicines : [];
  const medicines = rows
    .map(normalizeMedicineRow)
    .filter((row: any) => row && row.medicine_name);
  return { medicines };
};

const buildParserPrompt = (doctorText: string): string => {
  return `You are a clinical prescription parser.

Your job is to convert doctor's spoken prescription text into structured JSON.

STRICT RULES:
- Output ONLY valid JSON (no explanation, no extra text)
- Do NOT assume missing data unless very obvious
- Normalize medical abbreviations:
  - OD = once daily
  - BD = twice daily
  - TDS = three times daily
  - SOS = as needed
- Understand Hindi/Hinglish prescription words and normalize:
  - subah = morning
  - dopahar = afternoon
  - shaam = evening
  - raat = night
  - khane ke baad = after food
  - khane se pehle = before food
  - bukhar = fever
  - jab zarurat ho = as needed
  - din me ek baar = once daily
  - din me do baar = twice daily
  - din me teen baar = three times daily
- Convert common short forms:
  - PCM = Paracetamol
- Keep dosage exactly as spoken (e.g., 650 mg, 500 mg)
- Extract duration clearly (e.g., 3 days, 5 days)
- Extract instructions if present (e.g., after food, before sleep)
- If multiple medicines are present, return an array
- If something is missing, return null for that field
- Correct minor speech recognition errors intelligently (e.g., "paracitamol" -> "Paracetamol")

OUTPUT FORMAT:
{
  "medicines": [
    {
      "medicine_name": "",
      "dosage": "",
      "frequency": "",
      "duration": "",
      "instructions": ""
    }
  ]
}

Now parse the following input:

INPUT:
${doctorText}`;
};

const invokeOpenAI = async (args: { apiKey: string; prompt: string }) => {
  const models = getOpenAIModelCandidates();
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${args.apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: args.prompt }],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || `OpenAI parse failed (${response.status})`);
      }

      const content = data?.choices?.[0]?.message?.content;
      const reply =
        typeof content === "string"
          ? content.trim()
          : Array.isArray(content)
            ? content.map((item: any) => (typeof item?.text === "string" ? item.text.trim() : "")).find(Boolean) || ""
            : "";
      if (!reply) {
        throw new Error("OpenAI returned empty parser output.");
      }
      return { reply, model };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || "Prescription parsing failed.");
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.replace("Bearer ", "").trim();
    if (!accessToken) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createServiceClient();
    const {
      data: { user },
      error: userError,
    } = await serviceClient.auth.getUser(accessToken);
    if (userError || !user?.id) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const doctorText = clipText(typeof body?.doctorText === "string" ? body.doctorText : "", 12000);
    if (!doctorText) {
      throw new Error("doctorText is required.");
    }

    const openAiApiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
    if (!openAiApiKey) {
      throw new Error("OPENAI_API_KEY is required on Edge runtime.");
    }

    const prompt = buildParserPrompt(doctorText);
    const parsedResult = await invokeOpenAI({ apiKey: openAiApiKey, prompt });
    const parsedJson = parseJsonSafely(parsedResult.reply);
    const normalized = normalizeOutput(parsedJson || {});

    return new Response(
      JSON.stringify({
        success: true,
        data: normalized,
        source: "openai",
        model: parsedResult.model,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        message: error?.message || "Failed to parse doctor prescription text.",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
