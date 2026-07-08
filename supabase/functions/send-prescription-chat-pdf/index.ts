// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_FALLBACK_MODEL = "gpt-4o";
const APP_BRAND_NAME = "CD4";
const APP_EMAIL_DOMAIN = "cd4.app";
const APP_EMAIL_FROM = `${APP_BRAND_NAME} <no-reply@${APP_EMAIL_DOMAIN}>`;
const APP_TELECONSULTATION_LABEL = `${APP_BRAND_NAME} Teleconsultation`;

const clipText = (value: string, maxLength: number): string => {
  const text = (value || "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};

const sanitizePdfText = (value: unknown): string =>
  String(value || "")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const createServiceClient = () => {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createClient(url, key);
};

const isPushEnabledFromSettings = (settings: unknown): boolean => {
  if (!settings || typeof settings !== "object") return true;
  const notifications = (settings as any).notifications;
  if (!notifications || typeof notifications !== "object") return true;
  const push = (notifications as any).push;
  if (typeof push === "boolean") return push;
  return true;
};

const getExpoPushTicketErrors = (payload: any): any[] => {
  const tickets = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
  const ticketErrors = tickets.filter((ticket: any) => ticket?.status === "error");
  const requestErrors = Array.isArray(payload?.errors) ? payload.errors : [];
  return [...ticketErrors, ...requestErrors];
};

const sendExpoPush = async (message: Record<string, unknown>) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: controller.signal,
    });
    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    const ticketErrors = getExpoPushTicketErrors(payload);
    return { ok: res.ok && ticketErrors.length === 0, status: res.status, payload, ticketErrors };
  } finally {
    clearTimeout(timeoutId);
  }
};

const sendPrescriptionEmail = async (args: {
  toEmail: string;
  patientName: string;
  doctorName: string;
  consultationId: string;
}): Promise<{ sent: boolean; reason?: string }> => {
  const resendApiKey = (Deno.env.get("RESEND_API_KEY") || "").trim();
  const emailFrom = (Deno.env.get("EMAIL_FROM") || APP_EMAIL_FROM).trim();
  if (!resendApiKey) return { sent: false, reason: "resend_api_key_missing" };
  if (!args.toEmail) return { sent: false, reason: "patient_email_missing" };

  const subject = `New Prescription Received - ${APP_BRAND_NAME}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#16313a">
      <h2 style="margin:0 0 10px 0;color:#0c7a61">Prescription Shared</h2>
      <p>Hi ${sanitizePdfText(args.patientName || "Patient")},</p>
      <p>Your doctor <strong>${sanitizePdfText(args.doctorName)}</strong> has shared a new prescription on ${APP_BRAND_NAME}.</p>
      <p><strong>Consultation ID:</strong> ${sanitizePdfText(args.consultationId)}</p>
      <p>Please open the ${APP_BRAND_NAME} app chat to view/download your prescription PDF.</p>
      <p style="margin-top:20px;color:#4f6268">Team ${APP_BRAND_NAME}</p>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [args.toEmail],
        subject,
        html,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { sent: false, reason: clipText(body || `email_send_failed_${response.status}`, 120) };
    }
    return { sent: true };
  } catch (error: any) {
    return { sent: false, reason: clipText(error?.message || "email_send_exception", 120) };
  }
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
  const models = [primary || DEFAULT_OPENAI_MODEL, ...fallback, DEFAULT_OPENAI_FALLBACK_MODEL].filter(
    (model, index, list) => model && list.indexOf(model) === index
  );
  return models.length ? models : [DEFAULT_OPENAI_MODEL];
};

const buildParserPrompt = (doctorText: string): string => `You are a clinical prescription parser.

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
- Support medicine speech typos in Hindi accent (example: paracitamol/parasetmol -> Paracetamol)
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
    "chief_complaints": ["", ""],
    "history_summary": ["", ""],
    "examination": ["", ""],
    "diagnosis": "",
    "general_advice": ["", ""],
    "precautions": ["", ""],
    "follow_up": ["", ""],
    "red_flags": ["", ""]
  }
}

Now parse the following input:
INPUT:
${doctorText}`;

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

type PrescriptionMedicineRow = {
  medicine_name: string | null;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
};

const normalizeMedicines = (rows: unknown): PrescriptionMedicineRow[] => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((value: any) => ({
      medicine_name: normalizeMedicineName(value?.medicine_name ?? value?.name ?? value?.medicine),
      dosage: typeof value?.dosage === "string" && value.dosage.trim() ? value.dosage.trim() : null,
      frequency: normalizeFrequency(value?.frequency),
      duration: typeof value?.duration === "string" && value.duration.trim() ? value.duration.trim() : null,
      instructions: typeof value?.instructions === "string" && value.instructions.trim() ? value.instructions.trim() : null,
    }))
    .filter((row) => row.medicine_name);
};

const dedupeMedicines = (rows: PrescriptionMedicineRow[], maxRows = 8): PrescriptionMedicineRow[] => {
  const out: PrescriptionMedicineRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = String(row?.medicine_name || "").trim();
    if (!name) continue;
    const dosage = String(row?.dosage || "").trim().toLowerCase();
    const key = `${name.toLowerCase()}|${dosage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      medicine_name: normalizeMedicineName(name),
      dosage: row?.dosage || null,
      frequency: normalizeFrequency(row?.frequency) || null,
      duration: row?.duration || null,
      instructions: row?.instructions || null,
    });
    if (out.length >= maxRows) break;
  }
  return out;
};

const normalizeTextList = (value: unknown, maxItems = 5): string[] => {
  const base = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n|[;|]/g)
      : [];
  return dedupeLines(
    base
      .map((item) => (typeof item === "string" ? item : ""))
      .map((item) => item.trim())
      .filter(Boolean),
    maxItems
  );
};

const stripMedicineNoise = (value: string): string => {
  return value
    .replace(
      /\b(tab(?:let)?|cap(?:sule)?|syrup|syp|drop|ointment|cream|inj(?:ection)?|tablet|capsule|medicine|medication|rx)\b/gi,
      " "
    )
    .replace(
      /\b(take|start|continue|use|prescribe|give|add|stop|lena|leni|leni hai|dena|dene|khana|khaye)\b/gi,
      " "
    )
    .replace(/\b\d+\s?(mg|ml|mcg|g|gm)\b/gi, " ")
    .replace(
      /\b(od|bd|tds|sos|once daily|twice daily|three times daily|as needed|morning|afternoon|evening|night|subah|dopahar|shaam|raat)\b/gi,
      " "
    )
    .replace(/\b(after food|before food|after meals|before meals|khane ke baad|khane se pehle)\b/gi, " ")
    .replace(/\b\d+\s?(day|days|week|weeks|month|months)\b/gi, " ")
    .replace(/[,:()\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const pickMedicineNameFromLine = (line: string): string => {
  const prefixStripped = line.replace(
    /^(?:please\s+)?(?:take|start|continue|use|prescribe|give|add)\s+/i,
    ""
  );
  const tillDelimiter = prefixStripped
    .split(
      /\b(for|after|before|at|subah|dopahar|shaam|raat|morning|afternoon|evening|night|od|bd|tds|sos|once|twice|three)\b/i
    )[0]
    .trim();

  const cleanedPrimary = stripMedicineNoise(tillDelimiter);
  if (cleanedPrimary) return cleanedPrimary;

  const cleanedWhole = stripMedicineNoise(prefixStripped);
  if (cleanedWhole) return cleanedWhole;

  return stripMedicineNoise(line);
};

const inferMedicinesFromVoiceText = (doctorText: string): PrescriptionMedicineRow[] => {
  const lines = splitVoiceLines(doctorText);
  const medicineHintRegex =
    /(tab(?:let)?|cap(?:sule)?|syrup|syp|drop|ointment|cream|inhaler|inj(?:ection)?|mg|ml|mcg|\b\d{2,4}\b|od|bd|tds|sos|after food|before food|khane ke baad|khane se pehle|once daily|twice daily|three times daily)/i;
  const medicineActionRegex = /\b(take|start|continue|use|prescribe|give|add|lena|khana|medicine)\b/i;

  const mapped: PrescriptionMedicineRow[] = lines
    .filter((line) => medicineHintRegex.test(line) || medicineActionRegex.test(line))
    .map((line) => {
      const cleaned = line.replace(/\b(tab(?:let)?|cap(?:sule)?|syrup|syp|drop|ointment|cream|inj(?:ection)?)\b/gi, "").trim();
      const dosageMatch = line.match(/\b\d+\s?(mg|ml|mcg|g|gm)\b/i);
      const durationMatch = line.match(/\b\d+\s?(day|days|week|weeks|month|months)\b/i);
      const frequencyMatch =
        line.match(/\b(od|bd|tds|sos)\b/i)?.[1] ||
        line.match(/\b(once daily|twice daily|three times daily|as needed)\b/i)?.[1] ||
        "";
      const instructionMatch =
        line.match(/\b(after food|before food|at night|morning|afternoon|evening|subah|dopahar|shaam|raat)\b/gi)?.join(", ") ||
        "";
      const nameCandidate = pickMedicineNameFromLine(cleaned || line);

      return {
        medicine_name: normalizeMedicineName(nameCandidate || cleaned || line),
        dosage: dosageMatch ? dosageMatch[0] : null,
        frequency: normalizeFrequency(frequencyMatch || null),
        duration: durationMatch ? durationMatch[0] : null,
        instructions: instructionMatch ? instructionMatch : null,
      };
    });

  return dedupeMedicines(mapped, 8);
};

const normalizeNarrativeFromParsed = (parsed: any): Partial<PrescriptionNarrative> => {
  const summary = parsed?.clinical_summary && typeof parsed.clinical_summary === "object"
    ? parsed.clinical_summary
    : parsed?.narrative && typeof parsed.narrative === "object"
      ? parsed.narrative
      : {};

  return {
    concern: typeof summary?.concern === "string" ? clipText(summary.concern, 120) : "",
    chiefComplaints: normalizeTextList(summary?.chief_complaints ?? summary?.chiefComplaints, 4),
    historySummary: normalizeTextList(summary?.history_summary ?? summary?.historySummary, 4),
    examination: normalizeTextList(summary?.examination, 3),
    diagnosis: typeof summary?.diagnosis === "string" ? clipText(summary.diagnosis, 90) : "",
    generalAdvice: normalizeTextList(summary?.general_advice ?? summary?.generalAdvice, 4),
    precautions: normalizeTextList(summary?.precautions, 4),
    followUp: normalizeTextList(summary?.follow_up ?? summary?.followUp, 2),
    redFlags: normalizeTextList(summary?.red_flags ?? summary?.redFlags, 3),
  };
};

type PrescriptionNarrative = {
  concern: string;
  chiefComplaints: string[];
  historySummary: string[];
  pastHistory: string[];
  examination: string[];
  diagnosis: string;
  generalAdvice: string[];
  precautions: string[];
  followUp: string[];
  redFlags: string[];
};

const splitVoiceLines = (voiceText: string): string[] =>
  String(voiceText || "")
    .replace(/\r/g, "\n")
    .split(/\n|[.?!]/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 2);

const dedupeLines = (items: string[], maxItems = 6): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const line = clipText(raw.replace(/\s+/g, " ").trim(), 120);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= maxItems) break;
  }
  return out;
};

const extractDoctorVerbatimLines = (voiceText: string, maxItems = 12): string[] =>
  dedupeLines(splitVoiceLines(voiceText), maxItems);

const extractNarrativeFromVoice = (voiceText: string): PrescriptionNarrative => {
  const lines = splitVoiceLines(voiceText);
  const has = (line: string, pattern: RegExp) => pattern.test(line.toLowerCase());

  const complaints = dedupeLines(
    lines.filter((line) =>
      has(
        line,
        /(fever|bukhar|headache|pain|cough|cold|vomit|nausea|sore throat|fatigue|weakness|pet|stomach|acidity|chills)/i
      )
    ),
    4
  );
  const history = dedupeLines(
    lines.filter((line) => has(line, /(since|from last|days|duration|history|onset|progression)/i)),
    4
  );
  const exam = dedupeLines(
    lines.filter((line) => has(line, /(bp|pulse|temperature|exam|examination|oriented|breathing|oxygen|spo2)/i)),
    3
  );
  const precautions = dedupeLines(
    lines.filter((line) => has(line, /(avoid|mat|don't|dont|stay away|precaution|careful)/i)),
    4
  );
  const followUp = dedupeLines(
    lines.filter((line) => has(line, /(follow up|review|revisit|after \d+ day|dobara|wapis)/i)),
    2
  );
  const redFlags = dedupeLines(
    lines.filter((line) => has(line, /(severe|emergency|urgent|difficulty breathing|chest pain|persistent vomiting|high fever)/i)),
    4
  );
  const advice = dedupeLines(
    lines.filter((line) => has(line, /(rest|water|hydrate|sleep|diet|steam|light food|liquid|khana)/i)),
    4
  );
  const diagnosisLine =
    lines.find((line) => has(line, /(diagnosis|viral|infection|flu|allergy|gastritis|migraine|hypertension|diabetes)/i)) || "";
  const concernLine = complaints[0] || clipText(diagnosisLine, 90);

  return {
    concern: clipText(concernLine, 120),
    chiefComplaints: complaints,
    historySummary: history,
    pastHistory: [],
    examination: exam,
    diagnosis: clipText(diagnosisLine, 90),
    generalAdvice: advice,
    precautions,
    followUp,
    redFlags,
  };
};

const invokeOpenAIParser = async (apiKey: string, prompt: string) => {
  const models = getOpenAIModelCandidates();
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || `OpenAI parse failed (${response.status})`);

      const content = data?.choices?.[0]?.message?.content;
      const reply =
        typeof content === "string"
          ? content.trim()
          : Array.isArray(content)
            ? content.map((item: any) => (typeof item?.text === "string" ? item.text.trim() : "")).find(Boolean) || ""
            : "";
      if (!reply) throw new Error("OpenAI returned empty parser output.");
      return { reply, model };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || "Prescription parsing failed.");
};

const buildPrescriptionPdfBytes = async (args: {
  doctorName: string;
  patientName: string;
  consultationId: string;
  voiceText: string;
  medicines: Array<{
    medicine_name: string | null;
    dosage: string | null;
    frequency: string | null;
    duration: string | null;
    instructions: string | null;
  }>;
  narrative: PrescriptionNarrative;
  doctorVerbatimLines: string[];
}) => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const drawTextOnPage = (
    targetPage: any,
    text: string,
    x: number,
    y: number,
    size = 10,
    useBold = false,
    color = rgb(0.1, 0.1, 0.1)
  ) => {
    targetPage.drawText(sanitizePdfText(text), { x, y, size, font: useBold ? bold : font, color });
  };
  const drawText = (text: string, x: number, y: number, size = 10, useBold = false, color = rgb(0.1, 0.1, 0.1)) =>
    drawTextOnPage(page, text, x, y, size, useBold, color);

  const green = rgb(0.04, 0.47, 0.37);
  const lightGreen = rgb(0.92, 0.97, 0.95);
  const border = rgb(0.86, 0.9, 0.9);
  const dark = rgb(0.12, 0.16, 0.18);
  const muted = rgb(0.35, 0.42, 0.45);
  const white = rgb(1, 1, 1);

  const drawBox = (x: number, y: number, w: number, h: number, fill = white, stroke = border) => {
    page.drawRectangle({ x, y, width: w, height: h, color: fill, borderColor: stroke, borderWidth: 1 });
  };

  const wrap = (value: string, maxWidth: number, textSize = 9, useBold = false): string[] => {
    const words = sanitizePdfText(value).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      const width = (useBold ? bold : font).widthOfTextAtSize(next, textSize);
      if (width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  };
  const fitText = (value: string, maxWidth: number, size = 9, useBold = false): string => {
    const clean = sanitizePdfText(value || "");
    if (!clean) return "";
    const activeFont = useBold ? bold : font;
    if (activeFont.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
    let out = clean;
    while (out.length > 2 && activeFont.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}...`;
  };
  const drawBullets = (
    x: number,
    y: number,
    width: number,
    items: string[],
    maxItems = 4,
    size = 9,
    color = dark
  ) => {
    let cursor = y;
    const rows = items.length > 0 ? items.slice(0, maxItems) : ["Not clearly mentioned"];
    for (const item of rows) {
      const wrapped = wrap(item, width - 10, size, false).slice(0, 2);
      drawText(`• ${wrapped[0] || "Not clearly mentioned"}`, x, cursor, size, false, color);
      cursor -= 14;
      if (wrapped[1]) {
        drawText(`  ${wrapped[1]}`, x, cursor, size, false, color);
        cursor -= 14;
      }
      if (cursor < 540) break;
    }
  };

  // Header
  drawText(APP_BRAND_NAME, 34, 807, 24, true, green);
  drawText("Teleconsultation", 34, 792, 11, false, dark);
  page.drawRectangle({ x: 212, y: 790, width: 170, height: 28, color: green });
  drawText("PRESCRIPTION", 255, 799, 13, true, white);
  drawText(`Date: ${new Date().toLocaleDateString("en-IN")}`, 410, 807, 10, false, dark);
  drawText(`Time: ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`, 410, 793, 10, false, dark);
  drawText(`Consultation ID: ${args.consultationId}`, 410, 779, 10, false, dark);

  // Doctor + Patient card
  drawBox(28, 675, 539, 104, white, border);
  drawText("DOCTOR DETAILS", 40, 760, 11, true, green);
  drawText(args.doctorName, 40, 742, 14, true, dark);
  drawText("Consultant Physician", 40, 726, 10, false, dark);
  drawText(APP_TELECONSULTATION_LABEL, 40, 712, 10, false, muted);

  drawText("PATIENT DETAILS", 290, 760, 11, true, green);
  drawText(`Name: ${args.patientName}`, 290, 742, 11, false, dark);
  drawText("Age / Gender: Not specified", 290, 726, 10, false, dark);
  drawText(`Patient ID: ${args.consultationId}`, 290, 712, 10, false, dark);

  // Complaints/history summary
  drawBox(28, 535, 539, 128, white, border);
  drawText("CHIEF COMPLAINTS", 40, 645, 11, true, green);
  drawBullets(40, 627, 165, args.narrative.chiefComplaints, 4, 9, dark);
  drawText("HISTORY (SUMMARY)", 230, 645, 11, true, green);
  drawBullets(230, 627, 175, args.narrative.historySummary, 4, 9, dark);
  drawText("EXAMINATION", 430, 645, 11, true, green);
  drawBullets(430, 627, 128, args.narrative.examination, 3, 9, dark);
  if (args.narrative.concern) {
    drawText(`Concern: ${fitText(args.narrative.concern, 500, 9)}`, 40, 560, 9, true, dark);
  }
  if (args.narrative.diagnosis) {
    drawText(`Diagnosis: ${fitText(args.narrative.diagnosis, 500, 9)}`, 40, 546, 9, true, dark);
  }

  // Medication table block
  drawText("MEDICATIONS", 28, 515, 12, true, green);
  drawBox(28, 350, 539, 156, white, border);
  page.drawRectangle({ x: 29, y: 485, width: 537, height: 20, color: green });
  drawText("Sr.", 36, 491, 9, true, white);
  drawText("Medicine", 72, 491, 9, true, white);
  drawText("Dose", 255, 491, 9, true, white);
  drawText("Frequency", 320, 491, 9, true, white);
  drawText("Duration", 398, 491, 9, true, white);
  drawText("Timing / Instructions", 464, 491, 9, true, white);

  let rowY = 468;
  const meds = args.medicines.slice(0, 6);
  const totalRows = Math.max(1, meds.length);
  for (let idx = 0; idx < totalRows; idx += 1) {
    const med = meds[idx] || null;
    if (idx % 2 === 0) {
      page.drawRectangle({ x: 29, y: rowY - 13, width: 537, height: 22, color: rgb(0.98, 0.99, 0.99) });
    }
    drawText(String(idx + 1), 36, rowY, 9, false, dark);
    drawText(fitText(med?.medicine_name || "Not visible", 176, 9), 72, rowY, 9, false, dark);
    drawText(fitText(med?.dosage || "Not visible", 58, 9), 255, rowY, 9, false, dark);
    drawText(fitText(med?.frequency || "Not visible", 72, 9), 320, rowY, 9, false, dark);
    drawText(fitText(med?.duration || "Not visible", 62, 9), 398, rowY, 9, false, dark);
    drawText(fitText(med?.instructions || "Not visible", 96, 9), 464, rowY, 9, false, dark);
    rowY -= 22;
  }
  // Do not force filler rows; keep table concise to only detected medicines.
  drawText("Take medicines regularly at the same time for best results.", 36, 357, 9, false, muted);

  // Advice row
  drawBox(28, 234, 539, 106, white, border);
  drawText("GENERAL ADVICE", 40, 322, 11, true, green);
  drawBullets(40, 304, 162, args.narrative.generalAdvice, 3, 9, dark);
  drawText("PRECAUTIONS", 232, 322, 11, true, green);
  drawBullets(232, 304, 170, args.narrative.precautions, 3, 9, dark);
  drawText("FOLLOW-UP", 430, 322, 11, true, green);
  drawBullets(430, 304, 128, args.narrative.followUp, 2, 9, dark);
  if (args.narrative.redFlags.length > 0) {
    drawText(`Red flag: ${fitText(args.narrative.redFlags[0], 120, 8)}`, 430, 276, 8, false, rgb(0.7, 0.15, 0.15));
  }

  // Signature + declaration
  drawText("This is a digital prescription and does not require physical signature.", 28, 208, 9, false, muted);
  drawText(args.doctorName, 430, 194, 11, true, dark);
  drawText("Consultant Physician", 430, 182, 9, false, muted);

  // Doctor verbatim notes (captures what doctor actually dictated/typed)
  drawBox(28, 78, 539, 96, white, border);
  drawText("DOCTOR VERBATIM NOTES", 40, 158, 10, true, green);
  const verbatimLines = args.doctorVerbatimLines.length
    ? args.doctorVerbatimLines
    : dedupeLines(splitVoiceLines(args.voiceText), 6);
  let notesY = 142;
  for (const line of verbatimLines.slice(0, 4)) {
    drawText(`• ${fitText(line, 500, 9)}`, 40, notesY, 9, false, dark);
    notesY -= 14;
    if (notesY < 88) break;
  }
  if (!verbatimLines.length) {
    drawText("• No additional dictated notes.", 40, 142, 9, false, muted);
  }

  page.drawRectangle({ x: 0, y: 0, width: 595, height: 24, color: green });
  drawText("Your health. Our priority.", 244, 8, 9, true, white);

  return await pdf.save();
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
    const roomId = typeof body?.roomId === "string" ? body.roomId.trim() : "";
    const doctorText = clipText(typeof body?.doctorText === "string" ? body.doctorText : "", 12000);
    const patientNameInput = clipText(typeof body?.patientName === "string" ? body.patientName : "", 120);
    const consultationIdInput = clipText(typeof body?.consultationId === "string" ? body.consultationId : "", 80);
    const concernInput = clipText(typeof body?.concern === "string" ? body.concern : "", 120);
    if (!roomId) throw new Error("roomId is required.");
    if (!doctorText) throw new Error("doctorText is required.");

    const { data: room, error: roomError } = await serviceClient
      .from("chat_rooms")
      .select("id, patient_id, doctor_id")
      .eq("id", roomId)
      .maybeSingle();
    if (roomError || !room) throw new Error("Chat room not found.");
    if (room.doctor_id !== user.id) throw new Error("Only doctor can send prescription PDF in this room.");

    const { data: doctorProfile } = await serviceClient
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle();
    const doctorName = `Dr. ${[doctorProfile?.first_name, doctorProfile?.last_name].filter(Boolean).join(" ").trim() || "Doctor"}`;

    const { data: patientProfile } = await serviceClient
      .from("profiles")
      .select("first_name, last_name, email, push_token, settings")
      .eq("id", room.patient_id)
      .maybeSingle();
    const patientName =
      patientNameInput ||
      [patientProfile?.first_name, patientProfile?.last_name].filter(Boolean).join(" ").trim() ||
      "Patient";

    const { data: latestAppointment } = await serviceClient
      .from("appointments")
      .select("id, notes, ai_report:ai_triage_reports(concern)")
      .eq("patient_id", room.patient_id)
      .eq("doctor_id", room.doctor_id)
      .in("status", ["pending", "confirmed", "completed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const appointmentConcern = clipText(
      typeof latestAppointment?.ai_report?.concern === "string" ? latestAppointment.ai_report.concern : "",
      120
    );
    const noteConcern = clipText(typeof latestAppointment?.notes === "string" ? latestAppointment.notes : "", 120);
    const contextualConcern = concernInput || appointmentConcern || noteConcern;

    const openAiApiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
    let parsed: { reply: string; model: string } | null = null;
    let parsedJson: any = {};
    let parserModel = "heuristic-fallback";

    if (openAiApiKey) {
      try {
        const parsePrompt = buildParserPrompt(doctorText);
        parsed = await invokeOpenAIParser(openAiApiKey, parsePrompt);
        parsedJson = parseJsonSafely(parsed.reply) || {};
        parserModel = parsed.model;
      } catch (_error) {
        parsed = null;
        parsedJson = {};
      }
    }

    const aiMedicines = normalizeMedicines(parsedJson?.medicines || []);
    const heuristicMedicines = inferMedicinesFromVoiceText(doctorText);
    const medicines = dedupeMedicines([...aiMedicines, ...heuristicMedicines], 8);
    const doctorVerbatimLines = extractDoctorVerbatimLines(doctorText, 12);
    const medicinesForPdf = medicines.length
      ? medicines
      : [
          {
            medicine_name: "As spoken by doctor",
            dosage: null,
            frequency: null,
            duration: null,
            instructions: clipText(doctorVerbatimLines[0] || doctorText, 120),
          },
        ];

    const bodyNarrative: Partial<PrescriptionNarrative> =
      body?.narrative && typeof body.narrative === "object" ? body.narrative : {};
    const parsedNarrative = normalizeNarrativeFromParsed(parsedJson || {});
    const inferredNarrative = extractNarrativeFromVoice(doctorText);
    const narrative: PrescriptionNarrative = {
      concern: clipText(
        typeof bodyNarrative.concern === "string"
          ? bodyNarrative.concern
          : parsedNarrative.concern || contextualConcern || inferredNarrative.concern,
        120
      ),
      chiefComplaints: dedupeLines(
        Array.isArray(bodyNarrative.chiefComplaints)
          ? bodyNarrative.chiefComplaints
          : parsedNarrative.chiefComplaints?.length
            ? parsedNarrative.chiefComplaints
            : inferredNarrative.chiefComplaints,
        4
      ),
      historySummary: dedupeLines(
        Array.isArray(bodyNarrative.historySummary)
          ? bodyNarrative.historySummary
          : parsedNarrative.historySummary?.length
            ? parsedNarrative.historySummary
            : inferredNarrative.historySummary,
        4
      ),
      pastHistory: dedupeLines(
        Array.isArray(bodyNarrative.pastHistory) ? bodyNarrative.pastHistory : inferredNarrative.pastHistory,
        3
      ),
      examination: dedupeLines(
        Array.isArray(bodyNarrative.examination)
          ? bodyNarrative.examination
          : parsedNarrative.examination?.length
            ? parsedNarrative.examination
            : inferredNarrative.examination,
        3
      ),
      diagnosis: clipText(
        typeof bodyNarrative.diagnosis === "string"
          ? bodyNarrative.diagnosis
          : parsedNarrative.diagnosis || inferredNarrative.diagnosis || contextualConcern,
        90
      ),
      generalAdvice: dedupeLines(
        Array.isArray(bodyNarrative.generalAdvice)
          ? bodyNarrative.generalAdvice
          : parsedNarrative.generalAdvice?.length
            ? parsedNarrative.generalAdvice
            : inferredNarrative.generalAdvice,
        4
      ),
      precautions: dedupeLines(
        Array.isArray(bodyNarrative.precautions)
          ? bodyNarrative.precautions
          : parsedNarrative.precautions?.length
            ? parsedNarrative.precautions
            : inferredNarrative.precautions,
        4
      ),
      followUp: dedupeLines(
        Array.isArray(bodyNarrative.followUp)
          ? bodyNarrative.followUp
          : parsedNarrative.followUp?.length
            ? parsedNarrative.followUp
            : inferredNarrative.followUp,
        2
      ),
      redFlags: dedupeLines(
        Array.isArray(bodyNarrative.redFlags)
          ? bodyNarrative.redFlags
          : parsedNarrative.redFlags?.length
            ? parsedNarrative.redFlags
            : inferredNarrative.redFlags,
        3
      ),
    };

    const consultationId = consultationIdInput || `RX-${new Date().getTime()}`;
    const pdfBytes = await buildPrescriptionPdfBytes({
      doctorName,
      patientName,
      consultationId,
      voiceText: doctorText,
      medicines: medicinesForPdf,
      narrative,
      doctorVerbatimLines,
    });

    const fileName = `prescription_${consultationId.replace(/[^a-zA-Z0-9_-]+/g, "_")}_${Date.now()}.pdf`;
    const filePath = `${roomId}/prescriptions/${fileName}`;
    const { error: uploadError } = await serviceClient.storage
      .from("chat-attachments")
      .upload(filePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploadError) throw new Error(uploadError.message || "Failed to upload prescription PDF.");

    const messageText = `Prescription PDF for ${patientName}`;
    const { data: insertedMessage, error: messageError } = await serviceClient
      .from("chat_messages")
      .insert({
        room_id: roomId,
        sender_id: user.id,
        text: messageText,
        type: "file",
        attachment_url: filePath,
      })
      .select("id, room_id, sender_id, text, type, attachment_url, created_at")
      .single();
    if (messageError || !insertedMessage?.id) {
      throw new Error(messageError?.message || "Failed to create chat message for prescription PDF.");
    }

    // Best-effort notifications (do not fail PDF send flow)
    const pushTitle = "New Prescription Received";
    const pushBody = `${doctorName} sent your prescription PDF. Open chat to review medicines.`;
    const notificationPayload = {
      reportType: "prescription",
      roomId,
      messageId: insertedMessage.id,
      consultationId,
      attachmentPath: filePath,
    };
    const delivery: Record<string, any> = {
      inApp: { sent: false },
      push: { sent: false },
      email: { sent: false },
    };

    try {
      const { error: inAppErr } = await serviceClient.from("in_app_notifications").insert({
        user_id: room.patient_id,
        type: "prescription_shared",
        title: pushTitle,
        body: pushBody,
        data: notificationPayload,
      });
      delivery.inApp = inAppErr ? { sent: false, reason: inAppErr.message || "in_app_insert_failed" } : { sent: true };
    } catch (err: any) {
      delivery.inApp = { sent: false, reason: clipText(err?.message || "in_app_exception", 120) };
    }

    try {
      if (patientProfile?.push_token && isPushEnabledFromSettings(patientProfile?.settings)) {
        const expoResult = await sendExpoPush({
          to: patientProfile.push_token,
          sound: "default",
          title: pushTitle,
          body: pushBody,
          data: { type: "prescription_shared", ...notificationPayload },
          priority: "high",
          channelId: "appointments",
        });
        delivery.push = expoResult.ok ? { sent: true } : { sent: false, reason: `expo_${expoResult.status}` };
      } else {
        delivery.push = { sent: false, reason: "push_token_missing_or_disabled" };
      }
    } catch (err: any) {
      delivery.push = { sent: false, reason: clipText(err?.message || "push_exception", 120) };
    }

    const emailResult = await sendPrescriptionEmail({
      toEmail: String(patientProfile?.email || "").trim(),
      patientName,
      doctorName,
      consultationId,
    });
    delivery.email = emailResult;

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          roomId,
          messageId: insertedMessage.id,
          attachmentPath: filePath,
          consultationId,
          medicines: medicinesForPdf,
          concern: narrative.concern || null,
          parserModel,
          notificationDelivery: delivery,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        message: clipText(error?.message || "Failed to generate/send prescription PDF.", 240),
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
