import type { MedicalReport } from '../../hooks/useMedicalReports';

// Pure helpers that turn a stored medical_reports row into what the Reports screen shows.
// Kept free of React/Supabase so they can be unit-tested (see scripts/test-report-insights.mjs).

export type ReportKind = 'lab' | 'prescription' | 'other';
export type ReportState = 'ready' | 'scanning' | 'stuck' | 'failed';
export type HighlightFlag = 'high' | 'low' | 'normal' | 'unknown';

export interface ReportHighlight {
  name: string;
  value: string;
  unit: string;
  reference: string;
  flag: HighlightFlag;
}

type ReportLike = Pick<
  MedicalReport,
  'fileName' | 'reportType' | 'source' | 'aiStructured' | 'aiSummary' | 'aiKeyPoints' | 'analysisStatus' | 'updatedAt' | 'createdAt' | 'fileSizeBytes'
>;

const STUCK_AFTER_MS = 5 * 60 * 1000;

const asStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : [];

// The model sometimes writes "No abnormal findings are visible" as if it were a finding.
const isEmptyFinding = (text: string): boolean =>
  /^(no |none\b|nil\b|not (clearly )?(visible|available|applicable)|n\/a)/i.test(text.trim()) ||
  /no (abnormal|clinical|test|laboratory|medication)/i.test(text);

export const getReportKind = (report: ReportLike): ReportKind => {
  const source = (report.source || '').toLowerCase();
  const type = (report.reportType || '').toLowerCase();
  const structured: any = report.aiStructured || {};
  const rx = structured.prescription_details || structured.prescriptionDetails || {};
  const meds = Array.isArray(rx.medications) ? rx.medications : Array.isArray(structured.medications) ? structured.medications : [];

  if (source === 'prescription_upload' || type.includes('prescription') || meds.length > 0) return 'prescription';
  if (type.includes('lab') || type.includes('blood') || type.includes('pathology') || type.includes('diagnostic')) return 'lab';
  if (asStringList(structured.parameter_highlights).some((line) => !isEmptyFinding(line))) return 'lab';
  return 'other';
};

export const getReportState = (report: ReportLike, nowMs: number = Date.now()): ReportState => {
  if (report.analysisStatus === 'completed') return 'ready';
  if (report.analysisStatus === 'failed') return 'failed';
  const since = new Date(report.updatedAt || report.createdAt).getTime();
  return Number.isFinite(since) && nowMs - since > STUCK_AFTER_MS ? 'stuck' : 'scanning';
};

const stripMarkup = (text: string): string =>
  text
    .replace(/```[a-z]*\n?|```/gi, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^[\s#>*-]+/gm, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

// The stored summary is usually plain text but has occasionally been a JSON string; always return readable text.
export const getPlainSummary = (report: ReportLike, maxChars = 220): string => {
  let raw = (report.aiSummary || '').trim();
  if (raw.startsWith('{') || raw.startsWith('```')) {
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim());
      raw = String(parsed.patient_friendly_explanation || parsed.summary || '').trim() || raw;
    } catch {
      const match = raw.match(/"(?:summary|patient_friendly_explanation)"\s*:\s*"((?:\\.|[^"\\])*)"/s);
      if (match) {
        try { raw = JSON.parse(`"${match[1]}"`); } catch { /* keep raw */ }
      }
    }
  }
  const text = stripMarkup(raw);
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return `${(lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, '')).trim().replace(/[.;,:]+$/, '')}…`;
};

const normalizeFlag = (value: string): HighlightFlag => {
  const text = value.toLowerCase();
  if (/\b(high|elevated|raised|above|increased|positive)\b/.test(text)) return 'high';
  if (/\b(low|decreased|reduced|below|deficient)\b/.test(text)) return 'low';
  if (/\b(normal|within|ok|negative|optimal)\b/.test(text)) return 'normal';
  return 'unknown';
};

// Lab PDFs print "100.00" and "<100.00"; show "100" and "below 100" the way a person would say it.
const trimZeros = (text: string): string => text.replace(/(\d+)\.(\d*?)0+(?!\d)/g, (_m, whole, frac) => (frac ? `${whole}.${frac}` : whole));

export const formatValue = (value: string): string => (/^[<>]?\s*-?\d+(\.\d+)?$/.test(value.trim()) ? trimZeros(value.trim()) : value.trim());

export const formatReference = (reference: string): string => {
  const text = trimZeros(reference.trim())
    .replace(/^reference\s*/i, '')
    .replace(/\s*[-–—]\s*/g, ' – ');
  const lower = text.match(/^<\s*=?\s*([\d.]+)$/);
  if (lower) return `below ${lower[1]}`;
  const upper = text.match(/^>\s*=?\s*([\d.]+)$/);
  if (upper) return `above ${upper[1]}`;
  return text;
};

// "ldl cholesterol  (calculated)" -> "LDL cholesterol (calculated)"; keeps acronyms as the lab wrote them.
export const formatLabel = (name: string): string => {
  const text = name.replace(/\s+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
};

// "180.12 mg/dL" -> ["180.12", "mg/dL"]; "5.8%" -> ["5.8", "%"]; a second reading after " / " is dropped.
const splitValueAndUnit = (text: string): [string, string] | null => {
  const first = text.split(' / ')[0].trim();
  const match = first.match(/^([<>≤≥]?\s*-?\d[\d,]*(?:\.\d+)?)\s*(.*)$/);
  return match ? [match[1].replace(/\s+/g, ''), match[2].trim()] : null;
};

// The model writes highlights in two shapes; both are seen in production data:
//   "LDL cholesterol / 180.12 / mg/dL / reference <100.00 / high"
//   "LDL cholesterol, calculated: 180.12 mg/dL | reference <100.00 | High; at-risk range"
export const parseHighlightLine = (line: string): ReportHighlight | null => {
  if (isEmptyFinding(line)) return null;
  if (line.includes(' | ') || /^[^/|]+:\s*[<>≤≥]?\s*-?\d/.test(line)) {
    const [head, referenceText = '', flagText = ''] = line.split(' | ').map((part) => part.trim());
    const colon = head.search(/:\s*[<>≤≥]?\s*-?\d/);
    if (colon < 1) return null;
    const valueUnit = splitValueAndUnit(head.slice(colon + 1));
    if (!valueUnit) return null;
    const reference = referenceText.replace(/^references?\s*/i, '').split(' / ')[0];
    return {
      name: formatLabel(head.slice(0, colon)),
      value: formatValue(valueUnit[0]),
      unit: valueUnit[1],
      reference: formatReference(reference),
      flag: normalizeFlag(flagText.split(';')[0] || referenceText),
    };
  }
  const parts = line.split(' / ').map((part) => part.trim());
  if (parts.length < 2 || isEmptyFinding(line)) return null;
  // Names can contain " / " themselves ("Creatinine / eGFR"); the value is the first part that starts with a number.
  const valueIndex = parts.findIndex((part, index) => index > 0 && /^[<>≤≥]?\s*-?\d/.test(part));
  if (valueIndex < 1) return null;
  const name = parts.slice(0, valueIndex).join(' / ');
  const [value, unit = '', reference = '', flagText = ''] = parts.slice(valueIndex);
  if (!name || !value) return null;
  return {
    name: formatLabel(name),
    value: formatValue(value),
    unit,
    reference: formatReference(reference),
    flag: normalizeFlag(flagText || reference),
  };
};

// Values that need attention first, then the rest; at most `max` for a compact card.
export const getHighlights = (report: ReportLike, max = 4): ReportHighlight[] => {
  const structured: any = report.aiStructured || {};
  const parsed = asStringList(structured.parameter_highlights)
    .map(parseHighlightLine)
    .filter((item): item is ReportHighlight => Boolean(item));
  const rank = (flag: HighlightFlag) => (flag === 'high' || flag === 'low' ? 0 : flag === 'unknown' ? 1 : 2);
  return [...parsed].sort((a, b) => rank(a.flag) - rank(b.flag)).slice(0, max);
};

export const getAttentionCount = (report: ReportLike): number => {
  const structured: any = report.aiStructured || {};
  const fromHighlights = asStringList(structured.parameter_highlights)
    .map(parseHighlightLine)
    .filter((item): item is ReportHighlight => Boolean(item) && (item!.flag === 'high' || item!.flag === 'low')).length;
  if (fromHighlights > 0) return fromHighlights;
  return asStringList(structured.abnormal_findings).filter((line) => !isEmptyFinding(line)).length;
};

export const getAttentionItems = (report: ReportLike, max = 6): string[] =>
  asStringList((report.aiStructured as any)?.abnormal_findings).filter((line) => !isEmptyFinding(line)).slice(0, max);

// Next steps must be something the patient can do; the model sometimes writes instructions about itself ("answer the AI's questions").
const isSelfReferential = (text: string): boolean => /\b(the AI|AI's|AI assistant|this chat|the chatbot)\b/i.test(text);

export const getFollowUps = (report: ReportLike, max = 3): string[] =>
  asStringList((report.aiStructured as any)?.suggested_followups)
    .filter((line) => !isEmptyFinding(line) && !isSelfReferential(line))
    .slice(0, max);

export const getCautions = (report: ReportLike, max = 3): string[] =>
  asStringList((report.aiStructured as any)?.caution_flags)
    .map((line) => stripMarkup(line))
    .filter((line) => line && !isEmptyFinding(line))
    .slice(0, max);

export const getMedicineCount = (report: ReportLike): number => {
  const structured: any = report.aiStructured || {};
  const rx = structured.prescription_details || structured.prescriptionDetails || {};
  const meds = Array.isArray(rx.medications) ? rx.medications : Array.isArray(structured.medications) ? structured.medications : [];
  return meds.length;
};

const parseReportDate = (value: unknown): Date | null => {
  const text = String(value || '').trim();
  if (!text) return null;
  const dmy = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const date = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const iso = new Date(text);
  return Number.isNaN(iso.getTime()) ? null : iso;
};

export const formatShortDate = (date: Date | null): string =>
  date ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

// The date printed on the report when AI found one, otherwise the upload date.
export const getReportDate = (report: ReportLike): { date: Date | null; isUploadDate: boolean } => {
  const identity: any = (report.aiStructured as any)?.report_identity || {};
  const printed = parseReportDate(identity.report_date || identity.date || identity.sample_collected_at);
  if (printed) return { date: printed, isUploadDate: false };
  const uploaded = new Date(report.createdAt);
  return { date: Number.isNaN(uploaded.getTime()) ? null : uploaded, isUploadDate: true };
};

// "Lab_Report_.pdf" -> "Lab Report"; falls back to the kind when the name is meaningless ("IMG_2031", "Screenshot_…").
export const getReportTitle = (report: ReportLike): string => {
  const base = (report.fileName || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\d{8,}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const kind = getReportKind(report);
  const generic = !base || /^(img|image|screenshot|photo|scan|document|doc|pxl|dsc|whatsapp)\b/i.test(base) || base.length < 3;
  if (generic) return kind === 'prescription' ? 'Prescription' : kind === 'lab' ? 'Lab report' : 'Medical document';
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
};

export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
