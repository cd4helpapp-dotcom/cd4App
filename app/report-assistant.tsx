import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Linking,
  Alert,
} from 'react-native';
import { useColorScheme } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Markdown from 'react-native-markdown-display';
import Toast from 'react-native-toast-message';
import { ArrowLeft, Send, Trash2, AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react-native';
import Colors, { Theme } from '../constants/Colors';
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
import { supabase } from '../src/lib/supabase';

const formatDate = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
};

const getStatusLabel = (status: MedicalReport['analysisStatus']): string => {
  if (status === 'completed') return 'Analyzed';
  if (status === 'processing') return 'Scanning';
  if (status === 'failed') return 'Failed';
  return 'Pending';
};

const getStatusColor = (status: MedicalReport['analysisStatus'], theme: Theme): { bg: string; text: string } => {
  if (status === 'completed') {
    return { bg: theme.successLight, text: theme.success };
  }
  if (status === 'processing' || status === 'pending') {
    return { bg: theme.cardBackground, text: theme.textSecondary };
  }
  return { bg: '#FFE9E9', text: '#D9534F' };
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

interface NonPrescriptionCarePlan {
  highlights: string[];
  nextSteps: string[];
  supplements: string[];
  cautions: string[];
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

const displayOrFallback = (value: string, fallback: string = 'Not clearly visible'): string =>
  value && value.trim() ? value.trim() : fallback;

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

const extractSupplementHints = (items: string[], maxItems: number = 4): string[] => {
  if (!Array.isArray(items) || items.length === 0) return [];

  const supplementRegex =
    /\b(vit(?:amin)?\s?[a-z0-9-]*|omega[\s-]?3|iron|zinc|calcium|magnesium|folic acid|folate|b12|d3|probiotic|electrolyte|protein)\b/i;
  const dedupe = new Set<string>();
  const rows: string[] = [];

  for (const raw of items) {
    if (rows.length >= maxItems) break;
    const line = (raw || '').trim();
    if (!line || !supplementRegex.test(line)) continue;
    const key = line.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    rows.push(line);
  }
  return rows;
};

const extractNonPrescriptionCarePlan = (report: MedicalReport): NonPrescriptionCarePlan => {
  const structured = typeof report.aiStructured === 'object' && report.aiStructured ? report.aiStructured : {};
  const parsed = parseLooseJsonObject(report.aiSummary || '') || {};

  const keyPoints = [
    ...toTextArray(report.aiKeyPoints, 12),
    ...toTextList((parsed as any).key_points || (parsed as any).keyPoints, 12),
  ];
  const highlights = Array.from(new Set(keyPoints.map((item) => item.trim()).filter(Boolean))).slice(0, 5);

  const nextStepsPrimary = toTextList(
    (structured as any).next_24h_actions ||
      (structured as any).suggested_followups ||
      (structured as any).suggestedFollowups ||
      (parsed as any).next_24h_actions ||
      (parsed as any).suggested_followups ||
      (parsed as any).suggestedFollowups,
    6
  );

  const nextSteps = nextStepsPrimary.length > 0 ? nextStepsPrimary : highlights.slice(0, 4);

  const cautions = toTextList(
    (structured as any).caution_flags ||
      (structured as any).cautionFlags ||
      (parsed as any).caution_flags ||
      (parsed as any).cautionFlags,
    5
  );

  const supplements = extractSupplementHints([...highlights, ...nextSteps, ...cautions], 4);

  return {
    highlights,
    nextSteps,
    supplements,
    cautions,
  };
};

const getNormalizedReportInsights = (report: MedicalReport): { summary: string; keyPoints: string[] } => {
  const rawSummary = (report.aiSummary || '').trim();
  let summary = rawSummary;
  let keyPoints = toTextArray(report.aiKeyPoints);

  if (rawSummary) {
    const parsed = parseLooseJsonObject(rawSummary);
    if (parsed) {
      const parsedSummary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
      const parsedExplanation =
        typeof parsed.patient_friendly_explanation === 'string'
          ? parsed.patient_friendly_explanation.trim()
          : '';
      const parsedKeyPoints = toTextArray(parsed.key_points ?? parsed.keyPoints);

      if (parsedExplanation || parsedSummary) {
        summary = parsedExplanation || parsedSummary;
      }
      if (keyPoints.length === 0 && parsedKeyPoints.length > 0) {
        keyPoints = parsedKeyPoints;
      }
    }
  }

  return { summary, keyPoints };
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

const buildReportSummaryMarkdown = (
  report: MedicalReport,
  normalizedSummary: string,
  keyPoints: string[],
  expanded: boolean
): string => {
  if (report.analysisStatus === 'failed') {
    return [
      `⚠️ ${getMedicalReportAnalysisErrorMessage(report.analysisError)}`,
    ].join('\n');
  }
  if (report.analysisStatus === 'processing') {
    return [
      '- 🔄 AI is scanning this report. This may take a few moments.',
      '- 💬 You can ask questions right after scan completes.',
    ].join('\n');
  }
  if (report.analysisStatus === 'pending') {
    return [
      '- ✅ Upload successful. AI scan is queued.',
      '- 🕒 Summary will appear here once processing finishes.',
    ].join('\n');
  }

  const summary = (normalizedSummary || '').trim();
  const points = expanded ? keyPoints : keyPoints.slice(0, 3);
  const cautions = toTextArray(report.aiStructured?.caution_flags ?? report.aiStructured?.cautionFlags, expanded ? 8 : 3);
  const followUps = toTextArray(report.aiStructured?.suggested_followups ?? report.aiStructured?.suggestedFollowups, expanded ? 8 : 3);
  const identity = normalizeReportIdentityForView(
    report.aiStructured?.report_identity ?? report.aiStructured?.reportIdentity ?? {}
  );
  const parameterHighlights = toTextArray(
    report.aiStructured?.parameter_highlights ?? report.aiStructured?.parameterHighlights,
    expanded ? 12 : 4
  );
  const abnormalFindings = toTextArray(
    report.aiStructured?.abnormal_findings ?? report.aiStructured?.abnormalFindings,
    expanded ? 8 : 3
  );
  const normalFindings = toTextArray(
    report.aiStructured?.normal_findings ?? report.aiStructured?.normalFindings,
    expanded ? 6 : 2
  );
  const missingSections = toTextArray(
    report.aiStructured?.missing_sections ?? report.aiStructured?.missingSections,
    expanded ? 8 : 2
  );
  const confidenceNote =
    typeof report.aiStructured?.confidence_note === 'string'
      ? report.aiStructured.confidence_note.trim()
      : typeof report.aiStructured?.confidenceNote === 'string'
        ? report.aiStructured.confidenceNote.trim()
        : '';
  const summaryLine = summary ? (expanded ? summary : summary.slice(0, 360).trim()) : '';

  const lines: string[] = [];

  const identityLines = [
    identity.patient_name ? `Patient: ${identity.patient_name}` : '',
    identity.age ? `Age: ${identity.age}` : '',
    identity.gender ? `Gender: ${identity.gender}` : '',
    identity.lab_name ? `Lab: ${identity.lab_name}` : '',
    identity.report_date ? `Report date: ${identity.report_date}` : '',
    identity.sample_collected_at ? `Sample collected: ${identity.sample_collected_at}` : '',
    identity.report_id ? `Report/Lab ID: ${identity.report_id}` : '',
    identity.referred_by ? `Referred by: ${identity.referred_by}` : '',
  ].filter(Boolean);

  if (identityLines.length > 0) {
    lines.push('### Report Snapshot');
    lines.push(...identityLines.map((line) => `- 🧾 ${line}`));
    lines.push('');
  }

  if (summaryLine) {
    lines.push('### Quick Summary');
    lines.push(`${containsEmoji(summaryLine) ? summaryLine : `🙂 ${summaryLine}`}`);
  } else {
    lines.push('- ℹ️ AI summary will appear here after scan.');
  }

  if (parameterHighlights.length > 0) {
    lines.push('', '### Exact Values Seen', ...parameterHighlights.map((item) => `- 📈 ${item}`));
  }

  if (points.length > 0) {
    lines.push('', '### Key Findings', ...points.map((point) => `- 🔎 ${point}`));
  }

  if (abnormalFindings.length > 0) {
    lines.push('', '### Needs Attention', ...abnormalFindings.map((item) => `- 🚩 ${item}`));
  }

  if (normalFindings.length > 0) {
    lines.push('', '### Reassuring Findings', ...normalFindings.map((item) => `- ✅ ${item}`));
  }

  if (cautions.length > 0) {
    lines.push('', '### Watchouts', ...cautions.map((item) => `- ⚠️ ${item}`));
  }

  if (followUps.length > 0) {
    lines.push('', '### Next Steps', ...followUps.map((item) => `- ✅ ${item}`));
  }

  if (missingSections.length > 0) {
    lines.push('', '### Not Clearly Visible', ...missingSections.map((item) => `- 👀 ${item}`));
  }

  if (confidenceNote) {
    lines.push('', '### Reading Confidence', `- ℹ️ ${confidenceNote}`);
  }

  return lines.join('\n').trim();
};

const normalizeRouteParam = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
};

const toMedicalReportStatus = (value: unknown): MedicalReport['analysisStatus'] | null => {
  if (value === 'pending' || value === 'processing' || value === 'completed' || value === 'failed') {
    return value;
  }
  return null;
};

const ANALYSIS_STATUS_FAST_POLL_MS = 4000;
const ANALYSIS_STATUS_MEDIUM_POLL_MS = 8000;
const ANALYSIS_STATUS_SLOW_POLL_MS = 12000;
const ANALYSIS_STATUS_MAX_POLL_MS = 2 * 60 * 1000;

export default function ReportAssistantScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const warningSurface = React.useMemo(
    () => ({
      bg: `${theme.tint}14`,
      border: `${theme.tint}4A`,
      text: theme.tint,
      mutedText: theme.textSecondary,
    }),
    [theme]
  );
  const dangerSurface = React.useMemo(
    () => ({
      bg: `${theme.error}16`,
      border: `${theme.error}55`,
      text: theme.error,
      mutedText: theme.textSecondary,
    }),
    [theme]
  );
  const params = useLocalSearchParams<{ reportId?: string | string[]; mode?: string | string[] }>();
  const reportId = normalizeRouteParam(params.reportId);
  const requestedMode = normalizeRouteParam(params.mode).toLowerCase();
  const isPrescriptionIntent = requestedMode === 'prescription';

  const [questionInput, setQuestionInput] = React.useState('');
  const [isSummaryExpanded, setIsSummaryExpanded] = React.useState(false);
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);
  const contentScrollRef = React.useRef<ScrollView | null>(null);

  const reportsQuery = useMedicalReports();
  const askMutation = useAskMedicalReportQuestion();
  const deleteMutation = useSoftDeleteMedicalReport();
  const reanalyzeMutation = useReanalyzeMedicalReport();
  const signedUrlMutation = useGetMedicalReportFileUrl();

  const selectedReport = React.useMemo(
    () => (reportsQuery.data || []).find((report) => report.id === reportId) || null,
    [reportsQuery.data, reportId]
  );
  const isSelectedPrescription = Boolean(selectedReport && isPrescriptionReport(selectedReport));
  const isPrescriptionMismatch =
    Boolean(selectedReport) &&
    isPrescriptionIntent &&
    selectedReport?.analysisStatus === 'completed' &&
    !isPrescriptionReport(selectedReport);
  const nonPrescriptionCarePlan = React.useMemo(
    () => (selectedReport && isPrescriptionMismatch ? extractNonPrescriptionCarePlan(selectedReport) : null),
    [selectedReport, isPrescriptionMismatch]
  );
  const isReportAnalyzing =
    selectedReport?.analysisStatus === 'processing' || selectedReport?.analysisStatus === 'pending';
  const shouldEnableReportChat =
    Boolean(selectedReport) &&
    selectedReport?.analysisStatus === 'completed';
  const shouldEnableMessagesQuery = Boolean(reportId) && shouldEnableReportChat && !isReportAnalyzing;
  const messagesQuery = useMedicalReportMessages(reportId || null, { enabled: shouldEnableMessagesQuery });
  const reportMessages = messagesQuery.data || [];
  const visibleReportMessages = React.useMemo(
    () => (isReportAnalyzing ? [] : reportMessages),
    [isReportAnalyzing, reportMessages]
  );
  const chatMessagesForRender = React.useMemo(
    () => (visibleReportMessages.length > 16 ? visibleReportMessages.slice(-16) : visibleReportMessages),
    [visibleReportMessages]
  );
  const hasUserInitiatedChat = React.useMemo(
    () => visibleReportMessages.some((message) => message.role === 'user' && String(message.content || '').trim().length > 0),
    [visibleReportMessages]
  );
  const displayedChatMessages = React.useMemo(() => {
    if (hasUserInitiatedChat) return chatMessagesForRender;
    return [];
  }, [chatMessagesForRender, hasUserInitiatedChat]);
  const prescriptionViewData = React.useMemo(() => {
    if (!selectedReport || !isSelectedPrescription || selectedReport.analysisStatus !== 'completed') {
      return null;
    }
    const rxData = extractPrescriptionData(selectedReport);
    const classicMedicineRows = Array.from({ length: 7 }, (_, index) => rxData.medicines[index] || null);
    return { rxData, classicMedicineRows };
  }, [selectedReport, isSelectedPrescription]);
  const selectedReportInsights = React.useMemo(
    () => (selectedReport ? getNormalizedReportInsights(selectedReport) : { summary: '', keyPoints: [] }),
    [selectedReport]
  );
  const summaryMarkdownCollapsed = React.useMemo(
    () =>
      selectedReport
        ? buildReportSummaryMarkdown(selectedReport, selectedReportInsights.summary, selectedReportInsights.keyPoints, false)
        : '',
    [selectedReport, selectedReportInsights]
  );
  const summaryMarkdownExpanded = React.useMemo(
    () =>
      selectedReport
        ? buildReportSummaryMarkdown(selectedReport, selectedReportInsights.summary, selectedReportInsights.keyPoints, true)
        : '',
    [selectedReport, selectedReportInsights]
  );
  const renderedSummaryMarkdown = isSummaryExpanded ? summaryMarkdownExpanded : summaryMarkdownCollapsed;
  const canExpandSummary = summaryMarkdownExpanded.length > summaryMarkdownCollapsed.length + 40;
  const previousAnalysisStatusRef = React.useRef<MedicalReport['analysisStatus'] | null>(null);

  React.useEffect(() => {
    setIsSummaryExpanded(false);
  }, [reportId]);

  React.useEffect(() => {
    if (Platform.OS !== 'android') {
      setKeyboardHeight(0);
      return;
    }

    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      const height = event?.endCoordinates?.height;
      if (typeof height === 'number' && height >= 0) {
        setKeyboardHeight(height);
      }
    });

    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      contentScrollRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(timer);
  }, [reportMessages.length, askMutation.isPending]);

  React.useEffect(() => {
    if (!reportId || !isReportAnalyzing) {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const pollStartedAt = Date.now();
    let attempts = 0;

    const clearPollTimer = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const getNextDelay = (attemptCount: number): number => {
      if (attemptCount <= 3) return ANALYSIS_STATUS_FAST_POLL_MS;
      if (attemptCount <= 8) return ANALYSIS_STATUS_MEDIUM_POLL_MS;
      return ANALYSIS_STATUS_SLOW_POLL_MS;
    };

    const scheduleNextPoll = (attemptCount: number) => {
      if (cancelled) return;
      const elapsed = Date.now() - pollStartedAt;
      if (elapsed >= ANALYSIS_STATUS_MAX_POLL_MS) {
        // Stop endless polling loops if backend status is stuck.
        void reportsQuery.refetch();
        return;
      }
      clearPollTimer();
      pollTimer = setTimeout(() => {
        void poll();
      }, getNextDelay(attemptCount));
    };

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      attempts += 1;
      try {
        const { data, error } = await supabase
          .from('medical_reports')
          .select('analysis_status, updated_at')
          .eq('id', reportId)
          .is('deleted_at', null)
          .maybeSingle();

        if (error) {
          // Keep one safe full refresh fallback if lightweight status fetch fails.
          if (attempts <= 2) {
            await reportsQuery.refetch();
          }
          scheduleNextPoll(attempts);
          return;
        }

        const remoteStatus = toMedicalReportStatus(data?.analysis_status);
        if (remoteStatus === 'completed' || remoteStatus === 'failed') {
          await reportsQuery.refetch();
          return;
        }

        scheduleNextPoll(attempts);
      } finally {
        inFlight = false;
      }
    };

    void poll();
    return () => {
      cancelled = true;
      clearPollTimer();
    };
  }, [isReportAnalyzing, reportId, reportsQuery.refetch]);

  React.useEffect(() => {
    const currentStatus = selectedReport?.analysisStatus || null;
    const previousStatus = previousAnalysisStatusRef.current;

    if (reportId && previousStatus && currentStatus && previousStatus !== currentStatus) {
      const finishedFromProcessing =
        (previousStatus === 'processing' || previousStatus === 'pending') &&
        (currentStatus === 'completed' || currentStatus === 'failed');

      if (finishedFromProcessing && shouldEnableMessagesQuery) {
        void messagesQuery.refetch();
      }
    }

    previousAnalysisStatusRef.current = currentStatus;
  }, [reportId, selectedReport?.analysisStatus, shouldEnableMessagesQuery]);

  const Wrapper = Platform.OS === 'ios' ? KeyboardAvoidingView : View;
  const wrapperProps = Platform.OS === 'ios' ? { behavior: 'padding' as const, keyboardVerticalOffset: 0 } : {};

  const markdownStyles = React.useMemo(
    () => ({
      body: { color: theme.text, fontSize: 13, lineHeight: 20 },
      paragraph: { marginTop: 0, marginBottom: 8 },
      heading1: { color: theme.text, fontSize: 18, lineHeight: 24, fontWeight: '800' as const, marginTop: 2, marginBottom: 8 },
      heading2: { color: theme.text, fontSize: 16, lineHeight: 22, fontWeight: '800' as const, marginTop: 2, marginBottom: 7 },
      heading3: { color: theme.text, fontSize: 14, fontWeight: '700' as const, marginTop: 2, marginBottom: 6 },
      strong: { color: theme.text, fontWeight: '800' as const },
      em: { color: theme.text, fontStyle: 'italic' as const },
      bullet_list: { marginTop: 2, marginBottom: 8 },
      bullet_list_icon: { color: theme.tint },
      bullet_list_content: { color: theme.text },
      ordered_list: { marginTop: 2, marginBottom: 8 },
      ordered_list_icon: { color: theme.tint },
      ordered_list_content: { color: theme.text },
      list_item: { marginTop: 2, marginBottom: 2 },
      blockquote: {
        borderLeftWidth: 3,
        borderLeftColor: theme.tint,
        backgroundColor: theme.tint + '10',
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginTop: 4,
        marginBottom: 8,
      },
      code_inline: {
        color: theme.text,
        backgroundColor: theme.background,
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
      },
      code_block: {
        color: theme.text,
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.borderColor,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginTop: 4,
        marginBottom: 8,
      },
      fence: {
        color: theme.text,
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.borderColor,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginTop: 4,
        marginBottom: 8,
      },
      link: {
        color: theme.tint,
        textDecorationLine: 'underline' as const,
      },
    }),
    [theme]
  );
  const reportSummaryMarkdownStyles = React.useMemo(
    () => ({
      body: { color: theme.textSecondary, fontSize: 12, lineHeight: 19 },
      paragraph: { marginTop: 0, marginBottom: 8 },
      heading1: { color: theme.text, fontSize: 16, lineHeight: 22, fontWeight: '800' as const, marginTop: 2, marginBottom: 8 },
      heading2: { color: theme.text, fontSize: 14, lineHeight: 20, fontWeight: '800' as const, marginTop: 2, marginBottom: 6 },
      heading3: { color: theme.text, fontSize: 13, fontWeight: '700' as const, marginTop: 2, marginBottom: 6 },
      strong: { color: theme.text, fontWeight: '800' as const },
      em: { color: theme.textSecondary, fontStyle: 'italic' as const },
      bullet_list: { marginTop: 2, marginBottom: 7 },
      bullet_list_icon: { color: theme.success },
      bullet_list_content: { color: theme.textSecondary },
      ordered_list_icon: { color: theme.success },
      ordered_list_content: { color: theme.textSecondary },
      list_item: { marginTop: 1, marginBottom: 2 },
      link: { color: theme.tint, textDecorationLine: 'underline' as const },
    }),
    [theme]
  );

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/records');
  };

  const handleOpenOriginalFile = async () => {
    if (!selectedReport) return;
    try {
      const signedUrl = await signedUrlMutation.mutateAsync({ filePath: selectedReport.filePath });
      await Linking.openURL(signedUrl);
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Open failed',
        text2: 'Could not open this report file. Please try again.',
      });
    }
  };

  const handleDeleteSelectedReport = () => {
    if (!selectedReport || deleteMutation.isPending) return;

    Alert.alert(
      'Delete this report?',
      'This will softly remove the report from your list and keep audit history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteMutation.mutateAsync({ reportId: selectedReport.id });
                Toast.show({
                  type: 'success',
                  text1: 'Report deleted',
                  text2: 'Report was removed from your list.',
                });
                handleBack();
              } catch (error: any) {
                Toast.show({
                  type: 'error',
                  text1: 'Delete failed',
                  text2: 'Could not delete this report right now. Please try again.',
                });
              }
            })();
          },
        },
      ]
    );
  };

  const handleAskQuestion = async () => {
    const question = questionInput.trim();
    if (!question || !selectedReport?.id || askMutation.isPending) return;

    setQuestionInput('');
    try {
      await askMutation.mutateAsync({ reportId: selectedReport.id, question });
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Could not ask AI',
        text2: getMedicalReportAnalysisErrorMessage(error?.message),
      });
      setQuestionInput(question);
    }
  };

  return (
    <Wrapper
      style={[
        styles.screen,
        {
          backgroundColor: theme.background,
          paddingBottom: Platform.OS === 'android' ? (keyboardHeight > 0 ? keyboardHeight + 2 : 0) : 0,
        },
      ]}
      {...wrapperProps}
    >
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top + 6,
          },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: theme.borderColor }]}>
          <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.85}>
            <ArrowLeft size={20} color={theme.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>
              {selectedReport && isPrescriptionReport(selectedReport)
                ? 'Prescription Details'
                : isPrescriptionIntent
                ? 'Prescription Check'
                : 'Report Assistant'}
            </Text>
            <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
              {selectedReport && isPrescriptionReport(selectedReport)
                ? 'Medicines and instructions from uploaded prescription'
                : isPrescriptionIntent
                ? 'Prescription-only mode: upload doctor prescription for best output'
                : 'Understand your report better'}
            </Text>
          </View>
        </View>

        {reportsQuery.isLoading && !selectedReport ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="small" color={theme.success} />
            <Text style={[styles.centerStateText, { color: theme.textSecondary }]}>Loading report...</Text>
          </View>
        ) : null}

        {!reportsQuery.isLoading && !selectedReport ? (
          <View style={[styles.notFoundCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <AlertTriangle size={18} color={theme.textSecondary} />
            <Text style={[styles.notFoundTitle, { color: theme.text }]}>Report not found</Text>
            <Text style={[styles.notFoundSubtitle, { color: theme.textSecondary }]}>
              This report may have been deleted or is no longer available.
            </Text>
            <TouchableOpacity style={[styles.goBackBtn, { backgroundColor: theme.tint }]} onPress={handleBack} activeOpacity={0.85}>
              <Text style={styles.goBackBtnText}>Back to Reports</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isPrescriptionMismatch ? (
          <View style={[styles.rxMismatchCard, { backgroundColor: warningSurface.bg, borderColor: warningSurface.border }]}>
            <AlertTriangle size={16} color={warningSurface.text} />
            <Text style={[styles.rxMismatchText, { color: warningSurface.text }]}>
              This file looks like a lab report, not a doctor prescription. Prescription view works best with Rx files/images.
            </Text>
          </View>
        ) : null}

        {isPrescriptionMismatch && nonPrescriptionCarePlan ? (
          <View style={[styles.nonRxPlanCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <Text style={[styles.nonRxPlanTitle, { color: theme.text }]}>AI Care Plan (Not a Prescription)</Text>

            {nonPrescriptionCarePlan.highlights.length > 0 ? (
              <>
                <Text style={[styles.nonRxPlanSectionTitle, { color: theme.text }]}>Report Highlights</Text>
                {nonPrescriptionCarePlan.highlights.slice(0, 4).map((item, idx) => (
                  <Text key={`highlight-${idx}`} style={[styles.nonRxPlanItem, { color: theme.textSecondary }]}>
                    • {item}
                  </Text>
                ))}
              </>
            ) : null}

            {nonPrescriptionCarePlan.nextSteps.length > 0 ? (
              <>
                <Text style={[styles.nonRxPlanSectionTitle, { color: theme.text }]}>Suggested Next Steps</Text>
                {nonPrescriptionCarePlan.nextSteps.slice(0, 4).map((item, idx) => (
                  <Text key={`step-${idx}`} style={[styles.nonRxPlanItem, { color: theme.textSecondary }]}>
                    • {item}
                  </Text>
                ))}
              </>
            ) : null}

            {nonPrescriptionCarePlan.supplements.length > 0 ? (
              <>
                <Text style={[styles.nonRxPlanSectionTitle, { color: theme.text }]}>
                  Ask Your Doctor About These Supplements
                </Text>
                {nonPrescriptionCarePlan.supplements.map((item, idx) => (
                  <Text key={`supp-${idx}`} style={[styles.nonRxPlanItem, { color: theme.textSecondary }]}>
                    • {item}
                  </Text>
                ))}
              </>
            ) : null}

            {nonPrescriptionCarePlan.cautions.length > 0 ? (
              <>
                <Text style={[styles.nonRxPlanSectionTitle, { color: dangerSurface.text }]}>Cautions</Text>
                {nonPrescriptionCarePlan.cautions.slice(0, 3).map((item, idx) => (
                  <Text key={`caution-${idx}`} style={[styles.nonRxPlanItem, { color: dangerSurface.text }]}>
                    • {item}
                  </Text>
                ))}
              </>
            ) : null}

            <Text style={[styles.nonRxPlanDisclaimer, { color: warningSurface.text }]}>
              This is guidance only. Medicine start/stop or supplement dose should be decided by a licensed doctor.
            </Text>
          </View>
        ) : null}

        {selectedReport ? (
          <>
            <ScrollView
              ref={contentScrollRef}
              style={styles.content}
              contentContainerStyle={styles.contentContainer}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Dynamic Summary Card (Hidden for completed prescriptions to avoid redundancy) */}
              {selectedReport &&
                !isPrescriptionMismatch &&
                (
                <View style={[styles.reportHeaderCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                  <Text style={[styles.reportFileName, { color: theme.text }]} numberOfLines={2}>
                    {selectedReport.fileName}
                  </Text>
                  <View style={styles.reportHeaderMetaRow}>
                    <View style={[styles.typeBadge, { backgroundColor: getStatusColor(selectedReport.analysisStatus, theme).bg }]}>
                      <Text style={[styles.typeBadgeText, { color: getStatusColor(selectedReport.analysisStatus, theme).text }]}>
                        {getStatusLabel(selectedReport.analysisStatus)}
                      </Text>
                    </View>
                    <Text style={[styles.dateText, { color: theme.textSecondary }]}>
                      {formatDate(selectedReport.analyzedAt || selectedReport.createdAt)}
                    </Text>
                  </View>

                  {!isSelectedPrescription ? (
                    <>
                      <View style={styles.reportSummaryMarkdownWrap}>
                        {selectedReport.analysisStatus === 'processing' || selectedReport.analysisStatus === 'pending' ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <ActivityIndicator size="small" color={theme.success} style={{ marginRight: 8 }} />
                            <Text style={{ color: theme.success, fontWeight: '600', fontSize: 13, flex: 1 }}>
                              Analyzing report...
                            </Text>
                          </View>
                        ) : null}
                        <Markdown style={reportSummaryMarkdownStyles}>{renderedSummaryMarkdown}</Markdown>
                      </View>

                      {canExpandSummary ? (
                        <TouchableOpacity
                          onPress={() => setIsSummaryExpanded((prev) => !prev)}
                          activeOpacity={0.85}
                          style={styles.summaryToggle}
                        >
                          <Text style={[styles.summaryToggleText, { color: theme.success }]}>
                            {isSummaryExpanded ? 'Show less' : 'Show full summary'}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  ) : null}

                  <View style={styles.reportActionsRow}>
                    <TouchableOpacity
                      style={[styles.reportActionBtn, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                      onPress={handleOpenOriginalFile}
                      disabled={signedUrlMutation.isPending || deleteMutation.isPending}
                      activeOpacity={0.85}
                    >
                      {signedUrlMutation.isPending ? (
                        <ActivityIndicator size="small" color={theme.success} />
                      ) : (
                        <Text style={[styles.reportActionText, { color: theme.text }]}>Open Original</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.reportActionBtn, 
                        { 
                          borderColor: theme.tint, 
                          backgroundColor: theme.cardBackground, 
                          opacity: (reanalyzeMutation.isPending || selectedReport?.analysisStatus === 'processing' || selectedReport?.analysisStatus === 'pending') ? 0.7 : 1 
                        }
                      ]}
                      onPress={() => {
                        if (!selectedReport || reanalyzeMutation.isPending) return;
                        reanalyzeMutation.mutate({ reportId: selectedReport.id }, {
                          onSuccess: () => {
                            Toast.show({ type: 'success', text1: 'Re-analysis started', text2: 'Updated results will appear shortly.' });
                          },
                          onError: (err: any) => {
                            Toast.show({ type: 'error', text1: 'Re-analyze failed', text2: getMedicalReportAnalysisErrorMessage(err?.message) });
                          },
                        });
                      }}
                      disabled={reanalyzeMutation.isPending || selectedReport?.analysisStatus === 'processing' || selectedReport?.analysisStatus === 'pending'}
                      activeOpacity={0.85}
                    >
                      {(reanalyzeMutation.isPending || selectedReport?.analysisStatus === 'processing' || selectedReport?.analysisStatus === 'pending') ? (
                        <>
                          <ActivityIndicator size="small" color={theme.tint} />
                          <Text style={[styles.reportActionText, { color: theme.tint, marginLeft: 6 }]}>Analyzing...</Text>
                        </>
                      ) : (
                        <>
                          <RefreshCw size={14} color={theme.tint} />
                          <Text style={[styles.reportActionText, { color: theme.tint, marginLeft: 6 }]}>Re-analyze</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.reportActionBtn,
                        styles.deleteActionBtn,
                        { borderColor: '#E04646', backgroundColor: theme.cardBackground, opacity: deleteMutation.isPending ? 0.7 : 1 },
                      ]}
                      onPress={handleDeleteSelectedReport}
                      disabled={deleteMutation.isPending}
                      activeOpacity={0.85}
                    >
                      {deleteMutation.isPending ? (
                        <ActivityIndicator size="small" color="#E04646" />
                      ) : (
                        <>
                          <Trash2 size={14} color="#E04646" />
                          <Text style={styles.deleteActionText}>Delete</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Premium Prescription View for prescription reports */}
              {selectedReport && isSelectedPrescription && selectedReport.analysisStatus !== 'completed' ? (
                <View style={styles.rxSection}>
                  <View style={[styles.rxNotesCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <Text style={[styles.rxNotesTitle, { color: theme.text }]}>
                      {selectedReport.analysisStatus === 'failed' ? 'Prescription Scan Failed' : 'Preparing Prescription Details'}
                    </Text>
                    <Text style={[styles.rxNotesText, { color: theme.textSecondary }]}>
                      {selectedReport.analysisStatus === 'failed'
                        ? getMedicalReportAnalysisErrorMessage(selectedReport.analysisError) || 'Could not parse this prescription. Please re-upload a clearer image/PDF and re-analyze.'
                        : 'Prescription is uploaded. AI is extracting medicines and details. This may take a few moments.'}
                    </Text>
                  </View>
                </View>
              ) : null}

              {prescriptionViewData ? (() => {
                const { rxData, classicMedicineRows } = prescriptionViewData;
                return (
                  <View style={styles.rxSection}>
                    <View style={[styles.rxClassicCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                      <Text style={[styles.rxClassicTitle, { color: theme.text }]}>Medical Prescription Form</Text>

                      <View style={styles.rxClassicRow}>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Patient Name</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.patientName)}</Text>
                        </View>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Date</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.prescribedOn || rxData.date)}</Text>
                        </View>
                      </View>

                      <View style={styles.rxClassicRow}>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>S/O | D/O | W/O</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.relationTag)}</Text>
                        </View>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Age / Sex</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>
                            {displayOrFallback([rxData.age, rxData.sex].filter(Boolean).join(' / '))}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.rxClassicRow}>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Occupation</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.occupation)}</Text>
                        </View>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Patient ID</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.patientIdNo)}</Text>
                        </View>
                      </View>

                      <View style={styles.rxClassicRow}>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Health Insurance No</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.insuranceNo)}</Text>
                        </View>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Health Provider</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.healthProvider)}</Text>
                        </View>
                      </View>

                      <View style={styles.rxClassicRow}>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Health Card No</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.healthCardNo)}</Text>
                        </View>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Cell No</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.cellNo)}</Text>
                        </View>
                      </View>

                      <View style={[styles.rxClassicSingleRow, { borderColor: theme.borderColor }]}>
                        <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Patient Address</Text>
                        <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.address)}</Text>
                      </View>

                      <View style={[styles.rxClassicSingleRow, { borderColor: theme.borderColor }]}>
                        <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Diagnosed With</Text>
                        <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.diagnosis)}</Text>
                      </View>

                      <View style={styles.rxClassicTripleRow}>
                        <View style={styles.rxClassicTripleCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Blood Pressure</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.bloodPressure)}</Text>
                        </View>
                        <View style={styles.rxClassicTripleCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Pulse Rate</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.pulseRate)}</Text>
                        </View>
                        <View style={styles.rxClassicTripleCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Weight</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.weight)}</Text>
                        </View>
                      </View>

                      <View style={styles.rxClassicRow}>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Allergies</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.allergies)}</Text>
                        </View>
                        <View style={styles.rxClassicCol}>
                          <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Disabilities</Text>
                          <Text style={[styles.rxClassicValue, { color: theme.text }]}>{displayOrFallback(rxData.disabilities)}</Text>
                        </View>
                      </View>

                      <View style={[styles.rxClassicTableWrap, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
                        <View style={[styles.rxClassicTableHeader, { borderColor: theme.borderColor }]}>
                          <Text style={[styles.rxClassicTableHeaderCell, styles.rxClassicNumCol, { color: theme.text }]}>#</Text>
                          <Text style={[styles.rxClassicTableHeaderCell, styles.rxClassicDrugCol, { color: theme.text }]}>Drugs</Text>
                          <Text style={[styles.rxClassicTableHeaderCell, styles.rxClassicUnitCol, { color: theme.text }]}>Unit</Text>
                          <Text style={[styles.rxClassicTableHeaderCell, styles.rxClassicDoseCol, { color: theme.text }]}>Dosage / Day</Text>
                        </View>

                        {classicMedicineRows.map((row, index) => (
                          <View
                            key={`classic-row-${index}`}
                            style={[styles.rxClassicTableRow, { borderColor: theme.borderColor }]}
                          >
                            <Text style={[styles.rxClassicTableCell, styles.rxClassicNumCol, { color: theme.textSecondary }]}>
                              {index + 1}.
                            </Text>
                            <Text style={[styles.rxClassicTableCell, styles.rxClassicDrugCol, { color: theme.text }]}>
                              {row?.name || '-'}
                            </Text>
                            <Text style={[styles.rxClassicTableCell, styles.rxClassicUnitCol, { color: theme.textSecondary }]}>
                              {row?.timing || '-'}
                            </Text>
                            <Text style={[styles.rxClassicTableCell, styles.rxClassicDoseCol, { color: theme.textSecondary }]}>
                              {row ? [row.dosage, row.frequency, row.duration].filter(Boolean).join(' | ') || '-' : '-'}
                            </Text>
                          </View>
                        ))}
                      </View>

                      <View style={[styles.rxClassicSingleRow, { borderColor: theme.borderColor }]}>
                        <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Diet To Follow</Text>
                        <Text style={[styles.rxClassicValue, { color: theme.text }]}>
                          {displayOrFallback(rxData.dietToFollow || rxData.generalInstructions[0] || '')}
                        </Text>
                      </View>

                      <View style={[styles.rxClassicSingleRow, { borderColor: theme.borderColor }]}>
                        <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Brief History of Patient</Text>
                        <Text style={[styles.rxClassicValue, { color: theme.text }]}>
                          {displayOrFallback(rxData.briefHistory || rxData.doctorNotes || '')}
                        </Text>
                      </View>

                      <View style={[styles.rxClassicSingleRow, { borderColor: theme.borderColor }]}>
                        <Text style={[styles.rxClassicLabel, { color: theme.textSecondary }]}>Follow-up Physician</Text>
                        <Text style={[styles.rxClassicValue, { color: theme.text }]}>
                          {displayOrFallback(rxData.followupPhysician || rxData.doctorName)}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.rxNotesCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                      <Text style={[styles.rxNotesTitle, { color: theme.text }]}>Prescription Extraction Status</Text>
                      <Text style={[styles.rxNotesText, { color: theme.textSecondary }]}>
                        Structured in standard prescription form. Always verify medicine name, dose, and duration before use.
                      </Text>
                    </View>

                    {rxData.generalInstructions.length > 0 ? (
                      <View style={[styles.rxNotesCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <Text style={[styles.rxNotesTitle, { color: theme.text }]}>How To Follow This Prescription</Text>
                        {rxData.generalInstructions.map((instruction, index) => (
                          <Text key={index} style={[styles.rxNotesText, { color: theme.textSecondary }]}>• {instruction}</Text>
                        ))}
                      </View>
                    ) : null}

                    {rxData.precautions.length > 0 ? (
                      <View style={[styles.rxPrecautionCard, { backgroundColor: warningSurface.bg, borderColor: warningSurface.border }]}>
                        <Text style={[styles.rxPrecautionTitle, { color: warningSurface.text }]}>Precautions</Text>
                        {rxData.precautions.map((p, i) => (
                          <Text key={i} style={[styles.rxPrecautionItem, { color: warningSurface.text }]}>• {p}</Text>
                        ))}
                      </View>
                    ) : null}

                    {rxData.redFlags.length > 0 ? (
                      <View style={[styles.rxPrecautionCard, { backgroundColor: dangerSurface.bg, borderColor: dangerSurface.border }]}>
                        <Text style={[styles.rxPrecautionTitle, { color: dangerSurface.text }]}>Urgent Warning Signs</Text>
                        {rxData.redFlags.map((flag, i) => (
                          <Text key={i} style={[styles.rxPrecautionItem, { color: dangerSurface.text }]}>• {flag}</Text>
                        ))}
                      </View>
                    ) : null}

                    {rxData.doctorNotes ? (
                      <View style={[styles.rxNotesCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <Text style={[styles.rxNotesTitle, { color: theme.text }]}>Doctor Notes</Text>
                        <Text style={[styles.rxNotesText, { color: theme.textSecondary }]}>{rxData.doctorNotes}</Text>
                      </View>
                    ) : null}

                    <View style={[styles.rxDisclaimer, { backgroundColor: warningSurface.bg, borderColor: warningSurface.border }]}>
                      <ShieldAlert size={16} color={warningSurface.text} />
                      <Text style={[styles.rxDisclaimerText, { color: warningSurface.text }]}>
                        This prescription view is AI-extracted and can contain OCR errors. Always confirm medicine name, dose, timing, and duration with your doctor or pharmacist before use. Do not change or stop medicines based only on AI output.
                      </Text>
                    </View>
                  </View>
                );
              })() : null}

              {shouldEnableReportChat && (displayedChatMessages.length > 0 || askMutation.isPending || isReportAnalyzing) ? (
                <View style={styles.chatSection}>
                  <Text style={[styles.chatTitle, { color: theme.text }]}>
                    {displayedChatMessages.length > 0 || askMutation.isPending
                      ? 'Chat'
                      : 'You can chat about this file below'}
                  </Text>

                  <View style={styles.chatScrollContent}>
                    {displayedChatMessages.map((message) => (
                      <View
                        key={message.id}
                        style={[
                          styles.chatRow,
                          message.role === 'user' ? styles.userRow : styles.aiRow,
                        ]}
                      >
                        <View
                          style={[
                            styles.chatBubble,
                            message.role === 'user'
                              ? [styles.userBubble, { backgroundColor: theme.tint }]
                              : [styles.aiBubble, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }],
                          ]}
                        >
                        {message.role === 'assistant' ? (
                          message.content.length > 1800 ? (
                            <Text style={[styles.chatText, { color: theme.text }]}>
                              {message.content.slice(0, 1800)}...
                            </Text>
                          ) : (
                            <Markdown style={markdownStyles}>{formatAssistantMessageForMarkdown(message.content)}</Markdown>
                          )
                        ) : (
                          <Text style={[styles.chatText, { color: '#fff' }]}>{message.content}</Text>
                        )}
                        </View>
                      </View>
                    ))}

                    {isReportAnalyzing ? (
                      <View style={[styles.chatRow, styles.aiRow]}>
                        <View style={[styles.chatBubble, styles.aiBubble, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                          <ActivityIndicator size="small" color={theme.success} />
                          <Text style={[styles.typingText, { color: theme.textSecondary }]}>AI scan in progress. Fresh report chat will appear after analysis.</Text>
                        </View>
                      </View>
                    ) : null}

                    {askMutation.isPending ? (
                      <View style={[styles.chatRow, styles.aiRow]}>
                        <View style={[styles.chatBubble, styles.aiBubble, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                          <ActivityIndicator size="small" color={theme.success} />
                          <Text style={[styles.typingText, { color: theme.textSecondary }]}>AI is preparing report answer...</Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </ScrollView>

            {selectedReport && shouldEnableReportChat && (
              <View
                style={[
                  styles.chatInputRow,
                  {
                    borderTopColor: theme.borderColor,
                    backgroundColor: theme.background,
                    paddingBottom: Math.max(insets.bottom, 12),
                  },
                ]}
              >
                <TextInput
                  style={[styles.chatInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                  value={questionInput}
                  onChangeText={setQuestionInput}
                  placeholder={"Type your question..."}
                  placeholderTextColor={theme.textSecondary}
                  editable={!askMutation.isPending && selectedReport.analysisStatus !== 'processing'}
                  onSubmitEditing={handleAskQuestion}
                  returnKeyType="send"
                  multiline
                />
                <TouchableOpacity
                  style={[styles.sendBtn, { backgroundColor: questionInput.trim() ? theme.success : theme.borderColor }]}
                  onPress={handleAskQuestion}
                  disabled={!questionInput.trim() || askMutation.isPending || selectedReport.analysisStatus === 'processing'}
                  activeOpacity={0.85}
                >
                  <Send size={15} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : null}
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  headerSubtitle: { marginTop: 1, fontSize: 12, fontWeight: '500' },
  centerState: { marginTop: 30, alignItems: 'center', justifyContent: 'center' },
  centerStateText: { marginTop: 8, fontSize: 12 },
  notFoundCard: {
    margin: 16,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  notFoundTitle: { marginTop: 8, fontSize: 15, fontWeight: '700' },
  notFoundSubtitle: { marginTop: 6, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  goBackBtn: { marginTop: 12, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  goBackBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  rxMismatchCard: {
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  rxMismatchText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#BF360C',
    fontWeight: '600',
  },
  nonRxPlanCard: {
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  nonRxPlanTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 6,
  },
  nonRxPlanSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 4,
  },
  nonRxPlanItem: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    marginBottom: 3,
  },
  nonRxPlanDisclaimer: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 16,
    color: '#B45F00',
    fontWeight: '700',
  },
  content: { flex: 1 },
  contentContainer: { paddingBottom: 16 },
  reportHeaderCard: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  reportFileName: { fontSize: 14, fontWeight: '700' },
  reportHeaderMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  typeBadgeText: { fontSize: 10, fontWeight: '700' },
  dateText: { fontSize: 12 },
  reportSummaryMarkdownWrap: { marginTop: 10 },
  summaryToggle: { marginTop: 8, alignSelf: 'flex-start' },
  summaryToggleText: { fontSize: 12, fontWeight: '700' },
  reportActionsRow: { flexDirection: 'row', marginTop: 10 },
  reportActionBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  reportActionText: { fontSize: 12, fontWeight: '600' },
  deleteActionBtn: {
    minWidth: 96,
    marginLeft: 8,
  },
  deleteActionText: { fontSize: 12, fontWeight: '700', color: '#E04646', marginLeft: 5 },
  chatSection: { flex: 1, minHeight: 170 },
  chatTitle: { marginTop: 14, marginHorizontal: 16, fontSize: 14, fontWeight: '700' },
  chatScrollContent: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24, flexGrow: 1 },
  chatRow: { marginBottom: 10, flexDirection: 'row' },
  userRow: { justifyContent: 'flex-end' },
  aiRow: { justifyContent: 'flex-start' },
  chatBubble: {
    maxWidth: '90%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  userBubble: { borderTopRightRadius: 6 },
  aiBubble: { borderTopLeftRadius: 6, borderWidth: 1 },
  chatText: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  typingText: { marginTop: 6, fontSize: 12, fontWeight: '600' },
  chatInputRow: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 22,
    minHeight: 42,
    maxHeight: 92,
    paddingHorizontal: 14,
    fontSize: 13,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* ───── Premium Prescription Styles ───── */
  rxSection: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
  },
  rxSheetCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  rxSheetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  rxSheetBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  rxSheetBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  rxSheetDate: {
    fontSize: 11,
    fontWeight: '600',
  },
  rxSheetTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  rxMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  rxMetaItem: {
    width: '48%',
  },
  rxMetaLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  rxMetaValue: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  rxClassicCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  rxClassicTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  rxClassicRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  rxClassicCol: {
    flex: 1,
  },
  rxClassicTripleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  rxClassicTripleCol: {
    flex: 1,
  },
  rxClassicSingleRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  rxClassicLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
  },
  rxClassicValue: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  rxClassicTableWrap: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 8,
  },
  rxClassicTableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  rxClassicTableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  rxClassicTableHeaderCell: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 14,
  },
  rxClassicTableCell: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
    paddingRight: 6,
  },
  rxClassicNumCol: {
    width: 26,
  },
  rxClassicDrugCol: {
    flex: 1.4,
  },
  rxClassicUnitCol: {
    flex: 1.1,
  },
  rxClassicDoseCol: {
    flex: 1.3,
  },
  rxHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  rxHeaderTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  rxHeaderDoctor: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  rxHeaderCount: {
    marginLeft: 8,
    marginTop: 2,
    fontSize: 12,
    fontWeight: '800',
  },
  rxMedCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  rxMedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  rxMedIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rxMedIndexText: {
    fontSize: 11,
    fontWeight: '800',
  },
  rxMedName: {
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
    letterSpacing: -0.2,
  },
  rxMedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
    marginBottom: 8,
  },
  rxMedGridItem: {
    width: '48%',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  rxGridLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
  },
  rxGridValue: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  rxMedInstruction: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginTop: 6,
  },
  rxMedPurpose: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
    marginTop: 4,
  },
  rxEmptyMeds: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  rxEmptyText: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  rxPrecautionCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 4,
    marginBottom: 10,
  },
  rxPrecautionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#E65100',
    marginBottom: 8,
  },
  rxPrecautionItem: {
    fontSize: 12,
    lineHeight: 18,
    color: '#BF360C',
    fontWeight: '500',
    marginBottom: 4,
  },
  rxNotesCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 4,
    marginBottom: 10,
  },
  rxNotesTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 6,
  },
  rxNotesText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  rxDisclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
    gap: 10,
  },
  rxDisclaimerText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#F57F17',
    fontWeight: '600',
    flex: 1,
  },
});
