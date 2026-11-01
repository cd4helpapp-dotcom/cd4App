import React from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Keyboard, Linking, Pressable } from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Markdown from 'react-native-markdown-display';
import Toast from 'react-native-toast-message';
import { AlertTriangle, ArrowLeft, ExternalLink, FileText, FlaskConical, Pill, RefreshCw, Send, ShieldAlert, Sparkles, Trash2 } from 'lucide-react-native';
import {
  MedicalReport,
  getMedicalReportAnalysisErrorMessage,
  useAskMedicalReportQuestion,
  useGetMedicalReportFileUrl,
  useMedicalReportMessages,
  useMedicalReports,
  useReanalyzeMedicalReport,
  useSoftDeleteMedicalReport,
} from '../hooks/useMedicalReports';
import { useAppTheme } from '../hooks/useAppTheme';
import { elevation, Layout, Radius, Spacing, Typography } from '../constants/Design';
import { confirmAction } from '../src/utils/confirm';
import ThinkingIndicator from '../ui/common/ThinkingIndicator';
import AnalysisProgress from '../ui/reports/AnalysisProgress';
import {
  formatShortDate,
  getAttentionItems,
  getFollowUps,
  getHighlights,
  getPlainSummary,
  getReportDate,
  getReportKind,
  getReportState,
  getReportTitle,
} from '../src/utils/reportInsights';

const formatDate = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
};

const toTextArray = (value: unknown, maxItems: number = 8): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, maxItems);
};

const stripCodeFences = (value: string): string =>
  (value || '')
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim();

const decodeJsonStringSafe = (value: string): string => {
  const input = (value || '').trim();
  if (!input) return '';
  try {
    return JSON.parse(`"${input.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  } catch {
    return input.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
};

const extractQuotedField = (raw: string, field: string): string => {
  const regex = new RegExp(
    `["']?${field}["']?\\s*:\\s*(?:"([\\s\\S]*?)"|'([\\s\\S]*?)')(?=\\s*,\\s*["']?[a-zA-Z0-9_]+["']?\\s*:|\\s*\\}|\\s*$)`,
    'i'
  );
  const match = raw.match(regex);
  const captured = match?.[1] || match?.[2] || '';
  if (captured) return decodeJsonStringSafe(captured).trim();
  const plainRegex = new RegExp(`["']?${field}["']?\\s*:\\s*([^,\\n\\r\\}]+)`, 'i');
  const plainMatch = raw.match(plainRegex);
  return (plainMatch?.[1] || '').trim().replace(/^["']|["']$/g, '');
};

const extractStringArrayField = (raw: string, field: string, maxItems: number = 8): string[] => {
  const regex = new RegExp(`["']?${field}["']?\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'i');
  const match = raw.match(regex);
  if (!match?.[1]) return [];
  const block = match[1];
  const items: string[] = [];
  const itemRegex = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'/g;
  let itemMatch: RegExpExecArray | null = itemRegex.exec(block);
  while (itemMatch && items.length < maxItems) {
    const decoded = decodeJsonStringSafe(itemMatch[1] || itemMatch[2] || '').trim();
    if (decoded) items.push(decoded);
    itemMatch = itemRegex.exec(block);
  }
  return items;
};

const parseLooseJsonObject = (value: string): Record<string, any> | null => {
  const trimmed = stripCodeFences(value);
  if (!trimmed) return null;

  const tryParse = (candidate: string): any | null => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };

  const normalize = (parsed: any, depth: number = 0): Record<string, any> | null => {
    if (depth > 3 || !parsed) return null;
    if (typeof parsed === 'string') {
      const nested = parsed.trim();
      if (!nested) return null;
      const parsedNested = tryParse(nested);
      if (parsedNested) return normalize(parsedNested, depth + 1);
      const first = nested.indexOf('{');
      const last = nested.lastIndexOf('}');
      if (first >= 0 && last > first) {
        const fromSlice = tryParse(nested.slice(first, last + 1));
        if (fromSlice) return normalize(fromSlice, depth + 1);
      }
      return null;
    }
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
    return null;
  };

  const direct = normalize(tryParse(trimmed));
  if (direct) return direct;

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const sliced = trimmed.slice(first, last + 1);
    const parsedSlice = normalize(tryParse(sliced));
    if (parsedSlice) return parsedSlice;
  }

  const summary =
    extractQuotedField(trimmed, 'patient_friendly_explanation') ||
    extractQuotedField(trimmed, 'summary');
  const keyPoints =
    extractStringArrayField(trimmed, 'key_points') ||
    extractStringArrayField(trimmed, 'keyPoints');
  const cautionFlags =
    extractStringArrayField(trimmed, 'caution_flags') ||
    extractStringArrayField(trimmed, 'cautionFlags');
  const followUps =
    extractStringArrayField(trimmed, 'suggested_followups') ||
    extractStringArrayField(trimmed, 'suggestedFollowups');

  if (summary || keyPoints.length > 0 || cautionFlags.length > 0 || followUps.length > 0) {
    return {
      summary,
      patient_friendly_explanation: summary,
      key_points: keyPoints,
      caution_flags: cautionFlags,
      suggested_followups: followUps,
    };
  }

  return null;
};

const isPrescriptionReport = (report: MedicalReport): boolean => {
  const type = (report.reportType || '').toLowerCase();
  const name = (report.fileName || '').toLowerCase();
  const source = (report.source || '').toLowerCase();
  return (
    source.includes('prescription') ||
    type.includes('prescription') ||
    name.includes('prescription') ||
    name.includes('rx') ||
    name.includes('medicine') ||
    name.includes('medication')
  );
};

interface PrescriptionMedicine {
  name: string;
  dosage: string;
  frequency: string;
  timing: string;
  duration: string;
  purpose: string;
  instructions: string;
}

interface PrescriptionData {
  doctorName: string;
  date: string;
  prescribedOn: string;
  followupDate: string;
  patientName: string;
  relationTag: string;
  age: string;
  sex: string;
  occupation: string;
  insuranceNo: string;
  healthProvider: string;
  healthCardNo: string;
  patientIdNo: string;
  address: string;
  cellNo: string;
  bloodPressure: string;
  pulseRate: string;
  weight: string;
  allergies: string;
  disabilities: string;
  dietToFollow: string;
  briefHistory: string;
  followupPhysician: string;
  medicines: PrescriptionMedicine[];
  precautions: string[];
  generalInstructions: string[];
  redFlags: string[];
  doctorNotes: string;
  diagnosis: string;
}

const toTextList = (value: unknown, maxItems: number = 8): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\n|;|•|,/g)
      .map((item) => item.trim())
      .filter((item) => item.length > 1)
      .slice(0, maxItems);
  }

  return [];
};

const normalizePrescriptionMedicine = (value: any): PrescriptionMedicine | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    const name = value.trim();
    if (!name) return null;
    return { name, dosage: '', frequency: '', timing: '', duration: '', purpose: '', instructions: '' };
  }

  if (typeof value !== 'object') return null;

  const medicine: PrescriptionMedicine = {
    name: (value.name || value.medicine || value.drug || value.medication || '').toString().trim(),
    dosage: (value.dosage || value.dose || value.strength || '').toString().trim(),
    frequency: (value.frequency || value.schedule || value.how_often || value.times_per_day || '').toString().trim(),
    timing: (value.timing || value.when || value.time || '').toString().trim(),
    duration: (value.duration || value.days || value.period || value.course || '').toString().trim(),
    purpose: (value.purpose || value.for || value.indication || value.reason || '').toString().trim(),
    instructions: (value.instructions || value.notes || value.remark || value.instruction || '').toString().trim(),
  };

  return medicine.name ? medicine : null;
};

const sanitizeMedicineLine = (value: string): string =>
  (value || '')
    .replace(/\s+/g, ' ')
    .replace(/[|]+/g, ' ')
    .trim();

const isLikelyMedicineLine = (value: string): boolean => {
  const line = sanitizeMedicineLine(value).toLowerCase();
  if (!line) return false;

  // Reject long narrative/symptom explanation lines that often leak from OCR/ASR.
  if (line.split(' ').length > 14) return false;
  if (/(you are having|bukhar|fever|symptom|history|complaint|consultation|doctor voice)/i.test(line)) {
    return false;
  }

  const hasMedicineSignal =
    /\b(tab|tablet|cap|capsule|syrup|injection|cream|ointment|drops|dolo|paracetamol|azithromycin|levocetirizine|ors)\b/i.test(
      line
    );
  const hasDoseSignal = /\b\d+\s?(mg|ml|mcg|g|gm|iu|tablet|tab|capsule|cap|drop|drops|puff)\b/i.test(line);

  return hasMedicineSignal || hasDoseSignal;
};

const parsePrescriptionMedicines = (value: unknown, maxItems: number = 15): PrescriptionMedicine[] => {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  const rows: PrescriptionMedicine[] = [];

  for (const entry of value) {
    if (rows.length >= maxItems) break;
    const normalized = normalizePrescriptionMedicine(entry);
    if (!normalized) continue;
    if (!isLikelyMedicineLine(normalized.name)) continue;

    normalized.name = sanitizeMedicineLine(normalized.name);
    normalized.instructions = sanitizeMedicineLine(normalized.instructions);
    const dedupeKey = [
      normalized.name.toLowerCase(),
      normalized.dosage.toLowerCase(),
      normalized.frequency.toLowerCase(),
      normalized.timing.toLowerCase(),
      normalized.duration.toLowerCase(),
    ]
      .filter(Boolean)
      .join('|');
    const key = dedupeKey || normalized.name.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    rows.push(normalized);
  }

  return rows;
};

const pickFirstNonEmpty = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

const extractVitalsFromText = (items: string[]): { bloodPressure: string; pulseRate: string; weight: string } => {
  const joined = (items || []).join(' | ');
  if (!joined) {
    return { bloodPressure: '', pulseRate: '', weight: '' };
  }

  const bpMatch = joined.match(/\b(bp|blood pressure)\b[^0-9]*([0-9]{2,3}\s*\/\s*[0-9]{2,3}(?:\s*mmhg)?)/i);
  const pulseMatch = joined.match(/\b(pulse|heart rate)\b[^0-9]*([0-9]{2,3}(?:\s*bpm)?)/i);
  const weightMatch = joined.match(/\b(weight|wt)\b[^0-9]*([0-9]{2,3}(?:\.\d+)?\s*(?:kg|kgs)?)/i);

  return {
    bloodPressure: bpMatch?.[2]?.trim() || '',
    pulseRate: pulseMatch?.[2]?.trim() || '',
    weight: weightMatch?.[2]?.trim() || '',
  };
};

const extractPrescriptionData = (report: MedicalReport): PrescriptionData => {
  const result: PrescriptionData = {
    doctorName: '',
    date: '',
    prescribedOn: '',
    followupDate: '',
    patientName: '',
    relationTag: '',
    age: '',
    sex: '',
    occupation: '',
    insuranceNo: '',
    healthProvider: '',
    healthCardNo: '',
    patientIdNo: '',
    address: '',
    cellNo: '',
    bloodPressure: '',
    pulseRate: '',
    weight: '',
    allergies: '',
    disabilities: '',
    dietToFollow: '',
    briefHistory: '',
    followupPhysician: '',
    medicines: [],
    precautions: [],
    generalInstructions: [],
    redFlags: [],
    doctorNotes: '',
    diagnosis: '',
  };

  const rawSummary = (report.aiSummary || '').trim();
  const parsed = rawSummary ? parseLooseJsonObject(rawSummary) : null;
  const structured = typeof report.aiStructured === 'object' && report.aiStructured ? report.aiStructured : {};
  const structuredPrescription =
    (structured as any).prescription_details ||
    (structured as any).prescriptionDetails ||
    {};
  const identity =
    (structured as any).report_identity ||
    (structured as any).reportIdentity ||
    {};

  result.doctorName = pickFirstNonEmpty(
    (structuredPrescription as any).doctor_name,
    (structuredPrescription as any).doctorName,
    (parsed as any)?.doctor_name,
    (parsed as any)?.doctorName,
    (parsed as any)?.prescribed_by
  );
  result.patientName = pickFirstNonEmpty(
    (identity as any).patient_name,
    (identity as any).patientName,
    (parsed as any)?.patient_name,
    (parsed as any)?.patientName
  );
  result.relationTag = pickFirstNonEmpty(
    (identity as any).relation_tag,
    (identity as any).relationTag,
    (identity as any).guardian_name,
    (parsed as any)?.relation_tag,
    (parsed as any)?.relationTag
  );
  result.age = pickFirstNonEmpty(
    (identity as any).age,
    (identity as any).patient_age,
    (parsed as any)?.age,
    (parsed as any)?.patient_age
  );
  result.sex = pickFirstNonEmpty(
    (identity as any).gender,
    (identity as any).sex,
    (parsed as any)?.gender,
    (parsed as any)?.sex
  );
  result.occupation = pickFirstNonEmpty(
    (identity as any).occupation,
    (parsed as any)?.occupation
  );
  result.insuranceNo = pickFirstNonEmpty(
    (identity as any).insurance_no,
    (identity as any).insuranceNo,
    (parsed as any)?.insurance_no
  );
  result.healthProvider = pickFirstNonEmpty(
    (identity as any).health_provider,
    (identity as any).healthcare_provider,
    (parsed as any)?.health_provider
  );
  result.healthCardNo = pickFirstNonEmpty(
    (identity as any).health_card_no,
    (identity as any).healthCardNo,
    (parsed as any)?.health_card_no
  );
  result.patientIdNo = pickFirstNonEmpty(
    (identity as any).patient_id_no,
    (identity as any).patientIdNo,
    (identity as any).report_id,
    (identity as any).reportId,
    (parsed as any)?.patient_id_no
  );
  result.address = pickFirstNonEmpty(
    (identity as any).address,
    (identity as any).patient_address,
    (parsed as any)?.address
  );
  result.cellNo = pickFirstNonEmpty(
    (identity as any).cell_no,
    (identity as any).phone,
    (identity as any).mobile,
    (parsed as any)?.cell_no,
    (parsed as any)?.phone
  );

  result.diagnosis = pickFirstNonEmpty(
    (structuredPrescription as any).diagnosis,
    (parsed as any)?.diagnosis,
    (parsed as any)?.condition
  );
  result.doctorNotes = pickFirstNonEmpty(
    (structuredPrescription as any).doctor_notes,
    (structuredPrescription as any).notes,
    (parsed as any)?.notes,
    (parsed as any)?.doctor_notes,
    (parsed as any)?.instructions,
    (parsed as any)?.additional_notes
  );

  result.prescribedOn = pickFirstNonEmpty(
    (structuredPrescription as any).prescribed_on,
    (structuredPrescription as any).prescribedOn,
    (parsed as any)?.prescribed_on,
    (parsed as any)?.prescribedOn
  );
  result.followupDate = pickFirstNonEmpty(
    (structuredPrescription as any).followup_date,
    (structuredPrescription as any).followupDate,
    (parsed as any)?.followup_date,
    (parsed as any)?.followupDate
  );
  result.followupPhysician = pickFirstNonEmpty(
    (structuredPrescription as any).followup_physician,
    (structuredPrescription as any).followupPhysician,
    (parsed as any)?.followup_physician,
    result.doctorName
  );

  const parameterHighlights = toTextList(
    (structured as any).parameter_highlights || (structured as any).parameterHighlights || (parsed as any)?.parameter_highlights,
    16
  );
  const vitalsFromHighlights = extractVitalsFromText(parameterHighlights);
  result.bloodPressure = pickFirstNonEmpty(
    (structuredPrescription as any).blood_pressure,
    (structuredPrescription as any).bloodPressure,
    (parsed as any)?.blood_pressure,
    vitalsFromHighlights.bloodPressure
  );
  result.pulseRate = pickFirstNonEmpty(
    (structuredPrescription as any).pulse_rate,
    (structuredPrescription as any).pulseRate,
    (parsed as any)?.pulse_rate,
    vitalsFromHighlights.pulseRate
  );
  result.weight = pickFirstNonEmpty(
    (structuredPrescription as any).weight,
    (parsed as any)?.weight,
    vitalsFromHighlights.weight
  );
  result.allergies = pickFirstNonEmpty(
    (structuredPrescription as any).allergies,
    (parsed as any)?.allergies
  );
  result.disabilities = pickFirstNonEmpty(
    (structuredPrescription as any).disabilities,
    (parsed as any)?.disabilities
  );
  result.dietToFollow = pickFirstNonEmpty(
    (structuredPrescription as any).diet_to_follow,
    (structuredPrescription as any).dietToFollow,
    (parsed as any)?.diet_to_follow
  );
  result.briefHistory = pickFirstNonEmpty(
    (structuredPrescription as any).brief_history,
    (structuredPrescription as any).briefHistory,
    (structuredPrescription as any).history,
    (parsed as any)?.brief_history,
    (parsed as any)?.history
  );

  result.generalInstructions = toTextList(
    (structuredPrescription as any).general_instructions ||
      (structuredPrescription as any).instructions ||
      (parsed as any)?.general_instructions ||
      (parsed as any)?.instructions,
    10
  );
  result.redFlags = toTextList(
    (structuredPrescription as any).red_flags ||
      (structuredPrescription as any).warning_signs ||
      (parsed as any)?.red_flags ||
      (parsed as any)?.warning_signs,
    8
  );
  result.precautions = toTextList(
    (structuredPrescription as any).red_flags ||
      (structured as any).caution_flags ||
      (structured as any).cautionFlags ||
      (parsed as any)?.precautions ||
      (parsed as any)?.caution_flags ||
      (parsed as any)?.cautionFlags ||
      (parsed as any)?.warnings,
    8
  );

  result.medicines =
    parsePrescriptionMedicines(
      (structuredPrescription as any).medications ||
        (structuredPrescription as any).medicines ||
        (structured as any).medications,
      20
    ) ||
    [];

  // Fallback: try to extract from key_points
  if (result.medicines.length === 0) {
    const keyPoints = toTextArray(report.aiKeyPoints, 15);
    result.medicines = keyPoints
      .map((kp) => sanitizeMedicineLine(kp))
      .filter((kp) => isLikelyMedicineLine(kp))
      .map((kp) => ({ name: kp, dosage: '', frequency: '', timing: '', duration: '', purpose: '', instructions: '' }))
      .slice(0, 8);
  }

  // Fallback: extract from raw text
  if (result.medicines.length === 0 && rawSummary) {
    const lines = rawSummary.split(/[\n,;]/).map(l => l.trim()).filter(Boolean);
    result.medicines = lines
      .map((l) => sanitizeMedicineLine(l.replace(/<[^>]+>/g, '').trim()))
      .filter((l) => isLikelyMedicineLine(l))
      .slice(0, 10)
      .map(l => ({ name: l, dosage: '', frequency: '', timing: '', duration: '', purpose: '', instructions: '' }));
  }

  result.date = formatDate(report.analyzedAt || report.createdAt);
  if (!result.doctorNotes && result.generalInstructions.length > 0) {
    result.doctorNotes = result.generalInstructions.join(' ');
  }

  return result;
};

const formatAssistantMessageForMarkdown = (rawContent: string): string => {
  const stripVisualMarkers = (value: string): string =>
    (value || '')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/[`*_~>#]/g, '')
      .trim();

  const hasMeaningfulText = (value: string): boolean =>
    /[\p{L}\p{N}]/u.test(stripVisualMarkers(value));

  const sanitizeMarkdownBullets = (value: string): string => {
    const input = (value || '').trim();
    if (!input) return '';
    const lines = input.split('\n');
    const cleaned: string[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();
      const bulletMatch = trimmed.match(/^([-*]|\d+\.)\s+(.*)$/);

      if (!bulletMatch) {
        cleaned.push(line);
        continue;
      }

      const body = (bulletMatch[2] || '').trim();
      if (hasMeaningfulText(body)) {
        cleaned.push(line);
        continue;
      }

      const next = (lines[index + 1] || '').trim();
      const nextIsBullet = /^([-*]|\d+\.)\s+/.test(next);
      if (next && !nextIsBullet && hasMeaningfulText(next)) {
        const marker = bulletMatch[1];
        cleaned.push(`${marker} ${next}`);
        index += 1;
      }
    }

    return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  const stripTemplateHeadings = (value: string): string => {
    const headingPattern =
      /^\s*#{1,6}\s*(summary|quick summary|key findings?|key points?|detailed points?|explained points?|watchouts?|what to do next|next steps?|questions? for doctor|next questions? for doctor|what this means)\b/i;
    return (value || '')
      .split('\n')
      .filter((line) => !headingPattern.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const containsEmoji = (value: string): boolean =>
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(value || '');

  const decorateFriendlyMarkdown = (value: string): string => {
    const input = (value || '').trim();
    if (!input) return input;
    const lines = input.split('\n');
    let added = 0;
    const bulletEmojis = ['✅', '✨', '💡', '🧠', '📌', '🔍'];
    const updated = lines.map((line) => {
      if (added >= 14 || containsEmoji(line)) return line;
      if (/^\s*#{1,6}\s+/.test(line)) {
        added += 1;
        return `${line} ✨`;
      }
      if (/^\s*-\s+/.test(line)) {
        const bulletBody = line.replace(/^(\s*-\s+)/, '').trim();
        if (!hasMeaningfulText(bulletBody)) return line;
        const emoji = bulletEmojis[added % bulletEmojis.length];
        added += 1;
        return line.replace(/^(\s*-\s+)/, `$1${emoji} `);
      }
      return line;
    });
    if (!containsEmoji(updated.join('\n'))) {
      const firstTextIndex = updated.findIndex((line) => line.trim().length > 0);
      if (firstTextIndex >= 0 && !/^\s*#{1,6}\s+/.test(updated[firstTextIndex])) {
        updated[firstTextIndex] = `🙂 ${updated[firstTextIndex]}`;
      }
    }
    return updated.join('\n').trim();
  };

  const content = sanitizeMarkdownBullets(stripTemplateHeadings((rawContent || '').trim()));
  if (!content) return '';

  const parsed = parseLooseJsonObject(content);
  if (!parsed) return decorateFriendlyMarkdown(content);

  const summary =
    (typeof parsed.patient_friendly_explanation === 'string' && parsed.patient_friendly_explanation.trim()) ||
    (typeof parsed.summary === 'string' && parsed.summary.trim()) ||
    '';
  const identity = normalizeReportIdentityForView(
    parsed.report_identity ?? parsed.reportIdentity ?? parsed.report_meta ?? parsed.reportMeta ?? {}
  );
  const keyPoints = toTextArray(parsed.key_points ?? parsed.keyPoints);
  const parameterHighlights = toTextArray(parsed.parameter_highlights ?? parsed.parameterHighlights, 8);
  const abnormalFindings = toTextArray(parsed.abnormal_findings ?? parsed.abnormalFindings, 6);
  const cautionFlags = toTextArray(parsed.caution_flags ?? parsed.cautionFlags, 6);
  const followUps = toTextArray(parsed.suggested_followups ?? parsed.suggestedFollowups, 6);
  const explainedPoints = [
    ...parameterHighlights.map((item) => `Value insight: ${item}`),
    ...keyPoints,
    ...abnormalFindings.map((item) => `Needs attention: ${item}`),
    ...cautionFlags.map((item) => `Watchout: ${item}`),
    ...followUps.map((item) => `Helpful follow-up: ${item}`),
  ].slice(0, 10);

  if (!summary && explainedPoints.length === 0) {
    return content;
  }

  const lines: string[] = [];
  const identityLines = [
    identity.patient_name ? `Patient: ${identity.patient_name}` : '',
    identity.age ? `Age: ${identity.age}` : '',
    identity.gender ? `Gender: ${identity.gender}` : '',
    identity.lab_name ? `Lab: ${identity.lab_name}` : '',
    identity.report_date ? `Report date: ${identity.report_date}` : '',
    identity.report_id ? `Report/Lab ID: ${identity.report_id}` : '',
  ].filter(Boolean);
  if (identityLines.length > 0) {
    lines.push('### Report Snapshot');
    lines.push(...identityLines.map((line) => `- 🧾 ${line}`));
    lines.push('');
  }
  if (summary) {
    const summaryWithTone = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(summary) ? summary : `🩺 ${summary}`;
    lines.push(summaryWithTone);
  }
  if (explainedPoints.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(...explainedPoints.map((point) => `- 🔎✨ ${point}`));
  }

  return sanitizeMarkdownBullets(decorateFriendlyMarkdown(lines.join('\n').trim() || content));
};

const containsEmoji = (value: string): boolean =>
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(value || '');

const normalizeReportIdentityForView = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const obj = value as Record<string, any>;
  const pick = (...candidates: unknown[]): string => {
    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined) continue;
      const text = String(candidate).trim();
      if (text) return text;
    }
    return '';
  };

  const mapped: Record<string, string> = {};
  const patientName = pick(obj.patient_name, obj.patientName, obj.name);
  const age = pick(obj.age, obj.patient_age, obj.patientAge);
  const gender = pick(obj.gender, obj.sex, obj.patient_gender, obj.patientGender);
  const labName = pick(obj.lab_name, obj.labName, obj.laboratory, obj.source_lab);
  const reportDate = pick(obj.report_date, obj.reportDate, obj.date, obj.generated_on);
  const sampleCollectedAt = pick(obj.sample_collected_at, obj.sampleCollectedAt, obj.collection_date);
  const reportId = pick(obj.report_id, obj.reportId, obj.lab_number, obj.labNumber);
  const referredBy = pick(obj.referred_by, obj.referredBy, obj.referring_doctor, obj.refBy);

  if (patientName) mapped.patient_name = patientName;
  if (age) mapped.age = age;
  if (gender) mapped.gender = gender;
  if (labName) mapped.lab_name = labName;
  if (reportDate) mapped.report_date = reportDate;
  if (sampleCollectedAt) mapped.sample_collected_at = sampleCollectedAt;
  if (reportId) mapped.report_id = reportId;
  if (referredBy) mapped.referred_by = referredBy;

  return mapped;
};

const normalizeRouteParam = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
};

const SUGGESTIONS_REPORT = ['Explain this report in simple words', 'Which values are not normal?', 'What should I ask my doctor?'];
const SUGGESTIONS_RX = ['How do I take these medicines?', 'What is each medicine for?', 'What should I avoid?'];

function SectionTitle({ children, color }: { children: string; color: string }) {
  return <Text style={[Typography.overline, { color, marginBottom: 2 }]}>{children}</Text>;
}

export default function ReportAssistantScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const params = useLocalSearchParams<{ reportId?: string | string[]; mode?: string | string[] }>();
  const reportId = normalizeRouteParam(params.reportId);

  const [questionInput, setQuestionInput] = React.useState('');
  const [pendingQuestion, setPendingQuestion] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const scrollRef = React.useRef<ScrollViewInstance | null>(null);

  const reportsQuery = useMedicalReports();
  const askMutation = useAskMedicalReportQuestion();
  const deleteMutation = useSoftDeleteMedicalReport();
  const reanalyzeMutation = useReanalyzeMedicalReport();
  const signedUrlMutation = useGetMedicalReportFileUrl();

  const report = React.useMemo(() => (reportsQuery.data || []).find((row) => row.id === reportId) || null, [reportsQuery.data, reportId]);
  const state = report ? getReportState(report, nowMs) : null;
  const isReady = state === 'ready';
  const isRx = Boolean(report && isPrescriptionReport(report));
  const messagesQuery = useMedicalReportMessages(reportId || null, { enabled: Boolean(reportId) && isReady });
  // The server stores an auto-generated overview as the first assistant message; the cards above already show it, so the chat starts at the user's first question.
  const messages = React.useMemo(() => {
    const all = messagesQuery.data || [];
    const firstUser = all.findIndex((message) => message.role === 'user');
    return firstUser < 0 ? [] : all.slice(firstUser).slice(-30);
  }, [messagesQuery.data]);
  const lastCountRef = React.useRef(-1);
  const rx = React.useMemo(() => (report && isRx && isReady ? extractPrescriptionData(report) : null), [report, isRx, isReady]);

  React.useEffect(() => setExpanded(false), [reportId]);

  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardHeight(event?.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Stay at the top when the page opens; only follow the conversation once the user is chatting.
  React.useEffect(() => {
    if (!messagesQuery.isSuccess) return;
    if (lastCountRef.current === -1) {
      lastCountRef.current = messages.length;
      return;
    }
    const grew = messages.length > lastCountRef.current;
    lastCountRef.current = messages.length;
    if (!grew && !askMutation.isPending) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [messages.length, askMutation.isPending, messagesQuery.isSuccess]);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/records');
  };

  const handleOpenOriginal = async () => {
    if (!report) return;
    try {
      const url = await signedUrlMutation.mutateAsync({ filePath: report.filePath });
      await Linking.openURL(url);
    } catch {
      Toast.show({ type: 'error', text1: 'Could not open the file', text2: 'Please try again.' });
    }
  };

  const handleRetry = () => {
    if (!report || reanalyzeMutation.isPending) return;
    reanalyzeMutation.mutate(
      { reportId: report.id },
      {
        onSuccess: () => {
          setNowMs(Date.now());
          Toast.show({ type: 'success', text1: 'Reading it again', text2: 'Updated results will appear here.' });
        },
        onError: (err: any) => Toast.show({ type: 'error', text1: 'Could not retry', text2: getMedicalReportAnalysisErrorMessage(err?.message) }),
      }
    );
  };

  const handleDelete = async () => {
    if (!report || deleteMutation.isPending) return;
    const ok = await confirmAction({ title: 'Delete this report?', message: 'It will be removed from your reports. This cannot be undone.', confirmText: 'Delete', destructive: true });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync({ reportId: report.id });
      Toast.show({ type: 'success', text1: 'Report deleted' });
      handleBack();
    } catch {
      Toast.show({ type: 'error', text1: 'Could not delete', text2: 'Please try again.' });
    }
  };

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || !report?.id || askMutation.isPending) return;
    setQuestionInput('');
    // Show the patient's question at once, like any chat app, instead of waiting for the server to store it.
    setPendingQuestion(question);
    try {
      await askMutation.mutateAsync({ reportId: report.id, question });
    } catch (error: any) {
      // The hook already turns server failures into a readable sentence.
      Toast.show({ type: 'error', text1: 'Could not ask AI', text2: error?.message || 'Please try again in a moment.' });
      setQuestionInput(question);
    } finally {
      setPendingQuestion(null);
    }
  };

  const markdownStyles = React.useMemo(
    () => ({
      body: { color: theme.text, fontSize: 15, lineHeight: 22 },
      paragraph: { marginTop: 0, marginBottom: 8 },
      heading1: { color: theme.text, fontSize: 17, fontWeight: '700' as const, marginBottom: 6 },
      heading2: { color: theme.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 6 },
      heading3: { color: theme.text, fontSize: 15, fontWeight: '700' as const, marginBottom: 4 },
      strong: { color: theme.text, fontWeight: '700' as const },
      bullet_list_icon: { color: theme.primary },
      list_item: { marginTop: 1, marginBottom: 2 },
      link: { color: theme.primary },
    }),
    [theme]
  );

  const kind = report ? getReportKind(report) : 'other';
  const KindIcon = isRx ? Pill : kind === 'lab' ? FlaskConical : FileText;
  const title = report ? getReportTitle(report) : '';
  const { date, isUploadDate } = report ? getReportDate(report) : { date: null, isUploadDate: true };
  const identity: any = (report?.aiStructured as any)?.report_identity || {};
  const labName = String(identity.lab_name || '').trim();
  const fullSummary = report ? getPlainSummary(report, 4000) : '';
  const shortSummary = report ? getPlainSummary(report, 320) : '';
  const canExpand = fullSummary.length > shortSummary.length + 20;
  const values = report && isReady && !isRx ? getHighlights(report, 40) : [];
  const attention = report && isReady && !isRx ? getAttentionItems(report, 8) : [];
  const followUps = report && isReady ? getFollowUps(report, 5) : [];
  const canChat = isReady;
  const suggestions = isRx ? SUGGESTIONS_RX : SUGGESTIONS_REPORT;
  const busy = signedUrlMutation.isPending || deleteMutation.isPending;

  const flagStyle = (flag: string) =>
    flag === 'high' || flag === 'low'
      ? { bg: theme.dangerSoft, fg: theme.danger, label: flag === 'high' ? 'High' : 'Low' }
      : flag === 'normal'
        ? { bg: theme.successLight, fg: theme.success, label: 'Normal' }
        : { bg: theme.surfaceMuted, fg: theme.textSecondary, label: '' };

  const Wrapper: any = Platform.OS === 'ios' ? KeyboardAvoidingView : View;
  const wrapperProps = Platform.OS === 'ios' ? { behavior: 'padding' as const } : {};

  return (
    <Wrapper style={[styles.screen, { backgroundColor: theme.background, paddingBottom: Platform.OS === 'android' && keyboardHeight > 0 ? keyboardHeight + 2 : 0 }]} {...wrapperProps}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.divider, backgroundColor: theme.background }]}>
        <Pressable onPress={handleBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8} style={[styles.backBtn, { backgroundColor: theme.surfaceMuted }]}>
          <ArrowLeft size={20} color={theme.text} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={[Typography.heading, { color: theme.text }]} numberOfLines={1}>{report ? (isRx ? 'Prescription' : 'Report explained') : 'Report'}</Text>
        </View>
      </View>

      {reportsQuery.isLoading && !report ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : !report ? (
        <View style={styles.center}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.surfaceMuted }]}>
            <AlertTriangle size={26} color={theme.textSecondary} />
          </View>
          <Text style={[Typography.heading, { color: theme.text }]}>Report not found</Text>
          <Text style={[Typography.body, { color: theme.textSecondary, textAlign: 'center' }]}>It may have been deleted.</Text>
          <Pressable onPress={handleBack} accessibilityRole="button" style={[styles.cta, { backgroundColor: theme.buttonPrimary }]}>
            <Text style={styles.ctaText}>Back to Reports</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            <View style={styles.inner}>
              <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}>
                <View style={styles.titleRow}>
                  <View style={[styles.kindTile, { backgroundColor: theme.primarySoft }]}>
                    <KindIcon size={22} color={theme.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={[Typography.subheading, { color: theme.text }]} numberOfLines={2}>{title}</Text>
                    <Text style={[Typography.caption, { color: theme.textSecondary }]} numberOfLines={2}>
                      {[formatShortDate(date) ? `${isUploadDate ? 'Added ' : ''}${formatShortDate(date)}` : '', labName].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>

                {state === 'scanning' ? (
                  <AnalysisProgress
                    since={report.updatedAt || report.createdAt}
                    isPdf={/pdf/i.test(report.mimeType || '') || /\.pdf$/i.test(report.fileName || '')}
                    isPrescription={isRx}
                  />
                ) : null}

                {state === 'stuck' || state === 'failed' ? (
                  <View style={[styles.notice, styles.noticeCol, { backgroundColor: theme.warningSoft }]}>
                    <View style={styles.noticeRow}>
                      <AlertTriangle size={18} color={theme.warning} />
                      <Text style={[Typography.bodyStrong, { color: theme.warning }]}>{state === 'stuck' ? 'This is taking longer than usual' : 'We could not read this report'}</Text>
                    </View>
                    <Text style={[Typography.body, { color: theme.textSecondary }]}>
                      {state === 'stuck' ? 'The scan did not finish. Try again; your file is safe.' : getMedicalReportAnalysisErrorMessage(report.analysisError)}
                    </Text>
                    <Pressable onPress={handleRetry} disabled={reanalyzeMutation.isPending} accessibilityRole="button" style={[styles.retry, { backgroundColor: theme.buttonPrimary, opacity: reanalyzeMutation.isPending ? 0.6 : 1 }]}>
                      <RefreshCw size={15} color="#FFFFFF" />
                      <Text style={styles.ctaText}>{reanalyzeMutation.isPending ? 'Trying…' : 'Try again'}</Text>
                    </Pressable>
                  </View>
                ) : null}

                {isReady && fullSummary ? (
                  <View style={styles.summaryBlock}>
                    <SectionTitle color={theme.textTertiary}>IN SIMPLE WORDS</SectionTitle>
                    <Text style={[Typography.body, { color: theme.text }]}>{expanded ? fullSummary : shortSummary}</Text>
                    {canExpand ? (
                      <Pressable onPress={() => setExpanded((prev) => !prev)} accessibilityRole="button" hitSlop={8}>
                        <Text style={[Typography.label, { color: theme.primary }]}>{expanded ? 'Show less' : 'Read more'}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>

              {attention.length > 0 && values.length === 0 ? (
                <View style={[styles.card, { backgroundColor: theme.dangerSoft, borderColor: theme.borderColor }]}>
                  <View style={styles.noticeRow}>
                    <AlertTriangle size={18} color={theme.danger} />
                    <Text style={[Typography.subheading, { color: theme.danger }]}>Needs your attention</Text>
                  </View>
                  {attention.map((line) => (
                    <View key={line} style={styles.bulletRow}>
                      <View style={[styles.dot, { backgroundColor: theme.danger }]} />
                      <Text style={[Typography.body, { color: theme.text, flex: 1 }]}>{line}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {values.length > 0 ? (
                <View style={styles.section}>
                  <SectionTitle color={theme.textTertiary}>YOUR VALUES</SectionTitle>
                  <View style={[styles.card, styles.tableCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    {values.map((item, index) => {
                      const flag = flagStyle(item.flag);
                      return (
                        <View key={`${item.name}-${index}`} style={[styles.valueRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: theme.divider }]}>
                          <View style={styles.flex}>
                            <Text style={[Typography.bodyStrong, { color: theme.text }]}>{item.name}</Text>
                            {item.reference ? <Text style={[Typography.caption, { color: theme.textSecondary }]}>Normal: {item.reference} {item.unit}</Text> : null}
                          </View>
                          <View style={styles.valueRight}>
                            <Text style={[Typography.bodyStrong, { color: item.flag === 'high' || item.flag === 'low' ? theme.danger : theme.text }]}>
                              {item.value} <Text style={[Typography.caption, { color: theme.textSecondary }]}>{item.unit}</Text>
                            </Text>
                            {flag.label ? (
                              <View style={[styles.flagChip, { backgroundColor: flag.bg }]}>
                                <Text style={[styles.flagText, { color: flag.fg }]}>{flag.label}</Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {rx && rx.medicines.length > 0 ? (
                <View style={styles.section}>
                  <SectionTitle color={theme.textTertiary}>{`MEDICINES (${rx.medicines.length})`}</SectionTitle>
                  {rx.medicines.map((med, index) => (
                    <View key={`${med.name}-${index}`} style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}>
                      <View style={styles.titleRow}>
                        <View style={[styles.kindTile, { backgroundColor: theme.primarySoft }]}>
                          <Pill size={20} color={theme.primary} />
                        </View>
                        <View style={styles.flex}>
                          <Text style={[Typography.subheading, { color: theme.text }]}>{med.name}</Text>
                          {med.purpose ? <Text style={[Typography.caption, { color: theme.textSecondary }]}>{med.purpose}</Text> : null}
                        </View>
                      </View>
                      <View style={styles.chips}>
                        {[med.dosage, med.frequency, med.timing, med.duration].filter(Boolean).map((chip) => (
                          <View key={chip} style={[styles.chip, { backgroundColor: theme.surfaceMuted }]}>
                            <Text style={[styles.chipText, { color: theme.text }]}>{chip}</Text>
                          </View>
                        ))}
                      </View>
                      {med.instructions ? <Text style={[Typography.body, { color: theme.textSecondary }]}>{med.instructions}</Text> : null}
                    </View>
                  ))}
                </View>
              ) : null}

              {rx ? (
                <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                  <SectionTitle color={theme.textTertiary}>PRESCRIPTION DETAILS</SectionTitle>
                  {[
                    ['Doctor', rx.doctorName || rx.followupPhysician],
                    ['Patient', [rx.patientName, [rx.age, rx.sex].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')],
                    ['Date', rx.prescribedOn || rx.date],
                    ['Diagnosis', rx.diagnosis],
                    ['Allergies', rx.allergies],
                    ['Diet', rx.dietToFollow],
                    ['Follow-up', rx.followupDate],
                  ]
                    .filter(([, value]) => value && value.trim())
                    .map(([label, value]) => (
                      <View key={label} style={styles.detailRow}>
                        <Text style={[Typography.caption, { color: theme.textSecondary, width: 78 }]}>{label}</Text>
                        <Text style={[Typography.body, { color: theme.text, flex: 1 }]}>{value}</Text>
                      </View>
                    ))}
                  {rx.doctorNotes ? <Text style={[Typography.body, { color: theme.textSecondary }]}>{rx.doctorNotes}</Text> : null}
                </View>
              ) : null}

              {rx && rx.redFlags.length > 0 ? (
                <View style={[styles.card, { backgroundColor: theme.dangerSoft, borderColor: theme.borderColor }]}>
                  <View style={styles.noticeRow}>
                    <ShieldAlert size={18} color={theme.danger} />
                    <Text style={[Typography.subheading, { color: theme.danger }]}>Get urgent help if</Text>
                  </View>
                  {rx.redFlags.map((line) => (
                    <View key={line} style={styles.bulletRow}>
                      <View style={[styles.dot, { backgroundColor: theme.danger }]} />
                      <Text style={[Typography.body, { color: theme.text, flex: 1 }]}>{line}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {(rx ? [...rx.generalInstructions, ...rx.precautions] : followUps).length > 0 ? (
                <View style={styles.section}>
                  <SectionTitle color={theme.textTertiary}>{rx ? 'HOW TO FOLLOW THIS' : 'SUGGESTED NEXT STEPS'}</SectionTitle>
                  <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    {(rx ? [...rx.generalInstructions, ...rx.precautions] : followUps).map((line) => (
                      <View key={line} style={styles.bulletRow}>
                        <View style={[styles.dot, { backgroundColor: theme.primary }]} />
                        <Text style={[Typography.body, { color: theme.text, flex: 1 }]}>{line}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {isReady ? (
                <View style={[styles.disclaimer, { backgroundColor: theme.primarySoft }]}>
                  <ShieldAlert size={16} color={theme.primary} />
                  <Text style={[Typography.caption, { color: theme.textSecondary, flex: 1 }]}>
                    AI can make mistakes reading a photo. Check names, doses and values against your original, and talk to your doctor before changing any medicine.
                  </Text>
                </View>
              ) : null}

              <View style={styles.actionsRow}>
                <Pressable onPress={handleOpenOriginal} disabled={busy} accessibilityRole="button" style={[styles.action, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
                  {signedUrlMutation.isPending ? <ActivityIndicator size="small" color={theme.primary} /> : <ExternalLink size={15} color={theme.text} />}
                  <Text style={[styles.actionText, { color: theme.text }]}>Open original</Text>
                </Pressable>
                <Pressable onPress={handleDelete} disabled={busy} accessibilityRole="button" accessibilityLabel="Delete report" style={[styles.action, { borderColor: theme.dangerSoft, backgroundColor: theme.dangerSoft }]}>
                  <Trash2 size={15} color={theme.danger} />
                  <Text style={[styles.actionText, { color: theme.danger }]}>Delete</Text>
                </Pressable>
              </View>

              {canChat ? (
                <View style={styles.section}>
                  <SectionTitle color={theme.textTertiary}>{`ASK AI ABOUT THIS ${isRx ? 'PRESCRIPTION' : 'REPORT'}`}</SectionTitle>
                  {messages.length === 0 && !askMutation.isPending ? (
                    <View style={styles.chips}>
                      {suggestions.map((text) => (
                        <Pressable key={text} onPress={() => ask(text)} accessibilityRole="button" style={[styles.suggestion, { borderColor: theme.primary, backgroundColor: theme.primarySoft }]}>
                          <Sparkles size={13} color={theme.primary} />
                          <Text style={[styles.suggestionText, { color: theme.primary }]}>{text}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {messages.map((message) => (
                    <View key={message.id} style={[styles.bubbleRow, message.role === 'user' ? styles.rowEnd : styles.rowStart]}>
                      <View
                        style={[
                          styles.bubble,
                          message.role === 'user'
                            ? { backgroundColor: theme.buttonPrimary }
                            : { backgroundColor: theme.cardBackground, borderColor: theme.borderColor, borderWidth: 1 },
                        ]}
                      >
                        {message.role === 'assistant' ? (
                          <Markdown style={markdownStyles}>{formatAssistantMessageForMarkdown(message.content)}</Markdown>
                        ) : (
                          <Text style={[Typography.body, { color: '#FFFFFF' }]}>{message.content}</Text>
                        )}
                      </View>
                    </View>
                  ))}
                  {pendingQuestion ? (
                    <View style={[styles.bubbleRow, styles.rowEnd]}>
                      <View style={[styles.bubble, { backgroundColor: theme.buttonPrimary }]}>
                        <Text style={[Typography.body, { color: '#FFFFFF' }]}>{pendingQuestion}</Text>
                      </View>
                    </View>
                  ) : null}
                  {askMutation.isPending ? (
                    <View style={[styles.bubbleRow, styles.rowStart]}>
                      <View style={[styles.bubble, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor, borderWidth: 1 }]}>
                        <ThinkingIndicator />
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          </ScrollView>

          {canChat ? (
            <View style={[styles.inputBar, { borderTopColor: theme.divider, backgroundColor: theme.background, paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={styles.inputInner}>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                  value={questionInput}
                  onChangeText={setQuestionInput}
                  placeholder="Ask a question about this report"
                  placeholderTextColor={theme.textTertiary}
                  editable={!askMutation.isPending}
                  onSubmitEditing={() => ask(questionInput)}
                  returnKeyType="send"
                  multiline
                />
                <Pressable
                  onPress={() => ask(questionInput)}
                  disabled={!questionInput.trim() || askMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Send question"
                  style={[styles.send, { backgroundColor: questionInput.trim() && !askMutation.isPending ? theme.buttonPrimary : theme.surfaceMuted }]}
                >
                  <Send size={17} color={questionInput.trim() && !askMutation.isPending ? '#FFFFFF' : theme.textTertiary} />
                </Pressable>
              </View>
            </View>
          ) : null}
        </>
      )}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xxl },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cta: { height: 46, borderRadius: Radius.md, paddingHorizontal: Spacing.xxl, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  ctaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  scrollContent: { alignItems: 'center', paddingBottom: Spacing.xxl },
  inner: { width: '100%', maxWidth: Layout.contentMaxWidth + 160, paddingHorizontal: Layout.screenGutter, paddingTop: Spacing.lg, gap: Spacing.lg },
  card: { borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md },
  tableCard: { paddingVertical: Spacing.xs, gap: 0 },
  section: { gap: Spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  kindTile: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: Radius.md, padding: Spacing.md },
  noticeCol: { flexDirection: 'column', alignItems: 'stretch' },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  retry: { height: 42, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  summaryBlock: { gap: Spacing.sm },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  valueRight: { alignItems: 'flex-end', gap: 4, maxWidth: '48%', flexShrink: 1 },
  flagChip: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  flagText: { fontSize: 11, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: '600' },
  detailRow: { flexDirection: 'row', gap: Spacing.sm },
  disclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  action: { height: 42, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontSize: 13, fontWeight: '700' },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  suggestionText: { fontSize: 13, fontWeight: '600' },
  bubbleRow: { flexDirection: 'row' },
  rowEnd: { justifyContent: 'flex-end' },
  rowStart: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '88%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  inputBar: { borderTopWidth: StyleSheet.hairlineWidth * 2, alignItems: 'center', paddingTop: Spacing.sm, paddingHorizontal: Layout.screenGutter },
  inputInner: { width: '100%', maxWidth: Layout.contentMaxWidth + 120, flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  input: { flex: 1, minHeight: 46, maxHeight: 120, borderWidth: 1, borderRadius: 23, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 15 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
