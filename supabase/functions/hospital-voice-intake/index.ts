// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_FALLBACK_MODEL = "gpt-4o";
const MAX_TRANSCRIPT_LENGTH = 12000;
const AI_REPORTS_BUCKET = "ai-reports";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const clipText = (value: string, maxLength: number): string => {
  const text = (value || "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};

const asText = (value: unknown, maxLength = 1000): string => {
  if (typeof value !== "string") return "";
  return clipText(value, maxLength);
};

const asUuidOrNull = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
};

const normalizeRoleSlug = (row: any): string => {
  const role = Array.isArray(row?.roles) ? row.roles[0] : row?.roles;
  return String(role?.slug || "").trim().toLowerCase();
};

const createServiceClient = () => {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) {
    throw new Error("Supabase service role is not configured.");
  }
  return createClient(url, key);
};

const getOpenAIModelCandidates = (): string[] => {
  const primary = (Deno.env.get("HOSPITAL_VOICE_OPENAI_MODEL") || Deno.env.get("OPENAI_MODEL") || "").trim();
  const fallback = (
    Deno.env.get("HOSPITAL_VOICE_OPENAI_MODEL_FALLBACK") ||
    Deno.env.get("OPENAI_MODEL_FALLBACK") ||
    ""
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return [primary || DEFAULT_OPENAI_MODEL, ...fallback, DEFAULT_OPENAI_FALLBACK_MODEL].filter(
    (model, index, arr) => model && arr.indexOf(model) === index
  );
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

const listItems = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8)
    : [];

const formatQuestionAnswers = (value: any): string => {
  if (!Array.isArray(value?.question_answers)) return "";
  return value.question_answers
    .map((item: any) => {
      const question = asText(item?.question, 260);
      const answer = asText(item?.answer, 360) || "Answer not clearly captured";
      return question ? `Question: ${question}\nAnswer: ${answer}` : "";
    })
    .filter(Boolean)
    .slice(0, 12)
    .join("\n\n");
};

const buildFallbackSummary = (transcript: string): string => {
  const clean = clipText(transcript, 900);
  return [
    "Chief concern: Review the captured patient narration below.",
    "Doctor handoff: The hospital team has captured this voice intake for clinical review. Please verify symptoms, duration, severity, current medicines, allergies, and vitals before advising.",
    `Captured transcript: ${clean}`,
  ].join("\n\n");
};

const formatStructuredSummary = (value: any, fallback: string): string => {
  if (!value || typeof value !== "object") return fallback;

  const lines: string[] = [];
  const chiefComplaint = asText(value.chief_complaint, 240);
  const duration = asText(value.duration, 160);
  const doctorNote = asText(value.doctor_note || value.summary, 1200);
  const department = asText(value.suggested_department, 160);
  const symptoms = listItems(value.key_symptoms);
  const redFlags = listItems(value.red_flags);
  const questions = listItems(value.questions_for_patient);

  if (chiefComplaint) lines.push(`Chief concern: ${chiefComplaint}`);
  if (duration) lines.push(`Duration: ${duration}`);
  if (symptoms.length) lines.push(`Key symptoms: ${symptoms.join("; ")}`);
  if (redFlags.length) lines.push(`Red flags to verify: ${redFlags.join("; ")}`);
  if (department) lines.push(`Suggested department: ${department}`);
  if (doctorNote) lines.push(`Doctor handoff: ${doctorNote}`);
  if (questions.length) lines.push(`Questions for patient: ${questions.join("; ")}`);
  return lines.length ? lines.join("\n\n") : fallback;
};

const sanitizePdfText = (value: unknown): string =>
  String(value || "")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

const wrapPdfText = (text: string, font: any, size: number, maxWidth: number): string[] => {
  const clean = sanitizePdfText(text);
  if (!clean) return [];

  const lines: string[] = [];
  const paragraphs = clean.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    lines.push("");
  }

  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

const buildHospitalIntakePdfBytes = async (args: {
  hospitalName: string;
  patientName?: string;
  doctorName?: string;
  doctorDepartment?: string;
  title: string;
  status: string;
  language: string;
  summary: string;
  questionAnswers?: string;
  transcript: string;
  createdAt: string;
}) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]);
  const margin = 46;
  const width = page.getWidth();
  const contentWidth = width - margin * 2;
  let y = 790;

  const ensureSpace = (height = 34) => {
    if (y > margin + height) return;
    page = pdf.addPage([595, 842]);
    y = 790;
  };

  const drawText = (text: string, options?: { size?: number; bold?: boolean; color?: any; gap?: number }) => {
    const size = options?.size || 10.5;
    const activeFont = options?.bold ? bold : font;
    const lines = wrapPdfText(text, activeFont, size, contentWidth);
    for (const line of lines) {
      ensureSpace(size + 12);
      page.drawText(line, {
        x: margin,
        y,
        size,
        font: activeFont,
        color: options?.color || rgb(0.13, 0.18, 0.22),
      });
      y -= size + 4;
    }
    y -= options?.gap ?? 8;
  };

  const drawSection = (title: string, body: string) => {
    ensureSpace(60);
    y -= 4;
    page.drawText(sanitizePdfText(title).toUpperCase(), {
      x: margin,
      y,
      size: 9.5,
      font: bold,
      color: rgb(0.0, 0.55, 0.5),
    });
    y -= 18;
    drawText(body || "Not available", { size: 10.5, gap: 12 });
  };

  page.drawRectangle({
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
    color: rgb(0.98, 1, 0.99),
  });
  page.drawText("CD4 AI", {
    x: margin,
    y,
    size: 18,
    font: bold,
    color: rgb(0.0, 0.48, 0.42),
  });
  page.drawText("AI SNAPSHOT | Hospital Intake", {
    x: margin,
    y: y - 26,
    size: 22,
    font: bold,
    color: rgb(0.08, 0.12, 0.16),
  });
  y -= 58;

  page.drawRectangle({
    x: margin,
    y: y - 72,
    width: contentWidth,
    height: 56,
    borderWidth: 1,
    borderColor: rgb(0.78, 0.88, 0.86),
    color: rgb(0.93, 0.98, 0.96),
  });
  page.drawText(`Hospital: ${sanitizePdfText(args.hospitalName || "CD4 partner hospital")}`, {
    x: margin + 14,
    y: y - 36,
    size: 11.5,
    font: bold,
    color: rgb(0.08, 0.12, 0.16),
  });
  page.drawText(`Date: ${sanitizePdfText(args.createdAt)}`, {
    x: margin + 14,
    y: y - 54,
    size: 9.5,
    font,
    color: rgb(0.28, 0.36, 0.4),
  });
  page.drawText(`Status: ${sanitizePdfText(args.status.replace(/_/g, " "))}`, {
    x: margin + 260,
    y: y - 54,
    size: 9.5,
    font,
    color: rgb(0.28, 0.36, 0.4),
  });
  y -= 96;

  const summaryBullets = (args.summary || "Not clearly captured")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("-") ? line : `- ${line}`))
    .join("\n");

  drawSection(
    "Patient / Doctor Details",
    `Patient: ${args.patientName || "Not linked"}\nDoctor: ${args.doctorName || "Not assigned"}${args.doctorDepartment ? ` (${args.doctorDepartment})` : ""}\nIntake: ${args.title}\nLanguage: ${args.language || "Hindi / English"}`,
  );
  drawSection("AI Summary (English Bullet Points)", summaryBullets);
  drawSection(
    "AI Questions and Patient Answers",
    args.questionAnswers || "No relevant AI question-and-answer data was captured.",
  );
  drawSection(
    "Risk / Context",
    "Doctor review is required before diagnosis or treatment. Verify symptoms, duration, severity, vitals, medicines, allergies, and red flags directly with the patient.",
  );
  drawSection(
    "Doctor Quick Review",
    "Confirm the chief concern and timeline. Clarify any unanswered AI question. Screen red flags and verify medicines/allergies before clinical decisions.",
  );
  drawSection(
    "Source Note",
    "Only clinically relevant information is shown in this doctor PDF. The original voice transcript remains available in the hospital record if verification is required.",
  );
  drawSection(
    "Clinical Note",
    "This intake is an AI-assisted handoff for doctor review. It is not a diagnosis or prescription. The doctor should verify symptoms, vitals, medicines, allergies, and red flags directly with the patient."
  );

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawText(`CD4 AI Hospital Intake | Page ${index + 1} of ${pages.length}`, {
      x: margin,
      y: 24,
      size: 8,
      font,
      color: rgb(0.44, 0.5, 0.53),
    });
  });

  return await pdf.save();
};

const buildPrompt = (args: {
  transcript: string;
  title: string;
  language: string;
  hospitalName: string;
  doctorDetails: { name: string; department: string; specialization: string } | null;
  patientDetails: { name: string } | null;
}) => `You are a hospital voice-intake assistant for CD4.

Create a concise doctor-ready handoff from a hospital staff transcript.

Important rules:
- Understand Hindi, Hinglish, and English.
- Write the doctor summary in professional English, even when the transcript is Hindi or Hinglish.
- Format the summary as concise bullet points and include every captured clinical detail.
- Do not diagnose.
- Do not prescribe medicines.
- Do not invent vitals, allergies, or test results.
- Include only clinically relevant content; exclude greetings, filler, confirmations, booking talk, and repeated AI speech.
- Capture each clinically relevant AI question with the patient's answer in the question_answers field.
- If emergency symptoms are mentioned, mark them as red flags to verify.
- Keep the output useful for a doctor reviewing the patient later.
- Return ONLY valid JSON.

Context:
Hospital: ${args.hospitalName || "CD4 partner hospital"}
Intake title: ${args.title}
Language: ${args.language}
${args.patientDetails ? `Patient Name: ${args.patientDetails.name}` : "Linked patient: no"}
${args.doctorDetails ? `Target Doctor: ${args.doctorDetails.name}\nSpecialization: ${args.doctorDetails.specialization}\nDepartment: ${args.doctorDetails.department}` : "Linked doctor: no"}

JSON format:
{
  "chief_complaint": "",
  "duration": "",
  "key_symptoms": [],
  "red_flags": [],
  "suggested_department": "",
  "doctor_note": "",
  "questions_for_patient": [],
  "question_answers": [{ "question": "", "answer": "" }]
}

Transcript:
${args.transcript}`;

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
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: args.prompt }],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || `OpenAI hospital intake failed (${response.status})`);
      }

      const content = data?.choices?.[0]?.message?.content;
      const reply =
        typeof content === "string"
          ? content.trim()
          : Array.isArray(content)
            ? content.map((item: any) => (typeof item?.text === "string" ? item.text.trim() : "")).find(Boolean) || ""
            : "";
      if (!reply) throw new Error("OpenAI returned empty hospital intake output.");
      return { reply, model };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || "Hospital intake AI unavailable.");
};

const invokeOpenAIChat = async (args: { apiKey: string; messages: any[] }) => {
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
          temperature: 0.3,
          messages: args.messages,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || `OpenAI chat failed (${response.status})`);
      }

      const content = data?.choices?.[0]?.message?.content;
      const reply = typeof content === "string" ? content.trim() : "";
      if (!reply) throw new Error("OpenAI returned empty chat output.");
      return { reply, model };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || "Hospital chat AI unavailable.");
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ success: false, message: "Method not allowed" }, 405);
    }

    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.replace("Bearer ", "").trim();
    if (!accessToken) {
      return jsonResponse({ success: false, message: "Unauthorized" }, 401);
    }

    const serviceClient = createServiceClient();
    const {
      data: { user },
      error: userError,
    } = await serviceClient.auth.getUser(accessToken);

    if (userError || !user?.id) {
      return jsonResponse({ success: false, message: "Unauthorized" }, 401);
    }

    const { data: profileRow, error: profileError } = await serviceClient
      .from("profiles")
      .select("id, roles(slug)")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    const roleSlug = normalizeRoleSlug(profileRow) || String(user.user_metadata?.role || "").trim().toLowerCase();
    if (roleSlug !== "hospital") {
      return jsonResponse({ success: false, message: "Hospital admin access required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const isChat = Boolean(body?.isChat);

    const { data: onboardingRow, error: onboardingError } = await serviceClient
      .from("hospital_onboarding_requests")
      .select("id, registered_name, display_name")
      .eq("hospital_admin_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (onboardingError) throw onboardingError;
    if (!onboardingRow?.id) {
      throw new Error("Hospital onboarding record not found for this account.");
    }

    const hospitalName = onboardingRow.display_name || onboardingRow.registered_name || "CD4 Partner Hospital";

    // Resolve doctor and patient details
    const patientId = asUuidOrNull(body?.patientId);
    const doctorId = asUuidOrNull(body?.doctorId);

    let doctorDetails: any = null;
    let patientDetails: any = null;

    if (doctorId) {
      const { data: doctorLink, error: doctorError } = await serviceClient
        .from("hospital_doctors")
        .select(`
          id,
          department,
          doctor:doctors (
            specialization,
            profiles (first_name, last_name)
          )
        `)
        .eq("hospital_admin_user_id", user.id)
        .eq("doctor_id", doctorId)
        .eq("status", "active")
        .maybeSingle();

      if (doctorError) throw doctorError;
      if (!doctorLink?.id) {
        throw new Error("Selected doctor is not linked to this hospital.");
      }

      const doc = doctorLink.doctor || {};
      const docProfile = Array.isArray(doc.profiles) ? doc.profiles[0] : doc.profiles;
      const firstName = docProfile?.first_name || "";
      const lastName = docProfile?.last_name || "";
      const docName = `Dr. ${firstName} ${lastName}`.trim();

      doctorDetails = {
        name: docName || "Doctor",
        department: doctorLink.department || "",
        specialization: doc.specialization || "",
      };
    }

    if (patientId) {
      const { data: patientLink, error: patientError } = await serviceClient
        .from("hospital_patients")
        .select(`
          id,
          patient:profiles!hospital_patients_patient_id_fkey (
            first_name,
            last_name
          )
        `)
        .eq("hospital_admin_user_id", user.id)
        .eq("patient_id", patientId)
        .eq("status", "active")
        .maybeSingle();

      if (patientError) throw patientError;
      if (!patientLink?.id) {
        throw new Error("Selected patient is not linked to this hospital.");
      }

      const patProfile = Array.isArray(patientLink.patient) ? patientLink.patient[0] : patientLink.patient;
      const firstName = patProfile?.first_name || "";
      const lastName = patProfile?.last_name || "";
      const patName = `${firstName} ${lastName}`.trim();

      patientDetails = {
        name: patName || "Patient",
      };
    }

    if (isChat) {
      const chatHistory = Array.isArray(body?.history) ? body.history : [];
      if (!chatHistory.length) {
        return jsonResponse({ success: false, message: "History is empty." }, 400);
      }

      const openAiApiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
      if (!openAiApiKey) {
        return jsonResponse({
          success: true,
          reply: "I am a local simulation. Could you describe the patient's symptoms? (Please configure OPENAI_API_KEY for dynamic AI).",
          model: "fallback",
        });
      }

      let triageTargetContext = "";
      let specialtyFocusInstructions = "";

      if (doctorDetails) {
        const spec = doctorDetails.specialization || doctorDetails.department || "General Medicine";
        triageTargetContext = `You are prepping the patient for an upcoming clinical consultation with Dr. ${doctorDetails.name} (Specialty: ${spec}, Department: ${doctorDetails.department || "N/A"}).`;
        specialtyFocusInstructions = `Based on your clinical knowledge of Dr. ${doctorDetails.name}'s specialty (${spec}) and department (${doctorDetails.department || "N/A"}), you must dynamically determine what specific medical history, clinical concerns, pain indicators, triggers, onset characteristics, severity, relevant medications, and risk factors are crucial for a doctor in this field. Focus your questions specifically on extracting these relevant points to construct a high-yield history.`;
      } else {
        triageTargetContext = "You are preparing a comprehensive patient history for a general medical consultation.";
        specialtyFocusInstructions = "Focus on general clinical history intake: chief complaint, onset, duration, character, progression, severity, and associated symptoms.";
      }

      let patientNameContext = "";
      if (patientDetails) {
        patientNameContext = `The patient's name is ${patientDetails.name}. You can refer to them by their name and direct questions to them or their accompanying staff/relative.`;
      }

      const systemPrompt = `You are a highly skilled and empathetic AI Clinical Triage Assistant for ${hospitalName}. 
Your goal is to conduct a professional, detailed medical history interview (triage intake) before the patient sees the doctor.

${triageTargetContext}
${patientNameContext}

Clinical Protocol:
1. Dynamically tailor your questions: ${specialtyFocusInstructions}
2. Ensure you systematically cover:
   - Detailed description of chief complaints and symptoms (onset, character, location, radiation, what makes it better/worse).
   - Duration and progression of the condition over time.
   - Relevant past medical history, chronic conditions (e.g., hypertension, diabetes, cardiac history), surgeries, and allergies.
   - Current medications, dosages, and adherence (if any).
   - Vitals if measured recently (e.g., temperature, blood pressure, oxygen saturation, blood sugar).

Interaction Rules:
1. Ask only ONE clear, concise question at a time to avoid cognitive overload and allow natural voice replies.
2. Maintain natural, fluent, and highly empathetic bilingual conversational flow (Hindi, English, or Hinglish - Hindi written in Latin script, e.g., "aapko kab se ye takleef hai?"). Match the user's preferred language.
3. Keep your questions clinical, concise, and direct. Do not engage in casual chitchat.
4. STRICT CRITICAL CONSTRAINT: Do not provide any diagnosis, prognosis, treatment advice, or drug recommendations. Focus solely on history taking.
5. If the user indicates red flags/critical symptoms (e.g., severe sudden chest pain radiating to arm, sudden weakness on one side of body, severe breathing difficulty, uncontrolled bleeding, acute severe pain): calmly advise them to seek immediate emergency care while maintaining your intake readiness.
6. When you have gathered sufficient clinical details to prepare a comprehensive intake handoff, briefly summarize the key findings in 1-2 sentences to confirm understanding, and append the EXACT completion keyword: "THANK_YOU_INTAKE_COMPLETE".`;

      const messages = [
        {
          role: "system",
          content: systemPrompt,
        },
        ...chatHistory.map((h: any) => ({
          role: h.role === "assistant" ? "assistant" : "user",
          content: String(h.content || "").trim(),
        }))
      ];

      try {
        const result = await invokeOpenAIChat({ apiKey: openAiApiKey, messages });
        return jsonResponse({
          success: true,
          reply: result.reply,
          model: result.model,
        });
      } catch (error: any) {
        return jsonResponse({ success: false, message: error?.message || "Chat failed." }, 500);
      }
    }

    const title = asText(body?.title, 180) || "Hospital voice intake";
    const language = asText(body?.language, 80) || "Hindi / English";
    const transcript = asText(body?.transcript, MAX_TRANSCRIPT_LENGTH);

    if (!transcript || transcript.length < 8) {
      throw new Error("Transcript is required before creating a hospital voice intake.");
    }

    const fallbackSummary = buildFallbackSummary(transcript);
    const openAiApiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
    let summary = fallbackSummary;
    let source = "fallback";
    let model: string | null = null;
    let structured: any = null;

    if (openAiApiKey) {
      try {
        const generation = await invokeOpenAI({
          apiKey: openAiApiKey,
          prompt: buildPrompt({
            transcript,
            title,
            language,
            hospitalName,
            doctorDetails,
            patientDetails,
          }),
        });
        structured = parseJsonSafely(generation.reply);
        summary = formatStructuredSummary(structured, fallbackSummary);
        source = "openai";
        model = generation.model;
      } catch (error) {
        console.warn("[hospital-voice-intake] AI generation failed; saved fallback summary:", error?.message || error);
      }
    }

    const intakeId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const pdfPath = `${user.id}/hospital-intakes/${intakeId}.pdf`;
    const pdfBytes = await buildHospitalIntakePdfBytes({
      hospitalName,
      patientName: patientDetails?.name,
      doctorName: doctorDetails?.name,
      doctorDepartment: doctorDetails?.department || doctorDetails?.specialization,
      title,
      status: "ready_for_doctor",
      language,
      summary,
      questionAnswers: formatQuestionAnswers(structured),
      transcript,
      createdAt,
    });

    const { error: pdfUploadError } = await serviceClient.storage
      .from(AI_REPORTS_BUCKET)
      .upload(pdfPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (pdfUploadError) {
      throw new Error(pdfUploadError.message || "Failed to create hospital intake PDF.");
    }

    const { data: inserted, error: insertError } = await serviceClient
      .from("hospital_voice_intake_sessions")
      .insert({
        id: intakeId,
        hospital_admin_user_id: user.id,
        onboarding_request_id: onboardingRow.id,
        doctor_id: doctorId,
        patient_id: patientId,
        title,
        status: "ready_for_doctor",
        language,
        transcript,
        ai_summary: summary,
        metadata: {
          source,
          model,
          structured,
          pdf_path: pdfPath,
          transcript_length: transcript.length,
        },
        created_by: user.id,
        created_at: createdAt,
      })
      .select("id, ai_summary, status, metadata")
      .single();

    if (insertError) throw insertError;

    return jsonResponse({
      success: true,
      id: inserted.id,
      status: inserted.status,
      summary: inserted.ai_summary,
      pdfUrl: inserted.metadata?.pdf_path || pdfPath,
      source,
      model,
    });
  } catch (error: any) {
    return jsonResponse(
      {
        success: false,
        message: error?.message || "Failed to create hospital voice intake.",
      },
      400
    );
  }
});
