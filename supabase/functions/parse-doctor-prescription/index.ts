// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_FALLBACK_MODEL = "gpt-4o";

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
    dictionary_id: typeof value.dictionary_id === "string" ? value.dictionary_id : null,
    confidence_score: typeof value.confidence_score === "number" ? value.confidence_score : null,
    match_type: typeof value.match_type === "string" ? value.match_type : "ai_only",
    doctor_confirmation_required: Boolean(value.doctor_confirmation_required),
  };
};

const normalizeLookupText = (value: unknown): string =>
  String(value || "")
    .toLowerCase()
    .replace(/\b(?:tablet|tab|capsule|cap|syrup|syp|injection|inj|cream|ointment|drops?)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|gm|%)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const levenshtein = (left: string, right: string): number => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j += 1) {
      current.push(Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + (left[i] === right[j] ? 0 : 1),
      ));
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
  }
  return previous[right.length];
};

const matchScore = (spoken: string, candidate: string): number => {
  if (!spoken || !candidate) return 0;
  if (spoken === candidate) return 1;
  const distance = levenshtein(spoken, candidate);
  return Math.max(0, 1 - distance / Math.max(spoken.length, candidate.length));
};

const extractSpokenStrength = (medicine: any): { value: number; unit: string } | null => {
  const source = `${medicine?.medicine_name || ""} ${medicine?.dosage || ""}`;
  const match = source.match(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|ml|g|gm|%)\b/i)
    || source.match(/\b(\d{2,5})\b/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 1 || value > 100000) return null;
  return { value, unit: String(match[2] || "").toLowerCase() };
};

const enrichWithVerifiedDictionary = async (serviceClient: any, medicines: any[]) => {
    if (!medicines.length) return medicines;
  const { data: dictionaryRows, error } = await serviceClient
    .from("medicine_dictionary")
    .select("id, generic_name, brand_name, aliases, speech_variants, strength_value, strength_unit, dosage_form")
    .eq("active", true)
    .eq("verification_status", "verified")
    .limit(2000);
  if (error || !Array.isArray(dictionaryRows) || !dictionaryRows.length) {
    return medicines.map((medicine: any) => ({
      ...medicine,
      match_type: "ai_only",
      doctor_confirmation_required: true,
    }));
  }

  return medicines.map((medicine: any) => {
    const spokenKey = normalizeLookupText(medicine.medicine_name);
    if (!spokenKey) return medicine;
    let best: any = null;
    let bestScore = 0;
    const spokenStrength = extractSpokenStrength(medicine);
    for (const row of dictionaryRows) {
      if (spokenStrength && row.strength_value) {
        const rowUnit = String(row.strength_unit || "").toLowerCase();
        const unitCompatible = !spokenStrength.unit || !rowUnit || spokenStrength.unit === rowUnit;
        // A strength unit mismatch is never safe to ignore (650 mg is not
        // 650 mcg). Only compare rows with both compatible unit and value.
        if (!unitCompatible || Number(row.strength_value) !== spokenStrength.value) continue;
      }
      const candidates = [
        { value: row.generic_name, kind: "exact" },
        { value: row.brand_name, kind: "exact" },
        ...(Array.isArray(row.aliases) ? row.aliases : []).map((value: string) => ({ value, kind: "alias" })),
        ...(Array.isArray(row.speech_variants) ? row.speech_variants : []).map((value: string) => ({ value, kind: "speech_variant" })),
      ]
        .map((candidate) => ({ ...candidate, normalized: normalizeLookupText(candidate.value) }))
        .filter((candidate) => candidate.normalized);
      for (const candidate of candidates) {
        const score = matchScore(spokenKey, candidate.normalized);
        if (score > bestScore) {
          bestScore = score;
          best = { row, kind: candidate.kind };
        }
      }
    }
    if (!best || bestScore < 0.88) {
      return { ...medicine, match_type: "ai_only", doctor_confirmation_required: true };
    }

    const dictionaryRow = best.row;
    // Speech variants are intentionally never accepted as exact matches. They
    // are only hints for likely dictation mistakes and require doctor review.
    const exact = bestScore === 1 && best.kind !== "speech_variant";
    const dictionaryName = [dictionaryRow.generic_name, dictionaryRow.brand_name ? `(${dictionaryRow.brand_name})` : ""]
      .filter(Boolean)
      .join(" ");
    const dictionaryDose = dictionaryRow.strength_value && dictionaryRow.strength_unit
      ? `${dictionaryRow.strength_value} ${dictionaryRow.strength_unit}`
      : null;
    return {
      ...medicine,
      medicine_name: exact ? dictionaryName : medicine.medicine_name,
      dosage: medicine.dosage || dictionaryDose,
      dictionary_id: dictionaryRow.id,
      confidence_score: Number(bestScore.toFixed(3)),
      match_type: exact ? (best.kind === "alias" ? "alias" : "exact") : "fuzzy",
      doctor_confirmation_required: !exact,
    };
  });
};

const normalizeOutput = (value: any) => {
  const rows = Array.isArray(value?.medicines) ? value.medicines : [];
  const medicines = rows
    .map(normalizeMedicineRow)
    .filter((row: any) => row && row.medicine_name);
  const summary = value?.clinical_summary && typeof value.clinical_summary === "object" ? value.clinical_summary : {};
  const list = (input: unknown, max = 6): string[] => {
    const values = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\n;|]/g) : [];
    return values.map((item) => String(item || "").trim()).filter(Boolean).filter((item, index, all) => all.indexOf(item) === index).slice(0, max);
  };
  return {
    medicines,
    clinical_summary: {
      concern: typeof summary.concern === "string" ? summary.concern.trim() : "",
      chief_complaints: list(summary.chief_complaints, 4),
      history_summary: list(summary.history_summary, 4),
      examination: list(summary.examination, 4),
      diagnosis: typeof summary.diagnosis === "string" ? summary.diagnosis.trim() : "",
      general_advice: list(summary.general_advice, 4),
      precautions: list(summary.precautions, 4),
      follow_up: list(summary.follow_up, 3),
      red_flags: list(summary.red_flags, 3),
    },
  };
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
  ],
  "clinical_summary": {
    "concern": "",
    "chief_complaints": [],
    "history_summary": [],
    "examination": [],
    "diagnosis": "",
    "general_advice": [],
    "precautions": [],
    "follow_up": [],
    "red_flags": []
  }
}

CLINICAL SUMMARY RULES:
- Capture every clinically relevant fact the doctor dictated, even when it is in the same sentence as a medicine or booking instruction.
- Use only information spoken by the doctor; never invent a diagnosis, dose, or symptom.
- Keep the arrays concise, deduplicated, and section-specific. Put unmatched clinical text in the closest appropriate section rather than dropping it.

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
    normalized.medicines = await enrichWithVerifiedDictionary(serviceClient, normalized.medicines);

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
