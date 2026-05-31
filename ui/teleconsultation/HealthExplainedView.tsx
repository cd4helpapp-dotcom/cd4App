import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Theme } from '../../constants/Colors';
import { Activity, AlertCircle, Ban, Calendar, Pill, Stethoscope } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MedicalReport } from '../../hooks/useMedicalReports';

interface HealthExplainedViewProps {
  theme: Theme;
  reports?: MedicalReport[];
  onOpenReport?: (reportId: string) => void;
}

type NormalizedReportInsights = {
  reportId: string;
  reportType: string;
  summary: string;
  explanation: string;
  keyPoints: string[];
  cautionFlags: string[];
  followUps: string[];
  medications: string[];
  avoidList: string[];
  next24hActions: string[];
  recoveryTimeline: string;
  updatedAtMs: number;
};

const clip = (value: string, max: number): string => {
  const text = (value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
};

const toTextArray = (value: unknown, maxItems: number = 12): string[] => {
  if (!Array.isArray(value)) return [];
  const rows = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, maxItems);
  return Array.from(new Set(rows));
};

const stripCodeFences = (value: string): string =>
  (value || '')
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim();

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

  const direct = tryParse(trimmed);
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return direct as Record<string, any>;
  }

  if (typeof direct === 'string') {
    const nested = tryParse(direct);
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, any>;
    }
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const sliced = trimmed.slice(first, last + 1);
    const parsedSlice = tryParse(sliced);
    if (parsedSlice && typeof parsedSlice === 'object' && !Array.isArray(parsedSlice)) {
      return parsedSlice as Record<string, any>;
    }
  }

  return null;
};

const normalizeMixedTextList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const cleaned = clip(item, 140);
      if (cleaned) normalized.push(cleaned);
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, any>;
      const line = [obj.name, obj.medicine, obj.drug, obj.dose, obj.frequency, obj.duration]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join(' | ');
      const cleaned = clip(line, 160);
      if (cleaned) normalized.push(cleaned);
    }
  }
  return Array.from(new Set(normalized)).slice(0, 12);
};

const isPrescriptionReport = (report: MedicalReport): boolean => {
  const type = (report.reportType || '').toLowerCase();
  const name = (report.fileName || '').toLowerCase();
  return (
    type.includes('prescription') ||
    name.includes('prescription') ||
    name.includes('rx') ||
    name.includes('medicine') ||
    name.includes('medication')
  );
};

const isLabReport = (report: MedicalReport): boolean => {
  const type = (report.reportType || '').toLowerCase();
  const name = (report.fileName || '').toLowerCase();
  return (
    type.includes('lab') ||
    type.includes('pathology') ||
    name.includes('lab') ||
    name.includes('path') ||
    name.includes('blood') ||
    name.includes('cbc') ||
    name.includes('lft') ||
    name.includes('kft') ||
    name.includes('thyroid') ||
    name.includes('lipid')
  );
};

const getReportUpdatedMs = (report: MedicalReport): number => {
  const value = report.analyzedAt || report.updatedAt || report.createdAt;
  const parsed = new Date(value || '').getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const extractMedicationLinesFromText = (text: string): string[] => {
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const medicinePattern = /\b(tab|tablet|capsule|cap|syrup|injection|mg|ml|od|bd|tds|hs|stat)\b/i;
  const result = lines
    .filter((line) => medicinePattern.test(line))
    .map((line) => clip(line, 140))
    .filter(Boolean);
  return Array.from(new Set(result)).slice(0, 12);
};

const extractTimelineFromText = (text: string): string[] => {
  const source = (text || '').replace(/\s+/g, ' ');
  if (!source) return [];
  const matches = source.match(/\b\d+\s*(day|days|week|weeks|month|months)\b/gi) || [];
  return Array.from(new Set(matches)).slice(0, 6);
};

const dedupe = (rows: string[], max: number = 12): string[] =>
  Array.from(new Set(rows.map((row) => row.trim()).filter(Boolean))).slice(0, max);

const formatDateTime = (valueMs: number): string => {
  if (!valueMs) return 'Not available';
  const date = new Date(valueMs);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const getRefreshHint = (lastUpdatedMs: number): string => {
  if (!lastUpdatedMs) return 'Upload and analyze a report to generate AI insights.';
  const dueMs = lastUpdatedMs + 24 * 60 * 60 * 1000;
  const diff = dueMs - Date.now();
  if (diff <= 0) return 'Insights refresh is due now. Re-analyze latest report for updated recommendations.';
  const hours = Math.ceil(diff / (60 * 60 * 1000));
  if (hours < 24) return `Next automatic freshness window in about ${hours} hour${hours > 1 ? 's' : ''}.`;
  return 'Insights refresh every 24 hours or when a new report is analyzed.';
};

const normalizeReportInsights = (report: MedicalReport): NormalizedReportInsights => {
  const parsedSummary = parseLooseJsonObject(report.aiSummary || '');
  const structured = typeof report.aiStructured === 'object' && report.aiStructured ? report.aiStructured : {};

  const summary = clip(
    String(
      structured.summary ||
        parsedSummary?.summary ||
        structured.patient_friendly_explanation ||
        parsedSummary?.patient_friendly_explanation ||
        report.aiSummary ||
        ''
    ),
    2000
  );
  const explanation = clip(
    String(
      structured.patient_friendly_explanation ||
        parsedSummary?.patient_friendly_explanation ||
        parsedSummary?.summary ||
        report.aiSummary ||
        ''
    ),
    3000
  );

  const keyPoints = dedupe([
    ...toTextArray(report.aiKeyPoints, 20),
    ...toTextArray(structured.key_points ?? structured.keyPoints, 20),
    ...toTextArray(parsedSummary?.key_points ?? parsedSummary?.keyPoints, 20),
  ]);
  const cautionFlags = dedupe([
    ...toTextArray(structured.caution_flags ?? structured.cautionFlags, 12),
    ...toTextArray(parsedSummary?.caution_flags ?? parsedSummary?.cautionFlags, 12),
  ]);
  const followUps = dedupe([
    ...toTextArray(structured.suggested_followups ?? structured.suggestedFollowups, 12),
    ...toTextArray(parsedSummary?.suggested_followups ?? parsedSummary?.suggestedFollowups, 12),
  ]);
  const medications = dedupe([
    ...normalizeMixedTextList(structured.medications ?? structured.prescriptions ?? structured.prescription_items),
    ...normalizeMixedTextList(parsedSummary?.medications ?? parsedSummary?.prescriptions ?? parsedSummary?.prescription_items),
    ...(isPrescriptionReport(report) ? extractMedicationLinesFromText(report.extractedText || '') : []),
  ]);
  const avoidList = dedupe([
    ...toTextArray(structured.what_to_avoid ?? structured.avoid ?? structured.avoid_list, 12),
    ...toTextArray(parsedSummary?.what_to_avoid ?? parsedSummary?.avoid ?? parsedSummary?.avoid_list, 12),
    ...cautionFlags.filter((line) => /\bavoid|stop|limit|restrict\b/i.test(line)),
  ]);
  const next24hActions = dedupe([
    ...toTextArray(structured.next_24h_actions ?? structured.action_plan_24h ?? structured.next_actions, 12),
    ...toTextArray(parsedSummary?.next_24h_actions ?? parsedSummary?.action_plan_24h ?? parsedSummary?.next_actions, 12),
    ...followUps.slice(0, 6),
  ]);
  const recoveryTimeline = clip(
    String(structured.recovery_timeline || parsedSummary?.recovery_timeline || ''),
    500
  );

  return {
    reportId: report.id,
    reportType: String(report.reportType || ''),
    summary,
    explanation,
    keyPoints,
    cautionFlags,
    followUps,
    medications,
    avoidList,
    next24hActions,
    recoveryTimeline,
    updatedAtMs: getReportUpdatedMs(report),
  };
};

const listPreview = (rows: string[], fallback: string, max: number = 5): string[] => {
  const picked = rows.map((item) => clip(item, 180)).filter(Boolean).slice(0, max);
  return picked.length > 0 ? picked : [fallback];
};

export default function HealthExplainedView({ theme, reports = [], onOpenReport }: HealthExplainedViewProps) {
  const completedReports = React.useMemo(
    () =>
      reports
        .filter((report) => report.analysisStatus === 'completed')
        .sort((a, b) => getReportUpdatedMs(b) - getReportUpdatedMs(a)),
    [reports]
  );

  const normalizedReports = React.useMemo(() => completedReports.map(normalizeReportInsights), [completedReports]);
  const latestReport = completedReports[0] || null;
  const latestInsight = normalizedReports[0] || null;

  const prescriptionReports = React.useMemo(
    () => completedReports.filter(isPrescriptionReport),
    [completedReports]
  );
  const labReports = React.useMemo(
    () => completedReports.filter(isLabReport),
    [completedReports]
  );

  const allMedications = React.useMemo(
    () =>
      dedupe(
        normalizedReports
          .filter((report) => report.reportType.toLowerCase().includes('prescription') || prescriptionReports.some((row) => row.id === report.reportId))
          .flatMap((report) => report.medications),
        12
      ),
    [normalizedReports, prescriptionReports]
  );

  const allActions24h = React.useMemo(
    () => dedupe(normalizedReports.flatMap((report) => report.next24hActions), 8),
    [normalizedReports]
  );
  const allAvoid = React.useMemo(
    () => dedupe(normalizedReports.flatMap((report) => report.avoidList), 8),
    [normalizedReports]
  );
  const recoveryHints = React.useMemo(() => {
    const timelineRows = normalizedReports
      .map((report) => report.recoveryTimeline)
      .filter(Boolean);
    const timelineSignals = normalizedReports.flatMap((report) =>
      extractTimelineFromText([report.summary, report.explanation, ...report.followUps].join(' '))
    );
    return dedupe([...timelineRows, ...timelineSignals], 6);
  }, [normalizedReports]);

  const conditionSummary = latestInsight
    ? clip(latestInsight.explanation || latestInsight.summary, 550)
    : '';
  const keyFindings = latestInsight ? listPreview(latestInsight.keyPoints, 'Detailed report findings will appear after analysis.') : [];
  const prescriptionLines = listPreview(
    allMedications,
    'No clear medicine list detected yet. Upload a prescription image/PDF for medicine extraction.'
  );
  const actions24h = listPreview(
    allActions24h,
    'Hydrate well, track symptoms, and follow your doctor-advised routine for the next 24 hours.'
  );
  const avoidLines = listPreview(
    allAvoid,
    'Avoid self-medication and avoid changing dose/frequency without clinician confirmation.'
  );
  const recoveryLines = listPreview(
    recoveryHints,
    'Recovery timeline depends on report severity; follow up with your clinician if symptoms persist.'
  );

  const lastUpdatedMs = latestInsight?.updatedAtMs || 0;
  const lastUpdatedLabel = formatDateTime(lastUpdatedMs);
  const refreshHint = getRefreshHint(lastUpdatedMs);

  if (completedReports.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={[styles.headerCard, { backgroundColor: theme.successLight }]}>
          <View style={[styles.botIcon, { backgroundColor: theme.success }]}>
            <Activity size={18} color="#fff" />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.headerTitle, { color: theme.success }]}>CD4 AI INSIGHTS</Text>
            <Text style={[styles.headerSub, { color: theme.text }]}>
              Upload and analyze medical reports to unlock dynamic AI insights.
            </Text>
          </View>
        </View>
        <View style={[styles.card, { backgroundColor: theme.cardBackground }]}>
          <View style={styles.cardContent}>
            <View style={styles.cardHeader}>
              <AlertCircle size={18} color={theme.success} />
              <Text style={[styles.cardTitle, { color: theme.text }]}>No analyzed report yet</Text>
            </View>
            <Text style={[styles.cardText, { color: theme.textSecondary }]}>
              Insights, prescription extraction, lab action plan, and timeline will appear after at least one report finishes AI scan.
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={[styles.headerCard, { backgroundColor: theme.successLight }]}>
        <View style={[styles.botIcon, { backgroundColor: theme.success }]}>
          <Activity size={18} color="#fff" />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.headerTitle, { color: theme.success }]}>CD4 AI INSIGHTS</Text>
          <Text style={[styles.headerSub, { color: theme.text }]}>
            Built from {completedReports.length} analyzed report{completedReports.length > 1 ? 's' : ''} • Last updated {lastUpdatedLabel}
          </Text>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBackground }]}>
        <View style={[styles.mediaPlaceholder, { backgroundColor: '#4DB6AC' }]}>
          <LinearGradient colors={['#1FA39A', '#6ECFC8']} style={StyleSheet.absoluteFill} />
        </View>
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Activity size={18} color={theme.success} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>What AI Found</Text>
          </View>
          <Text style={[styles.cardText, { color: theme.textSecondary }]}>
            {conditionSummary || 'Detailed medical interpretation is available in your report assistant chat.'}
          </Text>
          {keyFindings.map((line, index) => (
            <Text key={`${line}-${index}`} style={[styles.pointText, { color: theme.textSecondary }]}>
              • {line}
            </Text>
          ))}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBackground }]}>
        <View style={[styles.mediaPlaceholder, { backgroundColor: '#5C6BC0', height: 92 }]}>
          <LinearGradient colors={['#4458D3', '#6A80F7']} style={StyleSheet.absoluteFill} />
        </View>
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Pill size={18} color={theme.success} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>Prescription Snapshot</Text>
          </View>
          <Text style={[styles.cardText, { color: theme.textSecondary }]}>
            Extracted from uploaded prescriptions only. Always cross-check with your doctor/pharmacist before changing any medicine.
          </Text>
          {prescriptionLines.map((line, index) => (
            <Text key={`${line}-${index}`} style={[styles.pointText, { color: theme.textSecondary }]}>
              • {line}
            </Text>
          ))}
          {prescriptionReports[0] && onOpenReport ? (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.success }]}
              onPress={() => onOpenReport(prescriptionReports[0].id)}
              activeOpacity={0.86}
            >
              <Text style={styles.actionButtonText}>Open Latest Prescription</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBackground }]}>
        <View style={[styles.mediaPlaceholder, { backgroundColor: '#7CB342', height: 92 }]}>
          <LinearGradient colors={['#6FA532', '#93C85B']} style={StyleSheet.absoluteFill} />
        </View>
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Stethoscope size={18} color={theme.success} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>Next 24 Hours Plan</Text>
          </View>
          {actions24h.map((line, index) => (
            <Text key={`${line}-${index}`} style={[styles.pointText, { color: theme.textSecondary }]}>
              • {line}
            </Text>
          ))}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBackground }]}>
        <View style={[styles.mediaPlaceholder, { backgroundColor: '#424242', height: 88 }]} />
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Ban size={18} color={theme.success} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>What To Avoid</Text>
          </View>
          {avoidLines.map((line, index) => (
            <Text key={`${line}-${index}`} style={[styles.pointText, { color: theme.textSecondary }]}>
              • {line}
            </Text>
          ))}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.cardBackground }]}>
        <View style={[styles.mediaPlaceholder, { backgroundColor: '#FF8A65', height: 88 }]}>
          <LinearGradient colors={['#FFAB91', '#FFCCBC']} style={StyleSheet.absoluteFill} />
        </View>
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Calendar size={18} color={theme.success} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>Recovery Timeline</Text>
          </View>
          {recoveryLines.map((line, index) => (
            <Text key={`${line}-${index}`} style={[styles.pointText, { color: theme.textSecondary }]}>
              • {line}
            </Text>
          ))}
          <Text style={[styles.cardText, { color: theme.textSecondary, marginTop: 8 }]}>
            {refreshHint}
          </Text>
        </View>
      </View>

      <View style={[styles.footerNote, { backgroundColor: theme.cardBackground }]}>
        <AlertCircle size={14} color={theme.textSecondary} />
        <Text style={[styles.footerText, { color: theme.textSecondary }]}>
          AI insights are supportive only, not a final diagnosis. For severe symptoms, contact your doctor immediately.
        </Text>
      </View>

      {labReports[0] && onOpenReport ? (
        <TouchableOpacity
          style={[styles.openLabButton, { backgroundColor: theme.success }]}
          onPress={() => onOpenReport(labReports[0].id)}
          activeOpacity={0.86}
        >
          <Text style={styles.actionButtonText}>Open Latest Lab Report Q&A</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 110 },
  headerCard: { flexDirection: 'row', padding: 16, borderRadius: 16, alignItems: 'center', marginBottom: 20 },
  botIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 10, fontWeight: 'bold', letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' },
  headerSub: { fontSize: 12, lineHeight: 16 },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  mediaPlaceholder: { height: 110, width: '100%' },
  cardContent: { padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', marginLeft: 8 },
  cardText: { fontSize: 13, lineHeight: 19, marginBottom: 6 },
  pointText: { fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  actionButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  actionButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  footerNote: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  footerText: { fontSize: 11.5, lineHeight: 16, marginLeft: 8, flex: 1 },
  openLabButton: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
});
