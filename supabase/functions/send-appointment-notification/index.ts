// @ts-ignore: Resolved by Deno/Supabase Edge runtime at deploy time.
// @ts-ignore: Resolved by Deno/Supabase Edge runtime at deploy time.
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore: Remote ESM import is resolved in Deno runtime.
import { PDFDocument, StandardFonts, degrees, rgb } from "https://esm.sh/pdf-lib@1.17.1";

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (payload: Record<string, unknown>, status: number = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const clipText = (value: string, maxLength: number): string => {
  const text = (value || "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};

const sanitizePdfText = (value: unknown, maxLength?: number): string => {
  const raw = typeof value === "string" ? value : value == null ? "" : String(value);
  if (!raw) return "";

  const sanitized = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E\n\r\t]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (typeof maxLength === "number" && Number.isFinite(maxLength) && maxLength > 0) {
    return clipText(sanitized, maxLength);
  }

  return sanitized;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const safeJsonParse = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return null;
  }
};

type TriageHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

type PatientSnapshot = {
  name: string;
  age: string;
  gender: string;
  phone: string;
  email: string;
  address: string;
  weight: string;
  bloodPressure: string;
  pulse: string;
};

type TriageSnapshot = {
  chiefConcern: string;
  duration: string;
  severity: string;
  associatedSymptoms: string[];
  medicationContext: string;
  riskNote: string;
  bookingContext: string;
  answeredTopics: Array<{ label: string; value: string }>;
  missingDataPoints: string[];
  captureScore: number;
};

type ChatQaPair = {
  question: string;
  answer: string;
  source: "priority" | "chat";
};

const parseOptionalNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const parseOptionalGender = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (["male", "m"].includes(lowered)) return "Male";
  if (["female", "f"].includes(lowered)) return "Female";
  if (["other", "non-binary", "non binary"].includes(lowered)) return "Other";
  return normalized;
};

const createServiceClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return createClient(supabaseUrl, serviceRoleKey);
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

    return {
      ok: res.ok && ticketErrors.length === 0,
      status: res.status,
      payload,
      ticketErrors,
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const hasAppointmentInAppNotification = async (
  serviceClient: any,
  args: { userId: string; appointmentId: string },
): Promise<boolean> => {
  try {
    const { data, error } = await serviceClient
      .from("in_app_notifications")
      .select("id")
      .eq("user_id", args.userId)
      .eq("type", "appointment_update")
      .contains("data", { appointmentId: args.appointmentId })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("appointment notification duplicate lookup failed:", error);
      return false;
    }

    return Boolean(data?.id);
  } catch (lookupError) {
    console.warn("appointment notification duplicate lookup threw:", lookupError);
    return false;
  }
};

const extractBearerToken = (req: Request): string => {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
};

const getRequestIp = (req: Request): string | null => {
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
  const first = forwarded.split(",")[0]?.trim();
  return first || null;
};

const logSecurityEvent = async (serviceClient: any, args: {
  eventType: string;
  severity: "info" | "warn" | "error" | "critical";
  userId?: string | null;
  ip?: string | null;
  context?: Record<string, unknown>;
}) => {
  try {
    await serviceClient.from("security_audit_logs").insert({
      event_type: args.eventType,
      severity: args.severity,
      user_id: args.userId || null,
      ip: args.ip || null,
      source: "send-appointment-notification",
      context: args.context || {},
    });
  } catch {
    // never block notification flow on telemetry failure
  }
};

const enforceRateLimit = async (serviceClient: any, args: {
  scope: string;
  subject: string;
  maxRequests: number;
  windowSeconds: number;
}) => {
  const { data, error } = await serviceClient.rpc("security_check_rate_limit", {
    p_scope: args.scope,
    p_subject: args.subject,
    p_window_seconds: Math.max(1, Math.floor(args.windowSeconds)),
    p_max_requests: Math.max(1, Math.floor(args.maxRequests)),
  });

  if (error) {
    return { allowed: true, remaining: null, retryAfterSec: 0, currentCount: null };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean(row?.allowed),
    remaining: typeof row?.remaining === "number" ? row.remaining : null,
    retryAfterSec: typeof row?.retry_after_sec === "number" ? row.retry_after_sec : 0,
    currentCount: typeof row?.current_count === "number" ? row.current_count : null,
  };
};

const formatLiteralDate = (dateText?: string | null, timeText?: string | null): Date | null => {
  const safeDate = typeof dateText === "string" ? dateText.trim() : "";
  if (!safeDate) return null;

  const dateMatch = safeDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return null;

  const [, yearText, monthText, dayText] = dateMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  let hour = 0;
  let minute = 0;
  let second = 0;

  const safeTime = typeof timeText === "string" ? timeText.trim() : "";
  if (safeTime) {
    const timeMatch = safeTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!timeMatch) return null;
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    second = Number(timeMatch[3] || "0");
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
};

const formatDateValue = (dateText?: string | null, timeText?: string | null): string | null => {
  const literalDate = formatLiteralDate(dateText, timeText);
  if (!literalDate) return null;

  const options: Intl.DateTimeFormatOptions = timeText
    ? {
        timeZone: "UTC",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }
    : {
        timeZone: "UTC",
        day: "2-digit",
        month: "short",
        year: "numeric",
      };

  return new Intl.DateTimeFormat("en-IN", options).format(literalDate);
};

const formatGeneratedTimestamp = (value: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Calcutta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value);

const formatSlotLabel = (slotDate?: string | null, startTime?: string | null) => {
  const formatted = formatDateValue(slotDate, startTime);
  if (formatted) return formatted;

  const dateText = typeof slotDate === "string" ? slotDate : "";
  const timeText = typeof startTime === "string" ? startTime : "";
  if (!dateText && !timeText) return "An upcoming slot";
  if (dateText && timeText) return `${dateText} at ${timeText}`;
  return dateText || timeText;
};

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");

const normalizeConcern = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return sanitizePdfText(value.replace(/\s+/g, " ").trim(), 120);
};

const CLINICAL_TRANSCRIPT_SIGNAL_PATTERN =
  /\b(symptom|symptoms|when did|how long|since|kab se|severity|pain scale|1-10|fever|cough|cold|rash|itch|allergy|breath|breathing|pain|ache|vomit|nausea|diarrhea|constipation|period|pregnan|pcos|bp|blood pressure|sugar|diabet|thyroid|medicine|medication|tablet|dawai|dava|doctor|consult)\b/i;

const isClinicalTranscriptLine = (item: TriageHistoryItem): boolean => {
  const text = (item?.content || "").trim();
  if (!text) return false;

  if (CLINICAL_TRANSCRIPT_SIGNAL_PATTERN.test(text)) {
    return true;
  }

  if (item.role === "assistant" && /\?/.test(text)) {
    return true;
  }

  if (item.role === "user" && text.split(/\s+/).length >= 6) {
    return true;
  }

  return false;
};

const normalizeHistory = (value: unknown): TriageHistoryItem[] => {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((item: any): TriageHistoryItem => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: sanitizePdfText(typeof item?.content === "string" ? item.content : "", 420),
    }))
    .filter((item) => item.content.length > 0);

  const clinicallyRelevant = normalized.filter(isClinicalTranscriptLine);
  const finalHistory = clinicallyRelevant.length >= 6 ? clinicallyRelevant : normalized;

  return finalHistory.slice(-24);
};

const choosePreferredHistory = (
  primary: TriageHistoryItem[],
  secondary: TriageHistoryItem[],
): TriageHistoryItem[] => {
  const primaryUserTurns = primary.filter((item) => item.role === "user").length;
  const secondaryUserTurns = secondary.filter((item) => item.role === "user").length;
  if (secondaryUserTurns > primaryUserTurns) return secondary;
  if (secondary.length > primary.length + 2) return secondary;
  return primary.length > 0 ? primary : secondary;
};

const toDisplayText = (value: unknown, fallback = "Not available"): string => {
  if (typeof value === "string") {
    const trimmed = sanitizePdfText(value);
    if (trimmed.length) return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return sanitizePdfText(String(value));
  return fallback;
};

const normalizePhone = (...candidates: unknown[]): string => {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const raw = candidate.trim();
    if (!raw) continue;
    const digits = raw.replace(/\D+/g, "");
    if (digits.length === 10) return digits;
    if (digits.length > 10) return digits.slice(-10);
    return raw;
  }
  return "Not available";
};

const resolvePatientSnapshot = (profile: any): PatientSnapshot => {
  const firstName = toDisplayText(profile?.first_name, "").replace(/\s+/g, " ").trim();
  const lastName = toDisplayText(profile?.last_name, "").replace(/\s+/g, " ").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const genderRaw = toDisplayText(profile?.gender, "Not available");
  const gender = genderRaw === "Not available" ? genderRaw : clipText(genderRaw, 20);

  const ageValue = Number(profile?.age);
  const age = Number.isFinite(ageValue) && ageValue > 0 ? `${Math.round(ageValue)} years` : "Not available";

  const weightValue = Number(profile?.weight);
  const weight = Number.isFinite(weightValue) && weightValue > 0 ? `${weightValue} kg` : "Not available";

  const pulseValue = Number(profile?.pulse);
  const pulse = Number.isFinite(pulseValue) && pulseValue > 0 ? `${Math.round(pulseValue)} bpm` : "Not available";

  return {
    name: fullName || "Patient",
    age,
    gender,
    phone: normalizePhone(profile?.phone_number, profile?.mobile, profile?.phone),
    email: toDisplayText(profile?.email),
    address: toDisplayText(profile?.address),
    weight,
    bloodPressure: toDisplayText(profile?.blood_pressure),
    pulse,
  };
};

const drawCD4Hallmark = (args: {
  page: any;
  regularFont: any;
  boldFont: any;
}) => {
  const { page, regularFont, boldFont } = args;
  const { width, height } = page.getSize();

  const badgeCenterX = width - 48;
  const badgeCenterY = height - 42;
  page.drawCircle({
    x: badgeCenterX,
    y: badgeCenterY,
    size: 15,
    color: rgb(0.93, 0.97, 0.96),
    borderColor: rgb(0.67, 0.79, 0.76),
    borderWidth: 1.4,
  });
  page.drawCircle({
    x: badgeCenterX,
    y: badgeCenterY,
    size: 7.2,
    color: rgb(0.09, 0.56, 0.46),
  });
  page.drawLine({
    start: { x: badgeCenterX - 3.4, y: badgeCenterY },
    end: { x: badgeCenterX + 3.4, y: badgeCenterY },
    color: rgb(1, 1, 1),
    thickness: 1.2,
  });
  page.drawLine({
    start: { x: badgeCenterX, y: badgeCenterY - 3.4 },
    end: { x: badgeCenterX, y: badgeCenterY + 3.4 },
    color: rgb(1, 1, 1),
    thickness: 1.2,
  });

  page.drawText("CD4", {
    x: width - 126,
    y: height - 38,
    size: 9,
    font: boldFont,
    color: rgb(0.18, 0.31, 0.34),
  });
  page.drawText("AI CLINICAL SNAPSHOT", {
    x: width - 177,
    y: height - 49,
    size: 7,
    font: regularFont,
    color: rgb(0.46, 0.56, 0.58),
  });

  page.drawText("CD4", {
    x: 165,
    y: 356,
    size: 58,
    font: boldFont,
    color: rgb(0.95, 0.97, 0.96),
    rotate: degrees(-27),
  });
};

const wrapText = (text: string, maxWidth: number, font: any, fontSize: number): string[] => {
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines;
};

const drawWrappedBlock = (args: {
  pageRef: { current: any };
  pdfDoc: any;
  text: string;
  x: number;
  yRef: { current: number };
  maxWidth: number;
  font: any;
  size: number;
  lineHeight: number;
  color?: any;
  onPageCreated?: (page: any) => void;
}) => {
  const pageSize = args.pageRef.current.getSize();
  const ensurePage = () => {
    if (args.yRef.current >= 56) return;
    args.pageRef.current = args.pdfDoc.addPage([600, 800]);
    if (typeof args.onPageCreated === "function") {
      args.onPageCreated(args.pageRef.current);
    }
    args.yRef.current = args.pageRef.current.getSize().height - 48;
  };

  const lines = wrapText(args.text, args.maxWidth, args.font, args.size);
  for (const line of lines) {
    ensurePage();
    args.pageRef.current.drawText(line, {
      x: args.x,
      y: args.yRef.current,
      size: args.size,
      font: args.font,
      color: args.color,
    });
    args.yRef.current -= args.lineHeight;
  }

  if (!lines.length) {
    ensurePage();
    args.yRef.current -= args.lineHeight;
  }

  if (args.yRef.current < 56) {
    args.pageRef.current = args.pdfDoc.addPage([600, 800]);
    if (typeof args.onPageCreated === "function") {
      args.onPageCreated(args.pageRef.current);
    }
    args.yRef.current = args.pageRef.current.getSize().height - 48;
  }

  // keep linter happy for currently unused pageSize in strict mode
  void pageSize;
};

const REPORT_THEME = {
  ink: rgb(0.11, 0.16, 0.19),
  muted: rgb(0.42, 0.49, 0.52),
  accent: rgb(0.05, 0.42, 0.34),
  accentSoft: rgb(0.92, 0.97, 0.95),
  card: rgb(0.98, 0.99, 0.99),
  cell: rgb(1, 1, 1),
  border: rgb(0.85, 0.9, 0.9),
  hero: rgb(0.07, 0.31, 0.28),
  heroSoft: rgb(0.78, 0.9, 0.88),
  warning: rgb(0.72, 0.55, 0.12),
  warningSoft: rgb(0.99, 0.96, 0.9),
  danger: rgb(0.74, 0.2, 0.2),
  dangerSoft: rgb(0.99, 0.93, 0.93),
  neutralSoft: rgb(0.94, 0.96, 0.98),
};

type ReportField = {
  label: string;
  value: string;
};

type ReportBadgeTone = "success" | "warning" | "danger" | "neutral";

type ReportBadge = {
  label: string;
  value: string;
  tone: ReportBadgeTone;
};

const countWrappedLines = (text: string, maxWidth: number, font: any, fontSize: number): number =>
  Math.max(1, wrapText(text, maxWidth, font, fontSize).length);

const estimateCardHeight = (args: {
  title: string;
  lines: string[];
  titleFont: any;
  bodyFont: any;
  width: number;
  titleSize?: number;
  bodySize?: number;
  lineHeight?: number;
}): number => {
  const titleSize = args.titleSize || 13;
  const bodySize = args.bodySize || 10.8;
  const lineHeight = args.lineHeight || 14;
  const contentWidth = args.width - 52;
  let linesCount = countWrappedLines(args.title, contentWidth, args.titleFont, titleSize);
  for (const line of args.lines) {
    linesCount += countWrappedLines(line, contentWidth, args.bodyFont, bodySize);
  }
  return 22 + linesCount * lineHeight + Math.max(12, args.lines.length * 1.2) + 12;
};

const ensureVerticalSpace = (args: {
  pageRef: { current: any };
  pdfDoc: any;
  yRef: { current: number };
  minHeight: number;
  onPageCreated?: (page: any) => void;
}) => {
  if (args.yRef.current - args.minHeight >= 54) return;
  args.pageRef.current = args.pdfDoc.addPage([600, 800]);
  if (typeof args.onPageCreated === "function") {
    args.onPageCreated(args.pageRef.current);
  }
  args.yRef.current = args.pageRef.current.getSize().height - 48;
};

const drawSectionCard = (args: {
  pageRef: { current: any };
  pdfDoc: any;
  yRef: { current: number };
  title: string;
  lines: string[];
  boldFont: any;
  font: any;
  onPageCreated?: (page: any) => void;
  accentColor?: any;
  backgroundColor?: any;
  borderColor?: any;
  titleColor?: any;
  bodyColor?: any;
}) => {
  const x = 44;
  const width = 512;
  const titleSize = 13;
  const bodySize = 10.8;
  const lineHeight = 14;
  const accentColor = args.accentColor || REPORT_THEME.accent;
  const backgroundColor = args.backgroundColor || REPORT_THEME.card;
  const borderColor = args.borderColor || REPORT_THEME.border;
  const titleColor = args.titleColor || REPORT_THEME.ink;
  const bodyColor = args.bodyColor || REPORT_THEME.ink;

  const totalHeight = estimateCardHeight({
    title: args.title,
    lines: args.lines,
    titleFont: args.boldFont,
    bodyFont: args.font,
    width,
    titleSize,
    bodySize,
    lineHeight,
  });

  ensureVerticalSpace({
    pageRef: args.pageRef,
    pdfDoc: args.pdfDoc,
    yRef: args.yRef,
    minHeight: totalHeight + 14,
    onPageCreated: args.onPageCreated,
  });

  const topY = args.yRef.current;
  const bottomY = topY - totalHeight;
  const page = args.pageRef.current;
  const contentWidth = width - 52;
  const contentX = x + 18;

  page.drawRectangle({
    x,
    y: bottomY,
    width,
    height: totalHeight,
    color: backgroundColor,
    borderColor,
    borderWidth: 1,
  });
  page.drawRectangle({
    x,
    y: bottomY,
    width: 6,
    height: totalHeight,
    color: accentColor,
  });

  let cursorY = topY - 18;
  for (const line of wrapText(args.title, contentWidth, args.boldFont, titleSize)) {
    page.drawText(line, {
      x: contentX,
      y: cursorY,
      size: titleSize,
      font: args.boldFont,
      color: titleColor,
    });
    cursorY -= lineHeight;
  }

  cursorY -= 4;
  for (const item of args.lines) {
    const wrapped = wrapText(item, contentWidth, args.font, bodySize);
    for (const line of wrapped) {
      page.drawText(line, {
        x: contentX,
        y: cursorY,
        size: bodySize,
        font: args.font,
        color: bodyColor,
      });
      cursorY -= lineHeight;
    }
    cursorY -= 2;
  }

  args.yRef.current = bottomY - 14;
};

const estimateGridFieldHeight = (args: {
  field: ReportField;
  width: number;
  boldFont: any;
  font: any;
}): number => {
  const labelSize = 8.3;
  const valueSize = 10.6;
  const contentWidth = args.width - 20;
  const labelLines = countWrappedLines(args.field.label, contentWidth, args.font, labelSize);
  const valueLines = countWrappedLines(args.field.value, contentWidth, args.boldFont, valueSize);
  return 16 + labelLines * 10 + 4 + valueLines * 13 + 12;
};

const estimateGridCardHeight = (args: {
  title: string;
  fields: ReportField[];
  boldFont: any;
  font: any;
  width: number;
  columns?: number;
}): number => {
  const xPadding = 18;
  const columnGap = 12;
  const columns = Math.max(1, args.columns || 2);
  const contentWidth = args.width - xPadding * 2;
  const cellWidth = (contentWidth - columnGap * (columns - 1)) / columns;
  const titleHeight = countWrappedLines(args.title, contentWidth, args.boldFont, 13) * 14;
  let bodyHeight = 0;

  for (let index = 0; index < args.fields.length; index += columns) {
    const rowFields = args.fields.slice(index, index + columns);
    const rowHeight = Math.max(
      ...rowFields.map((field) =>
        estimateGridFieldHeight({
          field,
          width: cellWidth,
          boldFont: args.boldFont,
          font: args.font,
        }),
      ),
    );
    bodyHeight += rowHeight;
    if (index + columns < args.fields.length) bodyHeight += columnGap;
  }

  return 24 + titleHeight + 10 + bodyHeight + 18;
};

const drawGridCard = (args: {
  pageRef: { current: any };
  pdfDoc: any;
  yRef: { current: number };
  title: string;
  fields: ReportField[];
  boldFont: any;
  font: any;
  onPageCreated?: (page: any) => void;
  columns?: number;
  accentColor?: any;
  backgroundColor?: any;
  borderColor?: any;
}) => {
  const x = 44;
  const width = 512;
  const columns = Math.max(1, args.columns || 2);
  const columnGap = 12;
  const accentColor = args.accentColor || REPORT_THEME.accent;
  const backgroundColor = args.backgroundColor || REPORT_THEME.card;
  const borderColor = args.borderColor || REPORT_THEME.border;
  const totalHeight = estimateGridCardHeight({
    title: args.title,
    fields: args.fields,
    boldFont: args.boldFont,
    font: args.font,
    width,
    columns,
  });

  ensureVerticalSpace({
    pageRef: args.pageRef,
    pdfDoc: args.pdfDoc,
    yRef: args.yRef,
    minHeight: totalHeight + 14,
    onPageCreated: args.onPageCreated,
  });

  const page = args.pageRef.current;
  const topY = args.yRef.current;
  const bottomY = topY - totalHeight;
  const contentX = x + 18;
  const contentWidth = width - 36;
  const cellWidth = (contentWidth - columnGap * (columns - 1)) / columns;

  page.drawRectangle({
    x,
    y: bottomY,
    width,
    height: totalHeight,
    color: backgroundColor,
    borderColor,
    borderWidth: 1,
  });
  page.drawRectangle({
    x,
    y: bottomY,
    width: 6,
    height: totalHeight,
    color: accentColor,
  });

  let cursorY = topY - 18;
  for (const line of wrapText(args.title, contentWidth, args.boldFont, 13)) {
    page.drawText(line, {
      x: contentX,
      y: cursorY,
      size: 13,
      font: args.boldFont,
      color: REPORT_THEME.ink,
    });
    cursorY -= 14;
  }

  cursorY -= 4;
  for (let index = 0; index < args.fields.length; index += columns) {
    const rowFields = args.fields.slice(index, index + columns);
    const rowHeight = Math.max(
      ...rowFields.map((field) =>
        estimateGridFieldHeight({
          field,
          width: cellWidth,
          boldFont: args.boldFont,
          font: args.font,
        }),
      ),
    );

    rowFields.forEach((field, fieldIndex) => {
      const cellX = contentX + fieldIndex * (cellWidth + columnGap);
      const cellBottomY = cursorY - rowHeight;
      page.drawRectangle({
        x: cellX,
        y: cellBottomY,
        width: cellWidth,
        height: rowHeight,
        color: REPORT_THEME.cell,
        borderColor: REPORT_THEME.border,
        borderWidth: 1,
      });

      let cellCursorY = cursorY - 14;
      for (const line of wrapText(field.label, cellWidth - 20, args.font, 8.3)) {
        page.drawText(line, {
          x: cellX + 10,
          y: cellCursorY,
          size: 8.3,
          font: args.font,
          color: REPORT_THEME.muted,
        });
        cellCursorY -= 10;
      }

      cellCursorY -= 4;
      for (const line of wrapText(field.value, cellWidth - 20, args.boldFont, 10.6)) {
        page.drawText(line, {
          x: cellX + 10,
          y: cellCursorY,
          size: 10.6,
          font: args.boldFont,
          color: REPORT_THEME.ink,
        });
        cellCursorY -= 13;
      }
    });

    cursorY -= rowHeight + columnGap;
  }

  args.yRef.current = bottomY - 14;
};

const getBadgePalette = (tone: ReportBadgeTone) => {
  if (tone === "danger") {
    return {
      backgroundColor: REPORT_THEME.dangerSoft,
      borderColor: rgb(0.9, 0.76, 0.76),
      valueColor: REPORT_THEME.danger,
    };
  }
  if (tone === "warning") {
    return {
      backgroundColor: REPORT_THEME.warningSoft,
      borderColor: rgb(0.92, 0.86, 0.7),
      valueColor: REPORT_THEME.warning,
    };
  }
  if (tone === "neutral") {
    return {
      backgroundColor: REPORT_THEME.neutralSoft,
      borderColor: rgb(0.83, 0.87, 0.92),
      valueColor: rgb(0.24, 0.34, 0.42),
    };
  }
  return {
    backgroundColor: REPORT_THEME.accentSoft,
    borderColor: REPORT_THEME.border,
    valueColor: REPORT_THEME.accent,
  };
};

const drawBadgeStrip = (args: {
  pageRef: { current: any };
  pdfDoc: any;
  yRef: { current: number };
  boldFont: any;
  font: any;
  badges: ReportBadge[];
  onPageCreated?: (page: any) => void;
}) => {
  const badges = args.badges.filter((badge) => badge.value.trim().length > 0).slice(0, 4);
  if (!badges.length) return;

  const x = 44;
  const width = 512;
  const gap = 12;
  const height = 52;
  const cellWidth = (width - gap * (badges.length - 1)) / badges.length;

  ensureVerticalSpace({
    pageRef: args.pageRef,
    pdfDoc: args.pdfDoc,
    yRef: args.yRef,
    minHeight: height + 14,
    onPageCreated: args.onPageCreated,
  });

  const topY = args.yRef.current;
  const bottomY = topY - height;
  const page = args.pageRef.current;

  badges.forEach((badge, index) => {
    const palette = getBadgePalette(badge.tone);
    const boxX = x + index * (cellWidth + gap);
    page.drawRectangle({
      x: boxX,
      y: bottomY,
      width: cellWidth,
      height,
      color: palette.backgroundColor,
      borderColor: palette.borderColor,
      borderWidth: 1,
    });
    page.drawText(sanitizePdfText(badge.label, 24), {
      x: boxX + 12,
      y: topY - 16,
      size: 8.4,
      font: args.font,
      color: REPORT_THEME.muted,
    });
    page.drawText(sanitizePdfText(badge.value, 28), {
      x: boxX + 12,
      y: topY - 34,
      size: 11.3,
      font: args.boldFont,
      color: palette.valueColor,
    });
  });

  args.yRef.current = bottomY - 14;
};

const drawReportHero = (args: {
  pageRef: { current: any };
  pdfDoc: any;
  yRef: { current: number };
  boldFont: any;
  font: any;
  title: string;
  subtitle: string;
  metaLines: string[];
  onPageCreated?: (page: any) => void;
}) => {
  const x = 44;
  const width = 512;
  const height = 104;
  ensureVerticalSpace({
    pageRef: args.pageRef,
    pdfDoc: args.pdfDoc,
    yRef: args.yRef,
    minHeight: height + 12,
    onPageCreated: args.onPageCreated,
  });

  const page = args.pageRef.current;
  const topY = args.yRef.current;
  const bottomY = topY - height;

  page.drawRectangle({
    x,
    y: bottomY,
    width,
    height,
    color: REPORT_THEME.hero,
    borderColor: REPORT_THEME.hero,
    borderWidth: 1,
  });

  page.drawRectangle({
    x: x + width - 110,
    y: bottomY + 12,
    width: 90,
    height: 24,
    color: REPORT_THEME.accent,
  });
  page.drawText("DOCTOR REVIEW", {
    x: x + width - 100,
    y: bottomY + 20,
    size: 8.6,
    font: args.boldFont,
    color: rgb(1, 1, 1),
  });

  page.drawText(sanitizePdfText(args.title, 120), {
    x: x + 18,
    y: topY - 28,
    size: 22,
    font: args.boldFont,
    color: rgb(1, 1, 1),
  });
  page.drawText(sanitizePdfText(args.subtitle, 180), {
    x: x + 18,
    y: topY - 46,
    size: 10.8,
    font: args.font,
    color: REPORT_THEME.heroSoft,
  });

  let cursorY = topY - 68;
  for (const metaLine of args.metaLines.slice(0, 2)) {
    page.drawText(sanitizePdfText(metaLine, 220), {
      x: x + 18,
      y: cursorY,
      size: 10.2,
      font: args.font,
      color: rgb(0.96, 0.99, 0.98),
    });
    cursorY -= 14;
  }

  args.yRef.current = bottomY - 14;
};

const drawPageFooters = (args: {
  pdfDoc: any;
  font: any;
  boldFont: any;
}) => {
  const pages = args.pdfDoc.getPages();
  pages.forEach((page: any, index: number) => {
    const pageSize = page.getSize();
    page.drawLine({
      start: { x: 44, y: 34 },
      end: { x: pageSize.width - 44, y: 34 },
      thickness: 0.8,
      color: rgb(0.88, 0.92, 0.92),
    });
    page.drawText("Generated by CD4 AI Clinical Snapshot", {
      x: 44,
      y: 22,
      size: 8,
      font: args.font,
      color: REPORT_THEME.muted,
    });
    page.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: pageSize.width - 92,
      y: 22,
      size: 8,
      font: args.boldFont,
      color: REPORT_THEME.muted,
    });
  });
};

const buildPrescriptionStyleSnapshotPdfBytes = async (args: {
  patient: PatientSnapshot;
  doctorName: string;
  doctorSpecialization: string;
  slotLabel: string;
  concern: string;
  summary: string;
  triageSnapshot: TriageSnapshot;
  qaSnapshotLines: string[];
  chatTimelineLines: string[];
  reportId?: string | null;
}) => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const green = rgb(0.04, 0.47, 0.37);
  const lightGreen = rgb(0.92, 0.97, 0.95);
  const border = rgb(0.86, 0.9, 0.9);
  const dark = rgb(0.12, 0.16, 0.18);
  const muted = rgb(0.35, 0.42, 0.45);
  const white = rgb(1, 1, 1);

  const drawText = (text: string, x: number, y: number, size = 10, useBold = false, color = dark) => {
    page.drawText(sanitizePdfText(text), { x, y, size, font: useBold ? bold : font, color });
  };

  const drawBox = (x: number, y: number, w: number, h: number, fill = white, stroke = border) => {
    page.drawRectangle({ x, y, width: w, height: h, color: fill, borderColor: stroke, borderWidth: 1 });
  };

  const fitText = (value: string, maxWidth: number, size = 9, useBold = false): string => {
    const clean = sanitizePdfText(value || "");
    if (!clean) return "";
    const activeFont = useBold ? bold : font;
    if (activeFont.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
    let output = clean;
    while (output.length > 2 && activeFont.widthOfTextAtSize(`${output}...`, size) > maxWidth) {
      output = output.slice(0, -1);
    }
    return `${output}...`;
  };

  const wrap = (value: string, maxWidth: number, size = 9, useBold = false): string[] => {
    const words = sanitizePdfText(value).split(/\s+/).filter(Boolean);
    const activeFont = useBold ? bold : font;
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (activeFont.widthOfTextAtSize(next, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [""];
  };

  const drawBullets = (
    x: number,
    y: number,
    width: number,
    items: string[],
    maxItems = 4,
    size = 9,
    color = dark,
    minY = 0,
  ) => {
    let cursor = y;
    const rows = items.length ? items : ["Not clearly captured"];
    for (const item of rows.slice(0, maxItems)) {
      const wrapped = wrap(item, width - 10, size).slice(0, 2);
      drawText(`- ${wrapped[0] || "Not clearly captured"}`, x, cursor, size, false, color);
      cursor -= 13;
      if (wrapped[1] && cursor > minY) {
        drawText(`  ${wrapped[1]}`, x, cursor, size, false, color);
        cursor -= 13;
      }
      if (cursor <= minY) break;
    }
  };

  const drawCompactLines = (
    x: number,
    y: number,
    width: number,
    items: string[],
    maxItems = 5,
    size = 8.4,
    color = dark,
  ) => {
    let cursor = y;
    const rows = items.length ? items : ["No question-answer transcript captured."];
    rows.slice(0, maxItems).forEach((item) => {
      drawText(fitText(item, width, size), x, cursor, size, false, color);
      cursor -= 13;
    });
    if (rows.length > maxItems) {
      drawText(fitText(`+ ${rows.length - maxItems} more Q&A item(s) in chat history`, width, size), x, cursor, size, false, muted);
    }
  };

  const summaryLines = buildConciseClinicalSummaryLines(args.summary, 4).map((line) => line.replace(/^\d+\.\s*/, ""));
  const associatedSymptoms = args.triageSnapshot.associatedSymptoms.length
    ? args.triageSnapshot.associatedSymptoms.join(", ")
    : "Not clearly stated";
  const missingPoints = args.triageSnapshot.missingDataPoints.length
    ? args.triageSnapshot.missingDataPoints.join(", ")
    : "None";
  const redFlagText = /red-flag/i.test(args.triageSnapshot.riskNote)
    ? "Potential red-flag language detected"
    : "No red-flag language detected";
  const reportId = args.reportId || `AI-${Date.now()}`;

  // Header mirrors prescription PDF proportions.
  drawText("CD4", 34, 807, 24, true, green);
  drawText("Teleconsultation", 34, 792, 11, false, dark);
  page.drawRectangle({ x: 202, y: 790, width: 190, height: 28, color: green });
  drawText("AI SNAPSHOT", 257, 799, 13, true, white);
  drawText(`Date: ${new Date().toLocaleDateString("en-IN")}`, 410, 807, 10, false, dark);
  drawText(`Time: ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`, 410, 793, 10, false, dark);
  drawText(`Report ID: ${fitText(reportId, 110, 10)}`, 410, 779, 10, false, dark);

  // Doctor + patient card.
  drawBox(28, 675, 539, 104, white, border);
  drawText("DOCTOR DETAILS", 40, 760, 11, true, green);
  drawText(fitText(args.doctorName, 210, 14, true), 40, 742, 14, true, dark);
  drawText(fitText(args.doctorSpecialization || "General Medicine", 210, 10), 40, 726, 10, false, dark);
  drawText(`Appointment: ${fitText(args.slotLabel, 190, 10)}`, 40, 712, 10, false, muted);

  drawText("PATIENT DETAILS", 290, 760, 11, true, green);
  drawText(`Name: ${fitText(args.patient.name, 220, 11, true)}`, 290, 742, 11, false, dark);
  drawText(`Age / Gender: ${fitText(`${args.patient.age} / ${args.patient.gender}`, 180, 10)}`, 290, 726, 10, false, dark);
  drawText(`Phone: ${fitText(args.patient.phone, 170, 10)}`, 290, 712, 10, false, muted);

  // Clinical snapshot row.
  drawBox(28, 535, 539, 128, white, border);
  drawText("CHIEF CONCERN", 40, 645, 11, true, green);
  drawBullets(
    40,
    627,
    165,
    [
      args.triageSnapshot.chiefConcern,
      `Duration: ${args.triageSnapshot.duration}`,
      `Severity: ${args.triageSnapshot.severity}`,
    ],
    4,
    9,
    dark,
    548,
  );

  drawText("AI SUMMARY", 230, 645, 11, true, green);
  drawBullets(230, 627, 175, summaryLines, 4, 9, dark, 548);

  drawText("RISK / CONTEXT", 430, 645, 11, true, green);
  drawBullets(
    430,
    627,
    128,
    [
      redFlagText,
      `Data: ${args.triageSnapshot.captureScore}/${args.triageSnapshot.answeredTopics.length}`,
      `Missing: ${missingPoints}`,
    ],
    3,
    8.4,
    dark,
    548,
  );
  drawText(`Concern: ${fitText(args.concern, 500, 9)}`, 40, 560, 9, true, dark);
  drawText(`Symptoms: ${fitText(associatedSymptoms, 480, 9)}`, 40, 546, 9, false, dark);

  // Doctor quick-review table.
  drawText("DOCTOR QUICK REVIEW", 28, 515, 12, true, green);
  drawBox(28, 350, 539, 156, white, border);
  page.drawRectangle({ x: 29, y: 485, width: 537, height: 20, color: green });
  drawText("Field", 38, 491, 9, true, white);
  drawText("Captured Detail", 146, 491, 9, true, white);
  drawText("Doctor Action", 382, 491, 9, true, white);

  const reviewRows = [
    ["Concern", args.triageSnapshot.chiefConcern, "Confirm history"],
    ["Duration", args.triageSnapshot.duration, "Clarify onset"],
    ["Severity", args.triageSnapshot.severity, "Assess vitals"],
    ["Symptoms", associatedSymptoms, "Screen red flags"],
    ["Medicine / Allergy", args.triageSnapshot.medicationContext, "Verify before Rx"],
    ["Booking", args.triageSnapshot.bookingContext, "Proceed clinically"],
  ];
  let rowY = 468;
  reviewRows.forEach((row, index) => {
    if (index % 2 === 0) {
      page.drawRectangle({ x: 29, y: rowY - 13, width: 537, height: 22, color: rgb(0.98, 0.99, 0.99) });
    }
    drawText(fitText(row[0], 96, 8.8, true), 38, rowY, 8.8, index === 0, dark);
    drawText(fitText(row[1], 220, 8.8), 146, rowY, 8.8, false, dark);
    drawText(fitText(row[2], 150, 8.8), 382, rowY, 8.8, false, dark);
    rowY -= 22;
  });
  drawText("This AI snapshot supports clinical review and should be verified by the treating doctor.", 36, 357, 8.5, false, muted);

  // Short doctor-readable Q&A row.
  drawBox(28, 234, 539, 106, white, border);
  drawText("AI QUESTIONS & PATIENT ANSWERS", 40, 322, 11, true, green);
  drawText("Short transcript summary for quick doctor review.", 40, 307, 8.5, false, muted);
  drawCompactLines(40, 291, 500, args.qaSnapshotLines, 5, 8.3, dark);

  // Signature + declaration.
  drawText("AI-assisted summary for doctor review only. Not a diagnosis or prescription.", 28, 208, 9, false, muted);
  drawText(args.doctorName, 430, 194, 11, true, dark);
  drawText(args.doctorSpecialization || "Consultant Physician", 430, 182, 9, false, muted);

  // Doctor handoff notes.
  drawBox(28, 78, 539, 96, white, border);
  drawText("DOCTOR HANDOFF NOTES", 40, 158, 10, true, green);
  drawBullets(
    40,
    142,
    500,
    [
      "Verify patient-reported symptoms, duration, vitals, medicines, allergies, and red flags directly.",
      "Use this snapshot as a consultation aid before diagnosis, prescription, or referral.",
      `Patient vitals on profile: Weight ${args.patient.weight}, BP ${args.patient.bloodPressure}, Pulse ${args.patient.pulse}.`,
      `Address: ${args.patient.address}`,
    ],
    4,
    8.8,
    dark,
    88,
  );

  page.drawRectangle({ x: 0, y: 0, width: 595, height: 24, color: green });
  drawText("Your health. Our priority.", 244, 8, 9, true, white);

  return await pdf.save();
};

const buildFallbackPdfBytes = async (args: {
  patient: PatientSnapshot;
  doctorName: string;
  doctorSpecialization: string;
  slotLabel: string;
  concern: string;
  summary: string;
  triageSnapshot: TriageSnapshot;
  qaSnapshotLines: string[];
  chatTimelineLines: string[];
}) => {
  return await buildPrescriptionStyleSnapshotPdfBytes({
    ...args,
    reportId: `AI-${Date.now()}`,
  });
};

const uploadReportPdf = async (args: {
  serviceClient: any;
  appointmentId: string;
  patientId: string;
  pdfBytes: Uint8Array;
}) => {
  const fileName = `appointment_${args.appointmentId}_${Date.now()}.pdf`;
  const filePath = `${args.patientId}/${fileName}`;
  const { error: uploadError } = await args.serviceClient.storage
    .from("ai-reports")
    .upload(filePath, args.pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`ai_report_upload_failed: ${uploadError.message || uploadError}`);
  }

  return filePath;
};

const fetchHistoryFromConversation = async (args: {
  serviceClient: any;
  userId: string;
  conversationId: string;
}): Promise<{ concern: string | null; history: TriageHistoryItem[] }> => {
  if (!isUuid(args.conversationId)) return { concern: null, history: [] };

  const { data: conversation } = await args.serviceClient
    .from("ai_chat_conversations")
    .select("id, concern")
    .eq("id", args.conversationId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (!conversation?.id) {
    return { concern: null, history: [] };
  }

  const { data: messages } = await args.serviceClient
    .from("ai_chat_messages")
    .select("sender, text")
    .eq("conversation_id", conversation.id)
    .eq("user_id", args.userId)
    .order("created_at", { ascending: true })
    .limit(60);
 
  const history = normalizeHistory(
    (messages || []).map((row: any) => ({
      role: row?.sender === "ai" ? "assistant" : "user",
      content: clipText(typeof row?.text === "string" ? row.text : "", 420),
    })),
  );

  return {
    concern: typeof conversation?.concern === "string" ? conversation.concern : null,
    history,
  };
};

const fetchLatestHistoryForUser = async (args: {
  serviceClient: any;
  userId: string;
}): Promise<{ concern: string | null; history: TriageHistoryItem[] }> => {
  // Safety guard: only allow very recent chat fallback for booking PDF context.
  // This prevents attaching an older unrelated conversation to a new appointment.
  const recentFloorIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: conversation } = await args.serviceClient
    .from("ai_chat_conversations")
    .select("id, concern")
    .eq("user_id", args.userId)
    .gte("updated_at", recentFloorIso)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation?.id) return { concern: null, history: [] };
  return fetchHistoryFromConversation({
    serviceClient: args.serviceClient,
    userId: args.userId,
    conversationId: conversation.id,
  });
};

const normalizeInlineText = (value: string, maxLength: number = 160): string =>
  sanitizePdfText((value || "").replace(/\s+/g, " ").trim(), maxLength);

const isClinicalValueMissing = (value: string): boolean => {
  const text = (value || "").trim().toLowerCase();
  if (!text) return true;
  return (
    text.includes("not clearly stated") ||
    text.includes("not captured") ||
    text.includes("question asked, but answer not clearly captured") ||
    text.includes("awaiting clarity")
  );
};

const normalizeTranscriptNoise = (value: string): string =>
  String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[_*#`~]+/g, " ")
    .replace(/[|/]+/g, " ")
    .replace(/\b(umm+|uhh+|hmm+|matlab|like|you know)\b/gi, " ")
    .replace(/([a-z])\1{2,}/gi, "$1$1")
    .replace(/\s+/g, " ")
    .trim();

const splitClinicalClauses = (value: string): string[] =>
  normalizeTranscriptNoise(value)
    .split(/\s*(?:[,.!?;]+|\band\b|\baur\b|\blekin\b|\bbut\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);

const matchFirstPattern = (text: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = typeof match[1] === "string" && match[1].trim() ? match[1] : match[0];
    const normalized = normalizeInlineText(raw);
    if (normalized) return normalized;
  }
  return null;
};

const matchFirstPatternAcrossSegments = (text: string, patterns: RegExp[]): string | null => {
  const direct = matchFirstPattern(text, patterns);
  if (direct) return direct;
  for (const segment of splitClinicalClauses(text)) {
    const match = matchFirstPattern(segment, patterns);
    if (match) return match;
  }
  return null;
};

const CLINICAL_SYMPTOM_RULES: Array<{ regex: RegExp; label: string }> = [
  { regex: /\b(fever|bukhar|temperature|viral)\b/i, label: "Fever" },
  { regex: /\b(cough|khansi)\b/i, label: "Cough" },
  { regex: /\b(cold|sardi|runny nose)\b/i, label: "Cold symptoms" },
  { regex: /\b(headache|migraine|sir dard)\b/i, label: "Headache" },
  { regex: /\b(chest pain)\b/i, label: "Chest pain" },
  { regex: /\b(breath|breathing|saans|wheezing)\b/i, label: "Breathing issue" },
  { regex: /\b(stomach|pet|acidity|gas|abdomen)\b/i, label: "Stomach discomfort" },
  { regex: /\b(rash|allergy|itch|itching|fungal|eczema)\b/i, label: "Skin/allergy symptoms" },
  { regex: /\b(period|pregnan|pcos|pcod)\b/i, label: "Gyne-related concern" },
  { regex: /\b(bp|blood pressure|hypertension)\b/i, label: "Blood pressure concern" },
  { regex: /\b(sugar|diabet|glucose|thyroid)\b/i, label: "Sugar/diabetes concern" },
  { regex: /\b(nausea|vomit|vomiting)\b/i, label: "Nausea / vomiting" },
  { regex: /\b(diarrhea|loose motion|constipation)\b/i, label: "Bowel-related symptoms" },
  { regex: /\b(dizziness|vertigo|faint)\b/i, label: "Dizziness" },
];

const NEGATION_PATTERN = /\b(no|not|denies?|without|never|nahin|nahi|na|mat|none)\b/i;

const hasNegatedMatch = (text: string, regex: RegExp): boolean => {
  const source = String(text || "");
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(source)) !== null) {
    const start = Math.max(0, match.index - 28);
    const context = source.slice(start, match.index);
    if (NEGATION_PATTERN.test(context)) return true;
  }

  return false;
};

const extractAssociatedSymptoms = (text: string): string[] => {
  const combined = normalizeTranscriptNoise(text).toLowerCase();
  if (!combined.trim()) return [];
  const labels = CLINICAL_SYMPTOM_RULES
    .filter((entry) => entry.regex.test(combined) && !hasNegatedMatch(combined, entry.regex))
    .map((entry) => entry.label)
    .slice(0, 8);
  return Array.from(new Set(labels));
};

const extractMedicationMentions = (text: string): string[] => {
  const combined = normalizeTranscriptNoise(text).toLowerCase();
  const patterns = [
    /\b(?:tab|tablet|cap|capsule|syrup|drops|spray|inhaler|insulin|injection)\s+([a-z][a-z0-9+\/ -]{2,60})\b/gi,
    /\b([a-z][a-z0-9-]{2,40}(?:\s+[a-z0-9-]{1,20}){0,2})\s+(?:\d{2,4}\s*(?:mg|mcg|ml)|dose|tablet|tab|capsule|cap|syrup)\b/gi,
    /\b([a-z][a-z0-9-]{2,40})\s+(?:li hai|liya hai|le raha|le rahi|use kiya|use ki hai|started|continue kar raha)\b/gi,
  ];

  const found: string[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(combined)) !== null) {
      const candidate = normalizeInlineText(match[1] || "", 80);
      if (!candidate) continue;
      if (/\b(no|not|nahi|nahin|none)\b/i.test(candidate)) continue;
      found.push(candidate);
    }
  }

  return Array.from(new Set(found)).slice(0, 3);
};

const extractMedicationContext = (text: string): string => {
  const combined = normalizeTranscriptNoise(text).toLowerCase();
  if (!combined.trim()) return "Not captured from chat.";
  const explicitNoMeds =
    matchFirstPattern(combined, [
      /\b(no medicine[s]?|not taking any medicine[s]?|not on any medicine[s]?|nahi koi medicine|nahi koi dawa|nahi le raha|nahi le rha|koi medicine nahi)\b/i,
    ]);
  if (explicitNoMeds) return "Patient said no current medicines were being taken.";

  const medsMentioned = matchFirstPattern(combined, [
    /\b(taking|using|on)\s+([a-z0-9,\s-]{3,80})/i,
    /\b(medicine|medication|tablet|dawai|dava)\s*[:\-]?\s*([a-z0-9,\s-]{3,80})/i,
  ]);
  const deniedAllergy =
    /\b(no allergy|not allergic|allergy nahi|allergy nahin|koi allergy nahi|drug allergy nahi)\b/i.test(combined);
  const medicationMentions = extractMedicationMentions(combined);
  if (medsMentioned || medicationMentions.length > 0) {
    const medText = medsMentioned || medicationMentions.join(", ");
    return deniedAllergy
      ? `Patient reported medicine use (${medText}) and denied drug allergy.`
      : `Patient reported medicine use (${medText}).`;
  }

  if (deniedAllergy) return "Patient denied known drug allergy.";
  const allergyMentioned = /\b(allergy|allergic)\b/i.test(combined) && !hasNegatedMatch(combined, /\b(allergy|allergic)\b/i);
  if (allergyMentioned) return "Patient mentioned allergy context.";

  return "Medicine/allergy context not clearly stated.";
};

const extractTriageSnapshot = (args: {
  concern: string;
  history: TriageHistoryItem[];
}): TriageSnapshot => {
  const history = Array.isArray(args.history) ? args.history : [];
  const userLines = history.filter((item) => item.role === "user").map((item) => item.content);
  const assistantLines = history.filter((item) => item.role === "assistant").map((item) => item.content);
  const combinedUser = normalizeTranscriptNoise(userLines.join(" "));
  const combinedAssistant = assistantLines.join(" ").toLowerCase();
  const combinedLower = combinedUser.toLowerCase();

  const duration =
    matchFirstPatternAcrossSegments(combinedUser, [
      /\b((?:for|since)\s+[a-z0-9\s]{1,30})\b/i,
      /\b(last\s+\d+\s*(?:hour|hours|hr|hrs|day|days|week|weeks|month|months|year|years))\b/i,
      /\b(\d+\s*(?:day|days|week|weeks|month|months|year|years|din|hafte|hafta|mahina|mahine|saal))\b/i,
      /\b(\d+\s*(?:hour|hours|hr|hrs|min|mins|minute|minutes|ghanta|ghante))\b/i,
      /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|week|weeks|month|months|year|years)\b/i,
      /\b(kal se|aaj se|subah se|raat se)\b/i,
    ]) || "Not clearly stated";

  const severity =
    matchFirstPatternAcrossSegments(combinedUser, [
      /\b(([1-9]|10)\s*\/\s*10)\b/i,
      /\b(mild|moderate|severe)\b/i,
      /\b([1-9]|10)\s*(?:out of|\/)\s*10\b/i,
      /\b(bahut zyada|zyada|high|intense)\b/i,
      /\b(light|kam|thoda)\b/i,
      /\b(unbearable|worst|getting worse|bohot zyada)\b/i,
    ]) || "Not clearly stated";

  const associatedSymptoms = extractAssociatedSymptoms(combinedUser);
  const medicationContext = extractMedicationContext(combinedUser);

  const emergencyFlag = /\b(chest pain|difficulty breathing|shortness of breath|faint|unconscious|stroke|severe bleeding)\b/i.test(
    combinedLower,
  );
  const riskNote = emergencyFlag
    ? "Emergency red-flag language was detected in patient messages."
    : "No explicit emergency red-flag language detected in captured context.";

  const bookingContext =
    history.length > 0
      ? "Appointment booking was supported by chat / AI context."
      : "Appointment appears to have been booked directly from the app without attached chat history.";

  const chiefConcern =
    args.concern ||
    normalizeInlineText(userLines[userLines.length - 1] || "General consultation request", 120) ||
    "General consultation";

  const answeredTopics: Array<{ label: string; value: string }> = [
    { label: "Onset / Duration", value: duration },
    { label: "Severity", value: severity },
    {
      label: "Associated Symptoms",
      value: associatedSymptoms.length ? associatedSymptoms.join(", ") : "Not clearly stated",
    },
    { label: "Medicine / Allergy Context", value: medicationContext },
  ];

  if (/when did|how long|kab se/.test(combinedAssistant) && duration === "Not clearly stated") {
    answeredTopics[0].value = "Question asked, but answer not clearly captured.";
  }
  if (/(severity|1-10|pain scale|kitna severe|kitni severity)/.test(combinedAssistant) && severity === "Not clearly stated") {
    answeredTopics[1].value = "Question asked, but answer not clearly captured.";
  }
  if (/(associated symptom|any other symptom|fever|cough|itching|aur koi symptom)/.test(combinedAssistant) && answeredTopics[2].value === "Not clearly stated") {
    answeredTopics[2].value = "Question asked, but answer not clearly captured.";
  }
  if (/(medicine|medication|tablet|allergy|dawai|dava)/.test(combinedAssistant) && isClinicalValueMissing(medicationContext)) {
    answeredTopics[3].value = "Question asked, but answer not clearly captured.";
  }

  const missingDataPoints = answeredTopics
    .filter((item) => isClinicalValueMissing(item.value))
    .map((item) => item.label);

  if (!history.length) {
    missingDataPoints.unshift("Chat-backed clinical triage");
  }

  const captureScore = Math.max(0, answeredTopics.length - missingDataPoints.filter((item) => item !== "Chat-backed clinical triage").length);

  return {
    chiefConcern,
    duration,
    severity,
    associatedSymptoms,
    medicationContext,
    riskNote,
    bookingContext,
    answeredTopics,
    missingDataPoints,
    captureScore,
  };
};

const buildHeuristicSummary = (args: {
  concern: string;
  history: TriageHistoryItem[];
}): string => {
  const snapshot = extractTriageSnapshot(args);
  const lines = [
    `Chief concern: ${snapshot.chiefConcern}.`,
    `Onset/Duration: ${snapshot.duration}.`,
    `Severity: ${snapshot.severity}.`,
    `Associated symptoms: ${snapshot.associatedSymptoms.length ? snapshot.associatedSymptoms.join(", ") : "Not clearly stated"}.`,
    `Clinical context: ${snapshot.medicationContext}`,
    `Booking context: ${snapshot.bookingContext}`,
    `Risk note: ${snapshot.riskNote}`,
  ];
  return lines.join(" ");
};

const parseSeverityScore = (severity: string): number | null => {
  const text = (severity || "").toLowerCase();
  const numericMatch = text.match(/\b(10|[1-9])\b/);
  if (numericMatch) return Number(numericMatch[1]);
  if (text.includes("severe")) return 8;
  if (text.includes("moderate")) return 5;
  if (text.includes("mild")) return 2;
  return null;
};

const buildSeverityBadge = (severity: string): ReportBadge => {
  const score = parseSeverityScore(severity);
  if (score === null) {
    return { label: "Severity", value: "Awaiting clarity", tone: "neutral" };
  }
  if (score >= 7) {
    return { label: "Severity", value: clipText(severity, 26), tone: "danger" };
  }
  if (score >= 4) {
    return { label: "Severity", value: clipText(severity, 26), tone: "warning" };
  }
  return { label: "Severity", value: clipText(severity, 26), tone: "success" };
};

const buildUrgencyBadge = (riskNote: string): ReportBadge =>
  /red-flag/i.test(riskNote)
    ? { label: "Urgency", value: "Urgent review", tone: "danger" }
    : { label: "Urgency", value: "Routine review", tone: "success" };

const buildCaptureCompletenessBadge = (snapshot: TriageSnapshot): ReportBadge => {
  const resolvedMissing = snapshot.missingDataPoints.filter((item) => item !== "Chat-backed clinical triage").length;
  if (resolvedMissing === 0) {
    return { label: "Capture Status", value: "Complete", tone: "success" };
  }
  if (resolvedMissing <= 2) {
    return { label: "Capture Status", value: "Needs follow-up", tone: "warning" };
  }
  return { label: "Capture Status", value: "Limited data", tone: "danger" };
};

const TRIAGE_SLOT_LABELS: Record<"onset" | "severity" | "associated" | "medicationContext", string> = {
  onset: "Onset / Duration",
  severity: "Severity",
  associated: "Associated Symptoms",
  medicationContext: "Medicine / Allergy Context",
};

const ENGLISH_TRIAGE_SLOT_QUESTIONS: Record<"onset" | "severity" | "associated" | "medicationContext", string> = {
  onset: "When did the main symptom begin, and is it still ongoing?",
  severity: "How severe is the problem right now?",
  associated: "What other symptoms are happening along with this?",
  medicationContext: "What medicines have been taken already, and are there any allergies or relevant conditions?",
};

const QUESTION_PROMPT_PATTERNS: RegExp[] = [
  /\?/,
  /\b(please tell|tell me|choose|select|confirm|which|would you like|do you want|can you share|can you tell)\b/i,
  /\b(kya|kaun|kaunsa|kab|kitna|kitni|batao|bataye|chuniye|select kijiye)\b/i,
];

const isAssistantQuestionLike = (value: string): boolean =>
  QUESTION_PROMPT_PATTERNS.some((pattern) => pattern.test(value || ""));

const BOOKING_OR_SELECTION_PATTERN =
  /\b(doctor|dr\.?|physician|consult|consultation|slot|appointment|book|booking|available slots?|choose a doctor|select a doctor|which doctor|doctor you want|choose a slot|select a slot|kaun se doctor|kaunsa slot|clinic|hospital|fee|experience|patna|delhi)\b/i;

const HEALTH_QA_PATTERN =
  /\b(symptom|pain|ache|fever|temperature|cough|cold|breath|breathing|chest|headache|migraine|stomach|abdomen|vomit|nausea|loose motion|diarrhea|urine|burning|period|pregnan|bp|blood pressure|pulse|sugar|diabetes|rash|itch|swelling|injury|fracture|bleeding|wound|medicine|medication|tablet|allergy|severity|duration|onset|red flag|bukhar|khansi|dard|saans|ulti|dawai|dava|kab se|kitne din|kitni der)\b/i;

const isBookingOrSelectionText = (value: string): boolean =>
  BOOKING_OR_SELECTION_PATTERN.test(value || "");

const isHealthQaPair = (question: string, answer: string): boolean => {
  const combined = `${question} ${answer}`;
  if (isBookingOrSelectionText(question)) return false;
  if (isBookingOrSelectionText(answer) && !HEALTH_QA_PATTERN.test(answer)) return false;
  return HEALTH_QA_PATTERN.test(combined);
};

const cleanQuestionCandidate = (value: string, maxLength: number = 180): string =>
  normalizeInlineText(
    (value || "")
      .replace(/[#*_`>]+/g, " ")
      .replace(/^\s*(?:[-]|\d+[.)])\s*/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    maxLength,
  );

const toProfessionalEnglishAnswer = (value: string): string => {
  let text = normalizeInlineText(normalizeTranscriptNoise(value), 220);
  if (!text) return "Answer not clearly captured before booking.";

  const replacements: Array<[RegExp, string]> = [
    [/\bhaan\b/gi, "yes"],
    [/\bhan\b/gi, "yes"],
    [/\bnahi\b/gi, "no"],
    [/\bnahin\b/gi, "no"],
    [/\bbukhar\b/gi, "fever"],
    [/\bkhansi\b/gi, "cough"],
    [/\bsaans\b/gi, "breathing"],
    [/\bpet dard\b/gi, "stomach pain"],
    [/\bpait dard\b/gi, "stomach pain"],
    [/\bdard\b/gi, "pain"],
    [/\bulti\b/gi, "vomiting"],
    [/\bsubah se\b/gi, "since morning"],
    [/\bkal raat se\b/gi, "since last night"],
    [/\baaj se\b/gi, "since today"],
    [/\bzyada\b/gi, "more"],
    [/\bthoda\b/gi, "mild"],
    [/\bbaar baar urine\b/gi, "frequent urination"],
    [/\bpyaas\b/gi, "thirst"],
    [/\bpet\b/gi, "stomach"],
    [/\bsaath me\b/gi, "along with"],
    [/\bchal raha hai\b/gi, "has been continuing"],
    [/\bho raha hai\b/gi, "is happening"],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/\s+/g, " ").trim();
  if (!/[.?!]$/.test(text)) text = `${text}.`;
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const extractPromptSegment = (value: string): string => {
  const match = cleanQuestionCandidate(value, 300).match(
    /((?:please tell|tell me|choose|select|confirm|which|would you like|do you want|can you share|can you tell|kya|kaun|kaunsa|kab|kitna|kitni|batao|bataye|chuniye|select kijiye)[^.!?]{0,180}[.!?]?)/i,
  );
  return match?.[1] ? cleanQuestionCandidate(match[1], 180) : cleanQuestionCandidate(value, 180);
};

const buildQuestionFingerprint = (value: string): string =>
  sanitizePdfText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractQuestionText = (value: string): string => {
  const originalLines = sanitizePdfText(value || "", 1200)
    .split(/\n+/)
    .map((line) => cleanQuestionCandidate(line, 220))
    .filter(Boolean);

  const promptLine = originalLines.find((line) =>
    QUESTION_PROMPT_PATTERNS.slice(1).some((pattern) => pattern.test(line)),
  );
  if (promptLine) {
    return extractPromptSegment(promptLine);
  }

  const compact = cleanQuestionCandidate((value || "").replace(/\s+/g, " "), 220);
  if (!compact) return "";
  const questionMatches = compact.match(/[^?]{4,160}\?/g) || [];
  if (questionMatches.length > 0) {
    return cleanQuestionCandidate(questionMatches.slice(0, 3).join(" "), 190);
  }
  return cleanQuestionCandidate(compact, 180);
};

const findNearestUserAnswer = (
  history: TriageHistoryItem[],
  questionIndex: number,
  maxLookAhead: number = 6,
): string => {
  const fragments: string[] = [];
  for (
    let index = questionIndex + 1;
    index < history.length && index <= questionIndex + maxLookAhead;
    index += 1
  ) {
    const item = history[index];
    if (!item || typeof item.content !== "string") continue;

    if (item.role === "user" && item.content.trim()) {
      fragments.push(normalizeInlineText(item.content, 120));
      const joined = fragments.join(" ");
      if (joined.split(/\s+/).length >= 5 || /[.?!]|\/10\b|\b(no|yes|nahi|haan)\b/i.test(joined)) {
        return toProfessionalEnglishAnswer(joined);
      }
      continue;
    }

    if (item.role === "assistant" && index > questionIndex + 1 && /\?/.test(item.content)) {
      break;
    }
  }
  return fragments.length
    ? toProfessionalEnglishAnswer(fragments.join(" "))
    : "Answer not clearly captured before booking.";
};

const buildVoiceChatQaSnapshotLines = (historyInput: TriageHistoryItem[], concernText: string, maxPairs: number = 6): string[] => {
  const history = Array.isArray(historyInput) ? historyInput : [];
  if (!history.length) {
    return ["No AI/voice chat transcript attached for this booking."];
  }

  const pairs: ChatQaPair[] = [];
  const seen = new Set<string>();
  const seenSlots = new Set<string>();

  for (let questionIndex = 0; questionIndex < history.length && pairs.length < maxPairs; questionIndex += 1) {
    const item = history[questionIndex];
    if (item.role !== "assistant" || typeof item.content !== "string" || !item.content.includes("?")) continue;

    const normalizedQuestion = normalizeInlineText(item.content || "", 400).toLowerCase();
    const slot = (Object.keys(ENGLISH_TRIAGE_SLOT_QUESTIONS) as Array<keyof typeof ENGLISH_TRIAGE_SLOT_QUESTIONS>).find((candidate) => {
      const keywords: Record<keyof typeof ENGLISH_TRIAGE_SLOT_QUESTIONS, string[]> = {
        onset: ["when did", "since when", "started", "how long"],
        severity: ["how severe", "1 to 10", "intensity", "severity"],
        associated: ["other symptoms", "along with", "associated"],
        medicationContext: ["medicines", "allergies", "ongoing conditions"],
      };
      return keywords[candidate].some((keyword) => normalizedQuestion.includes(keyword));
    }) || null;
    if (!slot || seenSlots.has(slot)) continue;

    const rawQuestion = ENGLISH_TRIAGE_SLOT_QUESTIONS[slot] || extractQuestionText(item.content || "");
    if (!rawQuestion) continue;
    const answer = findNearestUserAnswer(history, questionIndex);
    if (!isHealthQaPair(rawQuestion, answer)) continue;
    const fingerprint = buildQuestionFingerprint(`${slot}:${rawQuestion}`);
    if (!fingerprint || seen.has(fingerprint)) continue;

    seen.add(fingerprint);
    seenSlots.add(slot);
    pairs.push({
      question: `${TRIAGE_SLOT_LABELS[slot]}: ${rawQuestion}`,
      answer,
      source: "priority",
    });
  }

  for (let index = 0; index < history.length && pairs.length < maxPairs; index += 1) {
    const item = history[index];
    if (item.role !== "assistant" || !isAssistantQuestionLike(item.content || "")) continue;

    const question = extractQuestionText(item.content || "");
    if (!question) continue;
    const answer = findNearestUserAnswer(history, index);
    if (!isHealthQaPair(question, answer)) continue;
    const fingerprint = buildQuestionFingerprint(question);
    if (!fingerprint || seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    pairs.push({
      question,
      answer,
      source: "chat",
    });
  }

  if (!pairs.length) {
    const patientNotes = history
      .filter((item) => {
        if (item.role !== "user") return false;
        const text = normalizeInlineText(item.content, 120);
        return HEALTH_QA_PATTERN.test(text) && !isBookingOrSelectionText(text);
      })
      .slice(-4)
      .map((item, idx) => `Patient note ${idx + 1}: ${toProfessionalEnglishAnswer(item.content)}`);

    return patientNotes.length
      ? patientNotes
      : ["No health-related question-answer captured before booking."];
  }

  return pairs.slice(0, maxPairs).map((pair, idx) => {
    const question = normalizeInlineText(pair.question, 88);
    const answer = normalizeInlineText(pair.answer, 96);
    return `Q${idx + 1}: ${question} | Patient: ${answer}`;
  });
};

const buildAiChatTimelineLines = (historyInput: TriageHistoryItem[], maxLines: number = 8): string[] => {
  const history = Array.isArray(historyInput) ? historyInput : [];
  if (!history.length) {
    return ["No AI/voice chat transcript attached for this booking."];
  }

  const compact = history
    .slice(-Math.max(2, maxLines))
    .map((item, idx) => {
      const speaker = item.role === "assistant" ? "AI" : "Patient";
      const text = normalizeInlineText(item.content, 180);
      return `${idx + 1}. ${speaker}: ${text}`;
    })
    .filter((line) => line.trim().length > 0);

  return compact.length ? compact : ["Transcript was present but no readable lines were captured."];
};

const buildConciseClinicalSummaryLines = (summaryText: string, maxLines: number = 5): string[] => {
  const normalized = sanitizePdfText(summaryText, 1400);
  if (!normalized) {
    return ["Clinical summary could not be generated from the attached transcript."];
  }

  const sentenceChunks = normalized
    .split(/[.!?]+\s+/)
    .map((chunk) => normalizeInlineText(chunk, 220))
    .filter((chunk) => chunk.length > 0);

  if (!sentenceChunks.length) {
    return [normalizeInlineText(normalized, 240)];
  }

  return sentenceChunks.slice(0, Math.max(1, maxLines)).map((line, index) => `${index + 1}. ${line}`);
};

type ClinicalTopicRule = {
  key: string;
  label: string;
  keywords: string[];
  specialtyTokens: string[];
  recommendedSpecialties: string[];
};

type ClinicalTopicHit = {
  key: string;
  label: string;
  score: number;
  matchedKeywords: string[];
  specialtyTokens: string[];
  recommendedSpecialties: string[];
};

const CLINICAL_TOPIC_RULES: ClinicalTopicRule[] = [
  {
    key: "diabetes_endocrine",
    label: "Diabetes / Endocrine",
    keywords: ["diabetes", "diabetic", "sugar", "glucose", "insulin", "hba1c", "thyroid", "hormone"],
    specialtyTokens: ["diabet", "endocr", "internal", "general", "physician"],
    recommendedSpecialties: ["Endocrinology", "Diabetology", "General Medicine"],
  },
  {
    key: "fever_infection",
    label: "Fever / Infection",
    keywords: ["fever", "bukhar", "viral", "infection", "temperature", "chills", "body ache"],
    specialtyTokens: ["general", "internal", "physician", "infect", "pediatric"],
    recommendedSpecialties: ["General Medicine", "Internal Medicine", "Infectious Disease"],
  },
  {
    key: "cardiac_bp",
    label: "Cardiac / BP",
    keywords: ["heart", "chest pain", "cardio", "bp", "blood pressure", "palpitation"],
    specialtyTokens: ["cardio", "internal", "general", "physician"],
    recommendedSpecialties: ["Cardiology", "Internal Medicine", "General Medicine"],
  },
  {
    key: "respiratory",
    label: "Respiratory",
    keywords: ["cough", "breath", "breathing", "asthma", "respiratory", "saans", "wheezing"],
    specialtyTokens: ["pulmo", "respir", "general", "internal", "physician"],
    recommendedSpecialties: ["Pulmonology", "General Medicine"],
  },
  {
    key: "dermatology",
    label: "Skin / Allergy",
    keywords: ["skin", "rash", "allergy", "itch", "eczema", "fungal", "acne"],
    specialtyTokens: ["derma", "skin", "general", "physician"],
    recommendedSpecialties: ["Dermatology", "General Medicine"],
  },
  {
    key: "gastro",
    label: "Gastrointestinal",
    keywords: ["stomach", "acidity", "gas", "digestion", "abdomen", "nausea", "vomit", "diarrhea", "constipation"],
    specialtyTokens: ["gastro", "general", "internal", "physician"],
    recommendedSpecialties: ["Gastroenterology", "General Medicine"],
  },
  {
    key: "neuro",
    label: "Neuro / Headache",
    keywords: ["headache", "migraine", "dizziness", "vertigo", "seizure", "numbness", "stroke"],
    specialtyTokens: ["neuro", "general", "internal", "physician"],
    recommendedSpecialties: ["Neurology", "General Medicine"],
  },
  {
    key: "ortho",
    label: "Ortho / Joint",
    keywords: ["joint", "knee", "back pain", "bone", "fracture", "spine", "shoulder", "ankle"],
    specialtyTokens: ["ortho", "orthop", "bone", "general", "physician"],
    recommendedSpecialties: ["Orthopedics", "General Medicine"],
  },
  {
    key: "gyne",
    label: "Gyne / Women's Health",
    keywords: ["period", "pregnancy", "pcos", "pcod", "women health", "gyn", "gyne", "obstetric"],
    specialtyTokens: ["gyn", "gyne", "obstet", "women", "general", "physician"],
    recommendedSpecialties: ["Gynecology", "Obstetrics"],
  },
  {
    key: "pediatrics",
    label: "Child Health",
    keywords: ["child", "kids", "newborn", "baby", "infant", "pediatric", "paediatric"],
    specialtyTokens: ["pediatric", "paediatric", "child", "general", "physician"],
    recommendedSpecialties: ["Pediatrics"],
  },
  {
    key: "mental_health",
    label: "Mental Health",
    keywords: ["anxiety", "depression", "panic", "stress", "sleep issue", "mental health", "mood"],
    specialtyTokens: ["psych", "mental", "general", "physician"],
    recommendedSpecialties: ["Psychiatry", "Psychology"],
  },
  {
    key: "ent",
    label: "ENT",
    keywords: ["ear", "nose", "throat", "sinus", "tonsil", "hearing"],
    specialtyTokens: ["ent", "ear", "nose", "throat", "general", "physician"],
    recommendedSpecialties: ["ENT"],
  },
  {
    key: "renal_urinary",
    label: "Kidney / Urinary",
    keywords: ["kidney", "urine", "urinary", "uti", "burning urination", "creatinine"],
    specialtyTokens: ["nephro", "uro", "kidney", "general", "physician"],
    recommendedSpecialties: ["Nephrology", "Urology"],
  },
];

const detectClinicalTopicHits = (combinedText: string): ClinicalTopicHit[] => {
  const text = (combinedText || "").toLowerCase();
  if (!text.trim()) return [];

  const hits: ClinicalTopicHit[] = [];
  for (const rule of CLINICAL_TOPIC_RULES) {
    const matchedKeywords = rule.keywords.filter((keyword) => text.includes(keyword));
    if (!matchedKeywords.length) continue;

    hits.push({
      key: rule.key,
      label: rule.label,
      score: matchedKeywords.length,
      matchedKeywords,
      specialtyTokens: rule.specialtyTokens,
      recommendedSpecialties: rule.recommendedSpecialties,
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, 3);
};

const buildSpecialtyAlignmentNote = (args: {
  doctorSpecialization: string;
  topicHits: ClinicalTopicHit[];
}): {
  message: string;
  recommendedSpecialties: string[];
} => {
  const specialization = (args.doctorSpecialization || "").toLowerCase();
  const topicHits = Array.isArray(args.topicHits) ? args.topicHits : [];

  if (!topicHits.length) {
    return {
      message: "No strong specialty signal detected from current chat context.",
      recommendedSpecialties: ["General Medicine"],
    };
  }

  const top = topicHits[0];
  const directAligned = top.specialtyTokens.some((token) => specialization.includes(token));
  if (directAligned) {
    return {
      message: `${top.label} concern detected and aligned with booked specialty.`,
      recommendedSpecialties: top.recommendedSpecialties,
    };
  }

  const secondaryAligned = topicHits
    .slice(1)
    .some((hit) => hit.specialtyTokens.some((token) => specialization.includes(token)));
  if (secondaryAligned) {
    return {
      message: "Partial alignment detected with secondary clinical topic from chat.",
      recommendedSpecialties: top.recommendedSpecialties,
    };
  }

  return {
    message: `${top.label} appears dominant in chat. Consider specialty follow-up if clinically indicated.`,
    recommendedSpecialties: top.recommendedSpecialties,
  };
};

const ensureAppointmentTriageReport = async (args: {
  serviceClient: any;
  appointment: any;
  body: any;
  patientProfile: any;
  doctorMeta?: any;
}): Promise<{
  reportId: string | null;
  pdfPath: string | null;
  summary: string | null;
  source: "existing" | "generated" | "none";
}> => {
  const existingReportId = typeof args.appointment?.ai_report_id === "string" ? args.appointment.ai_report_id : null;
  const { data: existingReport } = existingReportId
    ? await args.serviceClient
        .from("ai_triage_reports")
        .select("id, concern, chat_history, summary, pdf_url")
        .eq("id", existingReportId)
        .maybeSingle()
    : { data: null as any };
  const canUpdateExistingReport = Boolean(existingReportId && existingReport?.id);

  const payloadHistory = normalizeHistory(args.body?.history);
  const existingReportHistory = normalizeHistory(existingReport?.chat_history);
  const payloadConcern = normalizeConcern(args.body?.concern);
  const payloadConversationId =
    typeof args.body?.conversationId === "string" && isUuid(args.body.conversationId.trim())
      ? args.body.conversationId.trim()
      : null;

  let concern = payloadConcern || normalizeConcern(existingReport?.concern);
  let history = choosePreferredHistory(payloadHistory, existingReportHistory);

  if (
    payloadHistory.length > 0 &&
    !payloadHistory.some((item) => item.role === "user" && item.content.trim().length > 0) &&
    existingReportHistory.some((item) => item.role === "user" && item.content.trim().length > 0)
  ) {
    history = existingReportHistory;
  }

  if (!history.length && payloadConversationId) {
    const fromConversation = await fetchHistoryFromConversation({
      serviceClient: args.serviceClient,
      userId: args.appointment.patient_id,
      conversationId: payloadConversationId,
    });
    if (fromConversation.history.length) {
      history = choosePreferredHistory(history, fromConversation.history);
    }
    if (!concern && fromConversation.concern) {
      concern = normalizeConcern(fromConversation.concern);
    }
  }

  if (!history.length) {
    const fromLatest = await fetchLatestHistoryForUser({
      serviceClient: args.serviceClient,
      userId: args.appointment.patient_id,
    });
    if (fromLatest.history.length) {
      history = choosePreferredHistory(history, fromLatest.history);
    }
    if (!concern && fromLatest.concern) {
      concern = normalizeConcern(fromLatest.concern);
    }
  }

  if (!concern) {
    concern = "General consultation";
  }

  const structuredSummary = buildHeuristicSummary({ concern, history });
  const existingSummaryText =
    typeof existingReport?.summary === "string" && existingReport.summary.trim()
      ? normalizeInlineText(existingReport.summary.trim(), 520)
      : "";
  const summary = clipText(
    [structuredSummary, existingSummaryText ? `Prior AI summary note: ${existingSummaryText}` : ""]
      .filter(Boolean)
      .join(" "),
    1200,
  );

  const patient = resolvePatientSnapshot(args.patientProfile);

  const doctorProfile = Array.isArray(args.doctorMeta?.profiles) ? args.doctorMeta.profiles[0] : args.doctorMeta?.profiles;
  const doctorName = doctorProfile?.first_name
    ? `Dr. ${doctorProfile.first_name}${doctorProfile?.last_name ? ` ${doctorProfile.last_name}` : ""}`
    : "Booked Doctor";
  const doctorSpecialization = clipText(
    typeof args.doctorMeta?.specialization === "string" && args.doctorMeta.specialization.trim()
      ? args.doctorMeta.specialization.trim()
      : "General Medicine",
    80,
  );

  const slot = args.appointment?.slot as { date?: string | null; start_time?: string | null; end_time?: string | null } | null;
  const slotLabel = formatSlotLabel(slot?.date || null, slot?.start_time || null);
  const triageSnapshot = extractTriageSnapshot({ concern, history });
  const qaSnapshotLines = buildVoiceChatQaSnapshotLines(history, concern, 4);
  const aiChatTimelineLines = buildAiChatTimelineLines(history, 6);

  let pdfBytes: Uint8Array | null = null;
  try {
    pdfBytes = await buildPrescriptionStyleSnapshotPdfBytes({
      patient,
      doctorName,
      doctorSpecialization,
      slotLabel,
      concern,
      summary,
      triageSnapshot,
      qaSnapshotLines,
      chatTimelineLines: aiChatTimelineLines,
      reportId: existingReportId || args.appointment.id,
    });
  } catch (richPdfError) {
    console.warn("Primary PDF rendering failed, using fallback PDF renderer:", richPdfError);
    pdfBytes = await buildFallbackPdfBytes({
      patient,
      doctorName,
      doctorSpecialization,
      slotLabel,
      concern,
      summary,
      triageSnapshot,
      qaSnapshotLines,
      chatTimelineLines: aiChatTimelineLines,
    });
  }

  if (!pdfBytes) {
    throw new Error("ai_report_pdf_bytes_missing");
  }

  const pdfPath = await uploadReportPdf({
    serviceClient: args.serviceClient,
    appointmentId: args.appointment.id,
    patientId: args.appointment.patient_id,
    pdfBytes,
  });

  let report: any = null;
  let reportError: any = null;

  if (canUpdateExistingReport) {
    const updateResult = await args.serviceClient
      .from("ai_triage_reports")
      .update({
        concern,
        chat_history: history,
        summary,
        pdf_url: pdfPath,
      })
      .eq("id", existingReportId)
      .eq("patient_id", args.appointment.patient_id)
      .select("id, pdf_url, summary")
      .single();
    report = updateResult.data;
    reportError = updateResult.error;
  } else {
    const insertResult = await args.serviceClient
      .from("ai_triage_reports")
      .insert({
        patient_id: args.appointment.patient_id,
        concern,
        chat_history: history,
        summary,
        pdf_url: pdfPath,
      })
      .select("id, pdf_url, summary")
      .single();
    report = insertResult.data;
    reportError = insertResult.error;
  }

  if (reportError || !report?.id) {
    throw new Error(`ai_report_insert_failed: ${reportError?.message || "unknown"}`);
  }

  if (args.appointment?.ai_report_id !== report.id) {
    const { data: linkedAppointment, error: attachError } = await args.serviceClient
      .from("appointments")
      .update({ ai_report_id: report.id })
      .eq("id", args.appointment.id)
      .eq("patient_id", args.appointment.patient_id)
      .select("id, ai_report_id")
      .maybeSingle();

    if (attachError) {
      throw new Error(`appointment_report_link_failed: ${attachError.message || attachError}`);
    }

    if (!linkedAppointment?.id || linkedAppointment.ai_report_id !== report.id) {
      throw new Error("appointment_report_link_failed: appointment did not retain the generated ai_report_id");
    }
  }

  return {
    reportId: report.id,
    pdfPath: report.pdf_url || pdfPath,
    summary: report.summary || summary,
    source: canUpdateExistingReport ? "existing" : "generated",
  };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return jsonResponse({ success: false, skipped: true, reason: "service_env_missing" }, 500);
    }
    const requestIp = getRequestIp(req);

    const body = await safeJsonParse(req);
    const appointmentId =
      typeof body?.appointmentId === "string" && body.appointmentId.trim()
        ? body.appointmentId.trim()
        : "";

    if (!appointmentId) {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "missing_appointment_id",
      });
    }

    const accessToken = extractBearerToken(req);
    if (!accessToken) {
      await logSecurityEvent(serviceClient, {
        eventType: "appointment_notification_missing_token",
        severity: "warn",
        ip: requestIp,
        context: { appointmentId },
      });
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "missing_bearer_token",
      }, 401);
    }

    const { data: authData, error: authError } = await serviceClient.auth.getUser(accessToken);
    if (authError || !authData?.user?.id) {
      await logSecurityEvent(serviceClient, {
        eventType: "appointment_notification_invalid_token",
        severity: "warn",
        ip: requestIp,
        context: { appointmentId },
      });
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "invalid_or_expired_token",
      }, 401);
    }
    const authenticatedUserId = authData.user.id;

    const rateLimit = await enforceRateLimit(serviceClient, {
      scope: "send-appointment-notification",
      subject: authenticatedUserId,
      maxRequests: 12,
      windowSeconds: 60,
    });
    if (!rateLimit.allowed) {
      await logSecurityEvent(serviceClient, {
        eventType: "appointment_notification_rate_limited",
        severity: "warn",
        userId: authenticatedUserId,
        ip: requestIp,
        context: {
          appointmentId,
          retryAfterSec: rateLimit.retryAfterSec,
          currentCount: rateLimit.currentCount,
          remaining: rateLimit.remaining,
        },
      });
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "rate_limit_exceeded",
        retryAfterSec: rateLimit.retryAfterSec,
      }, 429);
    }

    const { data: appointment, error: appointmentError } = await serviceClient
      .from("appointments")
      .select("id, patient_id, doctor_id, status, ai_report_id, slot:slots!slot_id(date, start_time, end_time)")
      .eq("id", appointmentId)
      .maybeSingle();

    if (appointmentError || !appointment) {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "appointment_not_found",
      });
    }

    if (!["pending", "confirmed"].includes(String(appointment.status || ""))) {
      return jsonResponse({
        success: true,
        skipped: true,
        reason: "appointment_not_pending_or_confirmed",
      });
    }

    // Only patient who booked or admin can trigger this notification.
    if (authenticatedUserId !== appointment.patient_id) {
      const { data: actorProfile } = await serviceClient
        .from("profiles")
        .select("roles(slug)")
        .eq("id", authenticatedUserId)
        .maybeSingle();

      const actorRole = String(actorProfile?.roles?.slug || "").toLowerCase();
      if (actorRole !== "admin") {
        await logSecurityEvent(serviceClient, {
          eventType: "appointment_notification_forbidden",
          severity: "warn",
          userId: authenticatedUserId,
          ip: requestIp,
          context: { appointmentId, actorRole: actorRole || "unknown" },
        });
        return jsonResponse({
          success: false,
          skipped: true,
          reason: "not_allowed_to_notify_for_this_appointment",
        }, 403);
      }
    }

    const { data: patientProfileData, error: patientProfileError } = await serviceClient
      .from("profiles")
      .select("first_name, last_name, email, phone_number, age, gender, address, weight, blood_pressure, pulse, push_token, settings")
      .eq("id", appointment.patient_id)
      .maybeSingle();

    if (patientProfileError) {
      console.warn("Patient profile lookup failed:", patientProfileError);
    }

    let patientProfile: any = patientProfileData || null;
    let patientAuthUser: any = null;
    try {
      const { data: authUserData, error: authUserError } = await serviceClient.auth.admin.getUserById(appointment.patient_id);
      if (!authUserError && authUserData?.user) {
        patientAuthUser = authUserData.user;
      } else if (authUserError) {
        console.warn("Patient auth lookup failed:", authUserError);
      }
    } catch (authLookupError) {
      console.warn("Patient auth lookup threw error:", authLookupError);
    }

    if (patientAuthUser) {
      const meta = (patientAuthUser.user_metadata || patientAuthUser.raw_user_meta_data || {}) as Record<string, unknown>;
      const metaAge = parseOptionalNumber(meta.age);
      const metaWeight = parseOptionalNumber(meta.weight);
      const metaPulse = parseOptionalNumber(meta.pulse);
      const metaGender = parseOptionalGender(meta.gender);

      patientProfile = {
        first_name:
          patientProfile?.first_name ||
          (typeof meta.first_name === "string" ? meta.first_name : "") ||
          (typeof meta.firstName === "string" ? meta.firstName : ""),
        last_name:
          patientProfile?.last_name ||
          (typeof meta.last_name === "string" ? meta.last_name : "") ||
          (typeof meta.lastName === "string" ? meta.lastName : ""),
        email: patientProfile?.email || patientAuthUser.email || (typeof meta.email === "string" ? meta.email : ""),
        phone_number:
          patientProfile?.phone_number ||
          patientAuthUser.phone ||
          (typeof meta.phone_number === "string" ? meta.phone_number : "") ||
          (typeof meta.phoneNumber === "string" ? meta.phoneNumber : "") ||
          (typeof meta.mobile === "string" ? meta.mobile : ""),
        age: patientProfile?.age ?? metaAge,
        gender: patientProfile?.gender || metaGender,
        address:
          patientProfile?.address ||
          (typeof meta.address === "string" ? meta.address : ""),
        weight: patientProfile?.weight ?? metaWeight,
        blood_pressure:
          patientProfile?.blood_pressure ||
          (typeof meta.blood_pressure === "string" ? meta.blood_pressure : "") ||
          (typeof meta.bloodPressure === "string" ? meta.bloodPressure : ""),
        pulse: patientProfile?.pulse ?? metaPulse,
        push_token: patientProfile?.push_token || "",
        settings: patientProfile?.settings || null,
      };
    }

    const { data: doctorProfile, error: doctorProfileError } = await serviceClient
      .from("profiles")
      .select("push_token, settings")
      .eq("id", appointment.doctor_id)
      .maybeSingle();

    const { data: doctorMeta } = await serviceClient
      .from("doctors")
      .select("id, specialization, profiles(first_name, last_name)")
      .eq("id", appointment.doctor_id)
      .maybeSingle();

    const bookedDoctorProfile = Array.isArray((doctorMeta as any)?.profiles)
      ? (doctorMeta as any).profiles[0]
      : (doctorMeta as any)?.profiles;
    const doctorName = bookedDoctorProfile?.first_name
      ? `Dr. ${bookedDoctorProfile.first_name}${bookedDoctorProfile?.last_name ? ` ${bookedDoctorProfile.last_name}` : ""}`
      : "Booked Doctor";

    const doctorPushEnabled = isPushEnabledFromSettings((doctorProfile as any)?.settings);
    const patientPushEnabled = isPushEnabledFromSettings((patientProfile as any)?.settings);

    let reportMeta: {
      reportId: string | null;
      pdfPath: string | null;
      summary: string | null;
      source: "existing" | "generated" | "none";
    } = { reportId: null, pdfPath: null, summary: null, source: "none" };
    let reportGenerationErrorMessage: string | null = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        reportMeta = await ensureAppointmentTriageReport({
          serviceClient,
          appointment,
          body,
          patientProfile,
          doctorMeta,
        });
        reportGenerationErrorMessage = null;
        break;
      } catch (reportError) {
        const errorMessage =
          reportError instanceof Error ? reportError.message : "Appointment AI report generation failed";
        console.warn(`Appointment AI report generation attempt ${attempt} failed:`, reportError);
        reportGenerationErrorMessage = errorMessage;
        if (attempt < 2) {
          await sleep(450 * attempt);
        }
      }
    }

    const patientName = patientProfile?.first_name
      ? `${patientProfile.first_name}${patientProfile.last_name ? ` ${patientProfile.last_name}` : ""}`
      : "A patient";
    const patientSummary = resolvePatientSnapshot(patientProfile);

    const slot = appointment.slot as { date?: string | null; start_time?: string | null; end_time?: string | null } | null;
    const slotLabel = formatSlotLabel(slot?.date || null, slot?.start_time || null);
    const summarySuffix = reportMeta?.pdfPath ? " AI summary attached." : "";

    const doctorPushMessage: Record<string, unknown> = {
      to: doctorProfile?.push_token || "",
      sound: "default",
      title: "New Appointment Booked",
      body: clipText(`${patientName} booked ${slotLabel}.${summarySuffix}`, 200),
      data: {
        type: "appointment_booked",
        appointmentId: appointment.id,
        patientId: appointment.patient_id,
        doctorId: appointment.doctor_id,
        recipientId: appointment.doctor_id,
        aiReportId: reportMeta.reportId,
        patientSummary: {
          name: patientSummary.name,
          age: patientSummary.age,
          gender: patientSummary.gender,
          phone: patientSummary.phone,
        },
      },
      priority: "high",
      channelId: "appointments",
    };
    const patientPushMessage: Record<string, unknown> = {
      to: (patientProfile as any)?.push_token || "",
      sound: "default",
      title: "Appointment Confirmed",
      body: clipText(`Your appointment with ${doctorName} is confirmed for ${slotLabel}.${summarySuffix}`, 200),
      data: {
        type: "appointment_update",
        appointmentId: appointment.id,
        patientId: appointment.patient_id,
        doctorId: appointment.doctor_id,
        recipientId: appointment.patient_id,
        aiReportId: reportMeta.reportId,
        patientSummary: {
          name: patientSummary.name,
          age: patientSummary.age,
          gender: patientSummary.gender,
          phone: patientSummary.phone,
        },
      },
      priority: "high",
      channelId: "appointments",
    };

    const [doctorNotificationAlreadyExists, patientNotificationAlreadyExists] = await Promise.all([
      hasAppointmentInAppNotification(serviceClient, {
        userId: appointment.doctor_id,
        appointmentId: appointment.id,
      }),
      hasAppointmentInAppNotification(serviceClient, {
        userId: appointment.patient_id,
        appointmentId: appointment.id,
      }),
    ]);

    // Persist as in-app notification first for the doctor.
    if (!doctorNotificationAlreadyExists) {
      try {
        await serviceClient
          .from("in_app_notifications")
          .insert({
            user_id: appointment.doctor_id,
            type: "appointment_update",
            title: "New Appointment Booked",
            body: clipText(`${patientName} booked ${slotLabel}.${summarySuffix}`, 200),
            data: {
              appointmentId: appointment.id,
              patientId: appointment.patient_id,
              doctorId: appointment.doctor_id,
              aiReportId: reportMeta.reportId,
              aiReportSource: reportMeta.source,
              patientSummary: {
                name: patientSummary.name,
                age: patientSummary.age,
                gender: patientSummary.gender,
                phone: patientSummary.phone,
              },
            },
            is_read: false,
          });
      } catch (inAppErr) {
        console.warn("in_app_notifications insert failed:", inAppErr);
      }
    } else {
      console.log("Skipping duplicate doctor appointment notification:", {
        appointmentId: appointment.id,
        doctorId: appointment.doctor_id,
      });
    }

    // Persist in-app notification for patient as well, including report references.
    if (!patientNotificationAlreadyExists) {
      try {
        await serviceClient
          .from("in_app_notifications")
          .insert({
            user_id: appointment.patient_id,
            type: "appointment_update",
            title: "Appointment Confirmed",
            body: clipText(`Your appointment with ${doctorName} is confirmed for ${slotLabel}.${summarySuffix}`, 200),
            data: {
              appointmentId: appointment.id,
              patientId: appointment.patient_id,
              doctorId: appointment.doctor_id,
              aiReportId: reportMeta.reportId,
              aiReportSource: reportMeta.source,
              patientSummary: {
                name: patientSummary.name,
                age: patientSummary.age,
                gender: patientSummary.gender,
                phone: patientSummary.phone,
              },
            },
            is_read: false,
          });
      } catch (inAppErr) {
        console.warn("patient in_app_notifications insert failed:", inAppErr);
      }
    } else {
      console.log("Skipping duplicate patient appointment notification:", {
        appointmentId: appointment.id,
        patientId: appointment.patient_id,
      });
    }

    const pushDelivery: {
      doctor: { sent: boolean; reason?: string };
      patient: { sent: boolean; reason?: string };
    } = {
      doctor: { sent: false },
      patient: { sent: false },
    };

    if (doctorNotificationAlreadyExists) {
      pushDelivery.doctor = { sent: false, reason: "duplicate_notification" };
    } else if (doctorProfileError || !doctorProfile?.push_token) {
      pushDelivery.doctor = { sent: false, reason: "doctor_push_token_missing" };
    } else if (!doctorPushEnabled) {
      pushDelivery.doctor = { sent: false, reason: "doctor_push_disabled" };
    } else {
      const expoResult = await sendExpoPush(doctorPushMessage);
      if (!expoResult.ok) {
        pushDelivery.doctor = { sent: false, reason: "expo_push_rejected" };
      } else {
        pushDelivery.doctor = { sent: true };
      }
    }

    if (patientNotificationAlreadyExists) {
      pushDelivery.patient = { sent: false, reason: "duplicate_notification" };
    } else if (!(patientProfile as any)?.push_token) {
      pushDelivery.patient = { sent: false, reason: "patient_push_token_missing" };
    } else if (!patientPushEnabled) {
      pushDelivery.patient = { sent: false, reason: "patient_push_disabled" };
    } else {
      const patientExpoResult = await sendExpoPush(patientPushMessage);
      if (!patientExpoResult.ok) {
        pushDelivery.patient = { sent: false, reason: "expo_push_rejected" };
      } else {
        pushDelivery.patient = { sent: true };
      }
    }

    if (!pushDelivery.doctor.sent && !pushDelivery.patient.sent) {
      await logSecurityEvent(serviceClient, {
        eventType: "appointment_notification_push_skipped",
        severity: "warn",
        userId: authenticatedUserId,
        ip: requestIp,
        context: {
          appointmentId: appointment.id,
          reason: pushDelivery.doctor.reason || pushDelivery.patient.reason || "push_skipped",
          reportId: reportMeta.reportId,
          reportSource: reportMeta.source,
        },
      });
      return jsonResponse({
        success: !reportGenerationErrorMessage,
        skipped: true,
        reason: pushDelivery.doctor.reason || pushDelivery.patient.reason || "push_skipped",
        aiReport: reportMeta,
        pushDelivery,
        error: reportGenerationErrorMessage ? clipText(reportGenerationErrorMessage, 200) : undefined,
      });
    }

    console.log("Appointment notification completed:", {
      appointmentId: appointment.id,
      reportId: reportMeta.reportId,
      pdfPath: reportMeta.pdfPath,
      reportSource: reportMeta.source,
      doctorId: appointment.doctor_id,
      patientId: appointment.patient_id,
      pushDelivery,
    });

    await logSecurityEvent(serviceClient, {
      eventType: "appointment_notification_success",
      severity: "info",
      userId: authenticatedUserId,
      ip: requestIp,
      context: {
        appointmentId: appointment.id,
        reportId: reportMeta.reportId,
        reportSource: reportMeta.source,
        doctorPushSent: pushDelivery.doctor.sent,
        patientPushSent: pushDelivery.patient.sent,
      },
    });

    return jsonResponse({
      success: !reportGenerationErrorMessage,
      skipped: false,
      aiReport: reportMeta,
      pushDelivery,
      error: reportGenerationErrorMessage ? clipText(reportGenerationErrorMessage, 200) : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown appointment notification function error";
    const serviceClient = createServiceClient();
    if (serviceClient) {
      await logSecurityEvent(serviceClient, {
        eventType: "appointment_notification_exception",
        severity: "error",
        context: { message: clipText(message, 200) },
      });
    }
    return jsonResponse({
      success: false,
      skipped: true,
      reason: "function_exception",
      error: clipText(message, 200),
    });
  }
});
