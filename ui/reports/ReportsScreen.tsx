import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { FileText, FlaskConical, Pill, Plus, ShieldCheck, Sparkles, Upload } from 'lucide-react-native';
import {
  isMedicalReportActive,
  useMedicalReports,
  useReanalyzeMedicalReport,
  useReportUploadQuota,
  useSoftDeleteMedicalReport,
  useUploadMedicalReport,
  type MedicalReport,
  type ReportUploadCategory,
} from '../../hooks/useMedicalReports';
import { useAppTheme } from '../../hooks/useAppTheme';
import { elevation, Layout, Radius, Spacing, Typography } from '../../constants/Design';
import { RecordsTabSkeleton } from '../common/TabLoadingSkeletons';
import { confirmAction } from '../../src/utils/confirm';
import { getReportKind } from '../../src/utils/reportInsights';
import ReportCard from './ReportCard';
import InsightsTab from './InsightsTab';
import UploadSheet, { type PickedReportFile } from './UploadSheet';

export type ReportsTabKey = 'all' | 'lab' | 'prescription' | 'insights';

const TABS: { key: ReportsTabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'lab', label: 'Lab reports' },
  { key: 'prescription', label: 'Prescriptions' },
  { key: 'insights', label: 'Insights' },
];

export default function ReportsScreen({ initialTab = 'all' }: { initialTab?: ReportsTabKey }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = React.useState<ReportsTabKey>(initialTab);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  const reportsQuery = useMedicalReports();
  const quota = useReportUploadQuota();
  const uploadMutation = useUploadMedicalReport();
  const reanalyzeMutation = useReanalyzeMedicalReport();
  const deleteMutation = useSoftDeleteMedicalReport();
  const reports = reportsQuery.data || [];

  React.useEffect(() => setTab(initialTab), [initialTab]);

  // Tick so "scanning" cards flip to "stuck" without needing a refetch.
  const hasActive = reports.some(isMedicalReportActive);
  React.useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(id);
  }, [hasActive]);

  const visible = React.useMemo(() => {
    if (tab === 'insights') return [];
    if (tab === 'all') return reports;
    // "Lab reports" means lab results only; other documents (scans, letters, screenshots) stay under All.
    return reports.filter((report) => getReportKind(report) === (tab === 'prescription' ? 'prescription' : 'lab'));
  }, [reports, tab]);

  const openReport = (report: MedicalReport) =>
    router.push({
      pathname: '/report-assistant',
      params: { reportId: report.id, mode: getReportKind(report) === 'prescription' ? 'prescription' : 'report' },
    });

  const handlePicked = async (file: PickedReportFile, category: ReportUploadCategory) => {
    try {
      const uploaded = await uploadMutation.mutateAsync({
        asset: { uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size } as any,
        category,
      });
      setSheetOpen(false);
      setTab(category === 'prescription' ? 'prescription' : 'all');
      setNowMs(Date.now());
      // Open the report straight away so the patient watches AI read it, then reads the result in the same place.
      openReport(uploaded);
      return uploaded;
    } catch (error: any) {
      Toast.show({ type: 'error', text1: 'Upload failed', text2: error?.message || 'Please check your connection and try again.' });
    }
  };

  const handleRetry = async (report: MedicalReport) => {
    setBusyId(report.id);
    try {
      await reanalyzeMutation.mutateAsync({ reportId: report.id });
      setNowMs(Date.now());
    } catch (error: any) {
      Toast.show({ type: 'error', text1: 'Could not retry', text2: error?.message || 'Please try again in a moment.' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (report: MedicalReport) => {
    const ok = await confirmAction({
      title: 'Delete this report?',
      message: 'It will be removed from your reports. This cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync({ reportId: report.id });
      Toast.show({ type: 'success', text1: 'Report deleted' });
    } catch (error: any) {
      Toast.show({ type: 'error', text1: 'Could not delete', text2: error?.message || 'Please try again.' });
    }
  };

  const openSheet = () => setSheetOpen(true);
  const sheetCategory: ReportUploadCategory = tab === 'prescription' ? 'prescription' : 'report';

  const renderEmpty = () => (
    <View style={[styles.empty, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
        {tab === 'prescription' ? <Pill size={30} color={theme.primary} /> : tab === 'lab' ? <FlaskConical size={30} color={theme.primary} /> : <FileText size={30} color={theme.primary} />}
      </View>
      <Text style={[Typography.heading, { color: theme.text, textAlign: 'center' }]}>
        {tab === 'prescription' ? 'No prescriptions yet' : tab === 'lab' ? 'No lab reports yet' : 'Understand your reports in simple words'}
      </Text>
      <Text style={[Typography.body, { color: theme.textSecondary, textAlign: 'center' }]}>
        Take a photo or upload a PDF. AI reads it and explains it in plain language. You can then ask it questions.
      </Text>
      <View style={styles.steps}>
        {[
          { icon: Upload, title: '1. Add', text: 'Photo or PDF of your report' },
          { icon: Sparkles, title: '2. AI reads it', text: 'Takes under a minute' },
          { icon: ShieldCheck, title: '3. Understand', text: 'Simple summary and Q&A' },
        ].map(({ icon: Icon, title, text }) => (
          <View key={title} style={styles.step}>
            <View style={[styles.stepIcon, { backgroundColor: theme.primarySoft }]}>
              <Icon size={18} color={theme.primary} />
            </View>
            <View style={styles.flex}>
              <Text style={[Typography.bodyStrong, { color: theme.text }]}>{title}</Text>
              <Text style={[Typography.caption, { color: theme.textSecondary }]}>{text}</Text>
            </View>
          </View>
        ))}
      </View>
      <Pressable onPress={openSheet} accessibilityRole="button" style={({ pressed }) => [styles.cta, { backgroundColor: pressed ? theme.primaryPressed : theme.buttonPrimary }]}>
        <Plus size={18} color="#FFFFFF" />
        <Text style={styles.ctaText}>{tab === 'prescription' ? 'Add prescription' : 'Add report'}</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={reportsQuery.isRefetching && !hasActive} onRefresh={() => { void reportsQuery.refetch(); }} tintColor={theme.primary} />}
      >
        <View style={styles.inner}>
          <View style={styles.headerRow}>
            <View style={styles.flex}>
              <Text style={[Typography.display, { color: theme.text }]}>Reports</Text>
              <Text style={[Typography.body, { color: theme.textSecondary }]}>
                {reports.length ? `${reports.length} saved · AI explains them simply` : 'Your medical records, explained simply'}
              </Text>
            </View>
            <Pressable
              onPress={openSheet}
              accessibilityRole="button"
              accessibilityLabel="Add report"
              style={({ pressed }) => [styles.addBtn, { backgroundColor: pressed ? theme.primaryPressed : theme.buttonPrimary }]}
            >
              <Plus size={18} color="#FFFFFF" />
              <Text style={styles.fabText}>Add</Text>
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {TABS.map(({ key, label }) => {
              const active = tab === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={[styles.tab, { backgroundColor: active ? theme.buttonPrimary : theme.surfaceMuted }]}
                >
                  <Text style={[styles.tabText, { color: active ? '#FFFFFF' : theme.textSecondary }]}>{label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {reportsQuery.isLoading ? (
            <RecordsTabSkeleton theme={theme} cardsOnly />
          ) : reportsQuery.isError ? (
            <View style={[styles.empty, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
              <Text style={[Typography.heading, { color: theme.text }]}>Could not load your reports</Text>
              <Text style={[Typography.body, { color: theme.textSecondary, textAlign: 'center' }]}>Check your internet and try again.</Text>
              <Pressable onPress={() => reportsQuery.refetch()} accessibilityRole="button" style={[styles.cta, { backgroundColor: theme.buttonPrimary }]}>
                <Text style={styles.ctaText}>Retry</Text>
              </Pressable>
            </View>
          ) : tab === 'insights' ? (
            <InsightsTab reports={reports} nowMs={nowMs} onOpen={openReport} onAddReport={openSheet} />
          ) : visible.length === 0 ? (
            renderEmpty()
          ) : (
            <View style={styles.list}>
              {visible.map((report) => (
                <ReportCard
                  key={report.id}
                  report={report}
                  nowMs={nowMs}
                  isBusy={busyId === report.id}
                  onOpen={openReport}
                  onRetry={handleRetry}
                  onDelete={handleDelete}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <UploadSheet
        visible={sheetOpen}
        initialCategory={sheetCategory}
        isUploading={uploadMutation.isPending}
        quota={quota.data}
        onClose={() => setSheetOpen(false)}
        onPicked={handlePicked}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  content: { alignItems: 'center' },
  inner: { width: '100%', maxWidth: Layout.contentMaxWidth, paddingHorizontal: Layout.screenGutter, paddingTop: Spacing.lg, gap: Spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  tabs: { gap: Spacing.sm, paddingVertical: 2 },
  tab: { height: 38, paddingHorizontal: 13, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 13, fontWeight: '700' },
  list: { gap: Spacing.md },
  empty: { borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.xxl, alignItems: 'center', gap: Spacing.md },
  emptyIcon: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  steps: { alignSelf: 'stretch', gap: Spacing.md, marginTop: Spacing.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cta: { height: 48, borderRadius: Radius.md, paddingHorizontal: Spacing.xxl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: Spacing.sm, alignSelf: 'stretch' },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  addBtn: { height: 44, borderRadius: Radius.pill, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 6 },
  fabText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
