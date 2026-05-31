import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Theme } from '../../constants/Colors';
import {
  Search,
  FileText,
  Upload,
  ChevronRight,
  Stethoscope,
  Brain,
  Pill,
  Apple,
  Sparkles,
  AlertTriangle,
} from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import HealthExplainedView from './HealthExplainedView';
import { RecordsTabSkeleton } from '../common/TabLoadingSkeletons';
import { useDeferredFocusSync } from '../../hooks/useDeferredFocusSync';
import {
  getMedicalReportAnalysisErrorMessage,
  MedicalReport,
  useMedicalReports,
  useUploadMedicalReport,
} from '../../hooks/useMedicalReports';

interface HealthVaultViewProps {
  theme: Theme;
}

type ReportTab = 'all' | 'prescription' | 'insights';

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

  const summary =
    extractQuotedField(trimmed, 'patient_friendly_explanation') ||
    extractQuotedField(trimmed, 'summary');

  if (summary) {
    return {
      summary,
      patient_friendly_explanation: summary,
    };
  }

  return null;
};

const pickIcon = (report: MedicalReport, theme: Theme) => {
  const reportType = (report.reportType || '').toLowerCase();
  const mime = (report.mimeType || '').toLowerCase();

  if (reportType.includes('lab')) return <Stethoscope size={20} color={theme.success} />;
  if (reportType.includes('prescription')) return <Pill size={20} color={theme.success} />;
  if (mime.startsWith('image/')) return <Apple size={20} color={theme.success} />;
  if (mime.includes('pdf')) return <FileText size={20} color={theme.success} />;
  return <Brain size={20} color={theme.success} />;
};

const includesPrescriptionType = (report: MedicalReport): boolean => {
  const type = (report.reportType || '').toLowerCase();
  const name = (report.fileName || '').toLowerCase();
  const source = (report.source || '').toLowerCase();
  const structured = typeof report.aiStructured === 'object' && report.aiStructured ? report.aiStructured : {};
  const prescriptionDetails =
    (structured as any).prescription_details ||
    (structured as any).prescriptionDetails ||
    null;
  const hasStructuredPrescriptionDetails =
    !!prescriptionDetails ||
    Array.isArray((structured as any).medications) ||
    Array.isArray((prescriptionDetails as any)?.medications);

  return (
    source.includes('prescription') ||
    type.includes('prescription') ||
    name.includes('prescription') ||
    name.includes('rx') ||
    name.includes('medicine') ||
    name.includes('medication') ||
    hasStructuredPrescriptionDetails
  );
};

const isPrescriptionSource = (report: MedicalReport): boolean =>
  String(report.source || '').toLowerCase() === 'prescription_upload';

const isLikelyPrescriptionFileName = (value: string): boolean => {
  const name = (value || '').toLowerCase();
  return /(prescription|rx|medicine|medication|dawai|drug)/i.test(name);
};

const isLikelyLabFileName = (value: string): boolean => {
  const name = (value || '').toLowerCase();
  return /(lab|path|cbc|lft|rft|lipid|thyroid|hba1c|glucose|report|test|scan)/i.test(name);
};

interface PrescriptionQuickPreview {
  reportId: string | null;
  doctorName: string;
  diagnosis: string;
  followupDate: string;
  medicinesCount: number;
  instructions: string[];
  redFlags: string[];
}

const toQuickTextList = (value: unknown, maxItems: number = 3): string[] => {
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

const buildPrescriptionQuickPreview = (report: MedicalReport | null): PrescriptionQuickPreview => {
  if (!report) {
    return {
      reportId: null,
      doctorName: '',
      diagnosis: '',
      followupDate: '',
      medicinesCount: 0,
      instructions: [],
      redFlags: [],
    };
  }

  const structured = typeof report.aiStructured === 'object' && report.aiStructured ? report.aiStructured : {};
  const rxStructured = (structured as any).prescription_details || (structured as any).prescriptionDetails || {};
  const medications = Array.isArray((rxStructured as any).medications)
    ? (rxStructured as any).medications
    : Array.isArray((structured as any).medications)
    ? (structured as any).medications
    : [];

  return {
    reportId: report.id,
    doctorName: (
      (rxStructured as any).doctor_name ||
      (rxStructured as any).doctorName ||
      ''
    )
      .toString()
      .trim(),
    diagnosis: (
      (rxStructured as any).diagnosis ||
      ''
    )
      .toString()
      .trim(),
    followupDate: (
      (rxStructured as any).followup_date ||
      (rxStructured as any).followupDate ||
      ''
    )
      .toString()
      .trim(),
    medicinesCount: medications.length,
    instructions: toQuickTextList(
      (rxStructured as any).general_instructions || (rxStructured as any).instructions,
      3
    ),
    redFlags: toQuickTextList(
      (rxStructured as any).red_flags || (rxStructured as any).warning_signs,
      2
    ),
  };
};

const getReportSummaryText = (report: MedicalReport): string => {
  if (report.aiSummary) {
    const parsed = parseLooseJsonObject(report.aiSummary);
    if (parsed) {
      const summary =
        (typeof parsed.patient_friendly_explanation === 'string' && parsed.patient_friendly_explanation.trim()) ||
        (typeof parsed.summary === 'string' && parsed.summary.trim()) ||
        '';
      if (summary) {
        return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(summary) ? summary : `🩺 ${summary}`;
      }
    }
    return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(report.aiSummary)
      ? report.aiSummary
      : `🩺 ${report.aiSummary}`;
  }

  if (report.analysisStatus === 'failed') {
    return getMedicalReportAnalysisErrorMessage(report.analysisError);
  }

  if (report.analysisStatus === 'processing') {
    return 'AI is scanning this report. This may take a few moments.';
  }

  if (report.analysisStatus === 'pending') {
    return 'Uploaded successfully. AI scan is queued.';
  }

  return 'AI summary will appear here after scan.';
};

export default function HealthVaultView({ theme }: HealthVaultViewProps) {
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);
  const [isTabSwitchLoading, setIsTabSwitchLoading] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<ReportTab>('all');

  const reportsQuery = useMedicalReports();
  const refetchReports = reportsQuery.refetch;
  const uploadMutation = useUploadMedicalReport();
  const reports = reportsQuery.data || [];

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchReports();
    } finally {
      setRefreshing(false);
    }
  }, [refetchReports]);

  const syncReportsOnFocus = React.useCallback(async () => {
    await refetchReports();
  }, [refetchReports]);
  const shouldShowReportsInitialLoading = React.useCallback(
    () => reports.length === 0,
    [reports.length]
  );
  const showReportsInitialLoading = React.useCallback(() => setIsTabSwitchLoading(true), []);
  const hideReportsInitialLoading = React.useCallback(() => setIsTabSwitchLoading(false), []);

  useDeferredFocusSync({
    sync: syncReportsOnFocus,
    shouldShowInitialLoading: shouldShowReportsInitialLoading,
    onInitialLoadingStart: showReportsInitialLoading,
    onInitialLoadingEnd: hideReportsInitialLoading,
  });

  const handleUpload = async () => {
    if (uploadMutation.isPending) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'image/*',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/*',
          'application/*',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.length) return;
      const selectedAsset = result.assets[0];

      const appearsNonPrescriptionInPrescriptionTab =
        activeTab === 'prescription' &&
        isLikelyLabFileName(selectedAsset?.name || '') &&
        !isLikelyPrescriptionFileName(selectedAsset?.name || '');

      const uploaded = await uploadMutation.mutateAsync({
        asset: selectedAsset,
        category: activeTab === 'prescription' ? 'prescription' : 'report',
      });
      router.push({
        pathname: '/report-assistant',
        params: {
          reportId: uploaded.id,
          mode: activeTab === 'prescription' ? 'prescription' : 'report',
        },
      });

      Toast.show({
        type: 'success',
        text1: activeTab === 'prescription' ? 'Prescription uploaded' : 'Report uploaded',
        text2:
          activeTab === 'prescription'
            ? 'Prescription extraction started. Open details for medicine view.'
            : 'AI scan started. You can open the report for details.',
      });

      if (appearsNonPrescriptionInPrescriptionTab) {
        Toast.show({
          type: 'info',
          text1: 'Upload accepted',
          text2: 'This file may be a lab report. AI will classify it automatically.',
        });
      }
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Upload failed',
        text2: error?.message || 'Could not upload report. Please retry.',
      });
    }
  };

  const handleOpenReport = (reportId: string, mode?: 'prescription' | 'report') => {
    const report = reports.find((row) => row.id === reportId) || null;
    const resolvedMode =
      mode ||
      (report
        ? isPrescriptionSource(report)
          ? 'prescription'
          : 'report'
        : activeTab === 'prescription'
        ? 'prescription'
        : 'report');
    router.push({ pathname: '/report-assistant', params: { reportId, mode: resolvedMode } });
  };

  const filteredReports = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return reports.filter((report) => {
      const isTabMatch =
        activeTab === 'all'
          ? true
          : activeTab === 'prescription'
          ? isPrescriptionSource(report) || includesPrescriptionType(report)
          : true;

      if (!isTabMatch) return false;
      if (!query) return true;

      const summary = report.aiSummary?.toLowerCase() || '';
      const fileName = report.fileName?.toLowerCase() || '';
      const reportType = report.reportType?.toLowerCase() || '';
      return fileName.includes(query) || summary.includes(query) || reportType.includes(query);
    });
  }, [reports, activeTab, searchQuery]);

  const latestCompletedReport = React.useMemo(
    () => reports.find((report) => report.analysisStatus === 'completed') || null,
    [reports]
  );
  const latestCompletedPrescriptionReport = React.useMemo(
    () =>
      reports.find(
        (report) => report.analysisStatus === 'completed' && includesPrescriptionType(report)
      ) || null,
    [reports]
  );
  const latestSummaryReport = React.useMemo(() => {
    if (activeTab === 'prescription') return latestCompletedPrescriptionReport;
    return latestCompletedReport;
  }, [activeTab, latestCompletedPrescriptionReport, latestCompletedReport]);
  const latestPrescriptionPreview = React.useMemo(
    () => buildPrescriptionQuickPreview(latestCompletedPrescriptionReport),
    [latestCompletedPrescriptionReport]
  );

  const summaryFallbackText =
    activeTab === 'prescription'
      ? 'Upload a prescription report to get medicine-focused AI summary.'
      : 'Upload any medical report (PDF, image, DOC) and AI will explain the findings in simple language.';

  const reportTabs: Array<{ id: ReportTab; label: string }> = [
    { id: 'all', label: 'All Reports' },
    { id: 'prescription', label: 'Prescriptions' },
    { id: 'insights', label: 'AI Insights' },
  ];
  const showInitialLoadingSkeleton = (isTabSwitchLoading || (reportsQuery.isLoading && reports.length === 0)) && !refreshing;

  const renderTabsRow = () => (
    <View style={[styles.tabsRow, { borderBottomColor: theme.borderColor }]}>
      {reportTabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <TouchableOpacity key={tab.id} onPress={() => setActiveTab(tab.id)} activeOpacity={0.85}>
            <Text
              style={[
                styles.tab,
                {
                  color: isActive ? theme.text : theme.textSecondary,
                  borderBottomColor: isActive ? theme.success : 'transparent',
                },
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  if (activeTab === 'insights') {
    return (
        <View style={styles.insightsContainer}>
          <View style={styles.insightsTabsWrap}>{renderTabsRow()}</View>
          <HealthExplainedView theme={theme} reports={reports} onOpenReport={handleOpenReport} />
        </View>
      );
  }

  if (showInitialLoadingSkeleton) {
    return (
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.success]}
            tintColor={theme.success}
          />
        }
      >
        <RecordsTabSkeleton theme={theme} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[theme.success]}
          tintColor={theme.success}
        />
      }
    >
      <View style={[styles.searchBar, { backgroundColor: theme.cardBackground }]}>
        <Search size={20} color={theme.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search reports by name, type or summary"
          placeholderTextColor={theme.textSecondary}
        />
      </View>

      {renderTabsRow()}

      <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>YOUR REPORTS</Text>

      {activeTab === 'prescription' ? (
        <View style={[styles.prescriptionGuideCard, { backgroundColor: theme.successLight, borderColor: theme.success + '40' }]}>
          <Text style={[styles.prescriptionGuideTitle, { color: theme.text }]}>Prescription Guidance</Text>
          {latestPrescriptionPreview.reportId ? (
            <>
              <Text style={[styles.prescriptionGuideText, { color: theme.text }]}>
                {latestPrescriptionPreview.medicinesCount > 0
                  ? `Detected ${latestPrescriptionPreview.medicinesCount} medicine item${latestPrescriptionPreview.medicinesCount > 1 ? 's' : ''} from your latest prescription.`
                  : 'Latest prescription analyzed. Medicine names may be partially visible, please verify with doctor/pharmacist.'}
              </Text>
              {latestPrescriptionPreview.doctorName ? (
                <Text style={[styles.prescriptionGuideMeta, { color: theme.textSecondary }]}>
                  🩺 Doctor: {latestPrescriptionPreview.doctorName}
                </Text>
              ) : null}
              {latestPrescriptionPreview.diagnosis ? (
                <Text style={[styles.prescriptionGuideMeta, { color: theme.textSecondary }]}>
                  🧠 Condition: {latestPrescriptionPreview.diagnosis}
                </Text>
              ) : null}
              {latestPrescriptionPreview.followupDate ? (
                <Text style={[styles.prescriptionGuideMeta, { color: theme.textSecondary }]}>
                  🔁 Follow-up: {latestPrescriptionPreview.followupDate}
                </Text>
              ) : null}
              {latestPrescriptionPreview.instructions[0] ? (
                <Text style={[styles.prescriptionGuideMeta, { color: theme.textSecondary }]}>
                  📝 {latestPrescriptionPreview.instructions[0]}
                </Text>
              ) : null}
              {latestPrescriptionPreview.redFlags[0] ? (
                <Text style={[styles.prescriptionGuideMeta, { color: '#B71C1C' }]}>
                  🚨 {latestPrescriptionPreview.redFlags[0]}
                </Text>
              ) : null}
              <TouchableOpacity
                style={[styles.prescriptionGuideButton, { backgroundColor: theme.success }]}
                onPress={() => latestPrescriptionPreview.reportId && handleOpenReport(latestPrescriptionPreview.reportId)}
                activeOpacity={0.86}
              >
                <Text style={styles.prescriptionGuideButtonText}>Open Prescription Assistant</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={[styles.prescriptionGuideText, { color: theme.textSecondary }]}>
              Upload a clear prescription photo/PDF. We will extract medicines, dosage hints, and follow-up details in one place.
            </Text>
          )}
          <Text style={[styles.prescriptionSafetyNote, { color: '#B45F00' }]}>
            AI extraction may be imperfect. Never change medicines without doctor confirmation.
          </Text>
        </View>
      ) : null}

      {!reportsQuery.isLoading && filteredReports.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <AlertTriangle size={18} color={theme.textSecondary} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>No reports found</Text>
          <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
            Upload your medical report to get AI scan and explanation.
          </Text>
        </View>
      ) : null}

      {filteredReports.map((report) => {
        const status = getStatusColor(report.analysisStatus, theme);
        return (
          <View key={report.id} style={[styles.recordCard, { backgroundColor: theme.cardBackground }]}>
            <TouchableOpacity
              style={styles.recordMainTap}
              onPress={() => handleOpenReport(report.id)}
              activeOpacity={0.88}
            >
              <View style={[styles.iconBox, { backgroundColor: theme.successLight }]}>
                {pickIcon(report, theme)}
              </View>
              <View style={{ flex: 1, marginLeft: 16 }}>
                <Text style={[styles.docName, { color: theme.text }]} numberOfLines={1}>
                  {report.fileName}
                </Text>
                <View style={styles.metaRow}>
                  <View style={[styles.typeBadge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.typeBadgeText, { color: status.text }]}>
                      {getStatusLabel(report.analysisStatus)}
                    </Text>
                  </View>
                  <Text style={[styles.dateText, { color: theme.textSecondary }]}>
                    • {formatDate(report.createdAt)}
                  </Text>
                </View>
                <Text style={[styles.summaryPreview, { color: theme.textSecondary }]} numberOfLines={2}>
                  {getReportSummaryText(report)}
                </Text>
              </View>
            </TouchableOpacity>

            <View style={styles.recordActionsCol}>
              <TouchableOpacity
                style={[styles.viewIcon, { backgroundColor: theme.successLight }]}
                onPress={() => handleOpenReport(report.id)}
                activeOpacity={0.85}
              >
                <ChevronRight size={16} color={theme.success} />
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <View style={[styles.aiCard, { backgroundColor: theme.successLight }]}>
        <View style={styles.aiHeaderRow}>
          <Sparkles size={16} color={theme.success} />
          <Text style={[styles.aiTitle, { color: theme.text }]}>
            {activeTab === 'prescription'
              ? 'Prescription AI Summary'
              : 'Smart AI Summary'}
          </Text>
        </View>
        <Text style={[styles.aiText, { color: theme.text }]}>
          {(latestSummaryReport ? getReportSummaryText(latestSummaryReport) : '') || summaryFallbackText}
        </Text>
        {latestSummaryReport ? (
          <TouchableOpacity
            style={[styles.aiButton, { backgroundColor: theme.success }]}
            onPress={() => handleOpenReport(latestSummaryReport.id)}
            activeOpacity={0.86}
          >
            <Text style={styles.aiButtonText}>Open Report Q&A</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.uploadButton, { backgroundColor: '#1E1E1E', opacity: uploadMutation.isPending ? 0.75 : 1 }]}
        onPress={handleUpload}
        activeOpacity={0.86}
        disabled={uploadMutation.isPending}
      >
        {uploadMutation.isPending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Upload size={20} color="#fff" />
        )}
        <Text style={styles.uploadButtonText}>
          {uploadMutation.isPending
            ? activeTab === 'prescription'
              ? 'Uploading prescription...'
              : 'Uploading & scanning...'
            : activeTab === 'prescription'
            ? 'Upload Prescription'
            : 'Upload New Report'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  insightsContainer: { flex: 1 },
  insightsTabsWrap: { paddingHorizontal: 20, paddingTop: 20 },
  container: { padding: 20, paddingBottom: 100 },
  searchBar: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, marginBottom: 20 },
  searchInput: { marginLeft: 10, flex: 1, fontSize: 13 },
  tabsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, borderBottomWidth: 1 },
  tab: { fontSize: 13, fontWeight: '600', paddingBottom: 10, borderBottomWidth: 2 },
  sectionHeader: { fontSize: 12, fontWeight: 'bold', marginBottom: 14, letterSpacing: 1 },
  prescriptionGuideCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14 },
  prescriptionGuideTitle: { fontSize: 14, fontWeight: '800', marginBottom: 6 },
  prescriptionGuideText: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  prescriptionGuideMeta: { marginTop: 6, fontSize: 12, lineHeight: 17 },
  prescriptionGuideButton: { marginTop: 10, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  prescriptionGuideButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  prescriptionSafetyNote: { marginTop: 10, fontSize: 11, fontWeight: '700', lineHeight: 16 },
  emptyCard: { borderRadius: 14, borderWidth: 1, paddingVertical: 18, paddingHorizontal: 16, alignItems: 'center', marginBottom: 12 },
  emptyTitle: { marginTop: 8, fontSize: 14, fontWeight: '700' },
  emptySubtitle: { marginTop: 6, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  recordCard: { flexDirection: 'row', padding: 16, borderRadius: 16, alignItems: 'center', marginBottom: 12 },
  recordMainTap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  recordActionsCol: { marginLeft: 10, alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  iconBox: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  docName: { fontSize: 14, fontWeight: 'bold' },
  viewIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  typeBadgeText: { fontSize: 10, fontWeight: '700' },
  dateText: { fontSize: 12 },
  summaryPreview: { marginTop: 6, fontSize: 12, lineHeight: 16 },
  aiCard: { padding: 20, borderRadius: 20, marginBottom: 12, marginVertical: 4 },
  aiHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  aiTitle: { fontSize: 16, fontWeight: 'bold' },
  aiText: { fontSize: 13, lineHeight: 20, marginBottom: 16, opacity: 0.85 },
  aiButton: { alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  aiButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  uploadButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 12, marginTop: 10 },
  uploadButtonText: { color: '#fff', fontWeight: 'bold', marginLeft: 8 },
});
