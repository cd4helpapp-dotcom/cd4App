import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { LinearGradient } from 'expo-linear-gradient';
import { AlertTriangle, ArrowRight, Camera, FileText, FlaskConical, FolderOpen, Lightbulb, Pill, Plus, ShieldCheck, Sparkles, Upload } from 'lucide-react-native';
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
import { useAppLanguage } from '../../context/AppLanguageContext';
import { elevation, Layout, Radius, Spacing, Typography } from '../../constants/Design';
import { RecordsTabSkeleton } from '../common/TabLoadingSkeletons';
import { confirmAction } from '../../src/utils/confirm';
import { getAttentionCount, getReportKind, getReportState } from '../../src/utils/reportInsights';
import ReportCard from './ReportCard';
import InsightsTab from './InsightsTab';
import { FadeInUp } from './ReportVisuals';
import UploadSheet, { type PickedReportFile } from './UploadSheet';

export type ReportsTabKey = 'all' | 'lab' | 'prescription' | 'insights';

export default function ReportsScreen({ initialTab = 'all' }: { initialTab?: ReportsTabKey }) {
  const { theme, isDark } = useAppTheme();
  const { t } = useAppLanguage();
  const TABS: { key: ReportsTabKey; label: string; Icon: React.ComponentType<{ size?: number; color?: string }> }[] = [
    { key: 'all', label: t('reports.tabAll'), Icon: FolderOpen },
    { key: 'lab', label: t('reports.tabLab'), Icon: FlaskConical },
    { key: 'prescription', label: t('reports.tabPrescriptions'), Icon: Pill },
    { key: 'insights', label: t('reports.tabInsights'), Icon: Lightbulb },
  ];
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
    // A doctor's note sits with prescriptions, because both are what the doctor wrote.
    return reports.filter((report) => {
      const kind = getReportKind(report);
      return tab === 'lab' ? kind === 'lab' : kind === 'prescription' || kind === 'note';
    });
  }, [reports, tab]);

  const toReview = React.useMemo(
    () => reports.filter((report) => getReportState(report, nowMs) === 'ready' && getReportKind(report) === 'lab' && getAttentionCount(report) > 0).length,
    [reports, nowMs]
  );
  const heroGradient = (isDark ? ['#065F46', '#073B2C', '#062A22'] : ['#047857', '#059669', '#10B981']) as [string, string, string];

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
      Toast.show({ type: 'error', text1: t('reports.uploadFailed'), text2: error?.message || t('reports.checkConnection') });
    }
  };

  const handleRetry = async (report: MedicalReport) => {
    setBusyId(report.id);
    try {
      await reanalyzeMutation.mutateAsync({ reportId: report.id });
      setNowMs(Date.now());
    } catch (error: any) {
      Toast.show({ type: 'error', text1: t('reports.couldNotRetry'), text2: error?.message || t('reports.tryInMoment') });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (report: MedicalReport) => {
    const ok = await confirmAction({
      title: t('reports.deleteTitle'),
      message: t('reports.deleteMessage'),
      confirmText: t('reports.delete'),
      cancelText: t('reports.cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync({ reportId: report.id });
      Toast.show({ type: 'success', text1: t('reports.deleted') });
    } catch (error: any) {
      Toast.show({ type: 'error', text1: t('reports.couldNotDelete'), text2: error?.message || t('reports.tryAgainPlease') });
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
        {tab === 'prescription' ? t('reports.emptyPrescription') : tab === 'lab' ? t('reports.emptyLab') : t('reports.emptyAll')}
      </Text>
      <Text style={[Typography.body, { color: theme.textSecondary, textAlign: 'center' }]}>
        {t('reports.emptyBody')}
      </Text>
      <View style={styles.steps}>
        {[
          { icon: Upload, title: t('reports.step1Title'), text: t('reports.step1Text') },
          { icon: Sparkles, title: t('reports.step2Title'), text: t('reports.step2Text') },
          { icon: ShieldCheck, title: t('reports.step3Title'), text: t('reports.step3Text') },
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
        <Text style={styles.ctaText}>{tab === 'prescription' ? t('reports.addPrescription') : t('reports.addReport')}</Text>
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
          <FadeInUp>
            <LinearGradient colors={heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
              <Text style={styles.heroTitle}>{t('reports.title')}</Text>
              <Text style={styles.heroSubtitle}>{reports.length ? t('reports.subtitleCount', { count: reports.length }) : t('reports.subtitleEmpty')}</Text>

              {reports.length > 0 ? (
                <View style={styles.heroStats}>
                  <View style={styles.heroStat}>
                    <FileText size={16} color="#FFFFFF" />
                    <Text style={styles.heroStatValue}>{reports.length}</Text>
                    <Text style={styles.heroStatLabel}>{t('reports.heroSaved')}</Text>
                  </View>
                  <View style={styles.heroStat}>
                    {toReview > 0 ? <AlertTriangle size={16} color="#FFFFFF" /> : <ShieldCheck size={16} color="#FFFFFF" />}
                    <Text style={styles.heroStatValue}>{toReview}</Text>
                    <Text style={styles.heroStatLabel}>{toReview > 0 ? t('reports.heroReview') : t('reports.heroClear')}</Text>
                  </View>
                </View>
              ) : null}

              <Pressable
                onPress={openSheet}
                accessibilityRole="button"
                accessibilityLabel={t('reports.heroScan')}
                style={({ pressed }) => [styles.heroCta, { opacity: pressed ? 0.9 : 1 }]}
              >
                <View style={styles.heroCtaIcon}>
                  <Camera size={20} color="#047857" />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.heroCtaTitle}>{t('reports.heroScan')}</Text>
                  <Text style={styles.heroCtaHint} numberOfLines={1}>{t('reports.heroHint')}</Text>
                </View>
                <ArrowRight size={20} color="#047857" />
              </Pressable>
            </LinearGradient>
          </FadeInUp>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {TABS.map(({ key, label, Icon }) => {
              const active = tab === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={[styles.tab, { backgroundColor: active ? theme.buttonPrimary : theme.cardBackground, borderColor: active ? theme.buttonPrimary : theme.borderColor }]}
                >
                  <Icon size={15} color={active ? '#FFFFFF' : theme.textSecondary} />
                  <Text style={[styles.tabText, { color: active ? '#FFFFFF' : theme.textSecondary }]}>{label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {reportsQuery.isLoading ? (
            <RecordsTabSkeleton theme={theme} cardsOnly />
          ) : reportsQuery.isError ? (
            <View style={[styles.empty, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
              <Text style={[Typography.heading, { color: theme.text }]}>{t('reports.loadFailed')}</Text>
              <Text style={[Typography.body, { color: theme.textSecondary, textAlign: 'center' }]}>{t('reports.checkInternet')}</Text>
              <Pressable onPress={() => reportsQuery.refetch()} accessibilityRole="button" style={[styles.cta, { backgroundColor: theme.buttonPrimary }]}>
                <Text style={styles.ctaText}>{t('reports.retry')}</Text>
              </Pressable>
            </View>
          ) : tab === 'insights' ? (
            <InsightsTab reports={reports} nowMs={nowMs} onOpen={openReport} onAddReport={openSheet} />
          ) : visible.length === 0 ? (
            renderEmpty()
          ) : (
            <View style={styles.list}>
              {visible.map((report, index) => (
                <FadeInUp key={report.id} index={index}>
                  <ReportCard
                    report={report}
                    nowMs={nowMs}
                    isBusy={busyId === report.id}
                    onOpen={openReport}
                    onRetry={handleRetry}
                    onDelete={handleDelete}
                  />
                </FadeInUp>
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
  hero: { borderRadius: Radius.xl + 4, padding: Spacing.xl, gap: Spacing.md, overflow: 'hidden' },
  heroTitle: { color: '#FFFFFF', fontSize: 28, lineHeight: 34, fontWeight: '800' },
  heroSubtitle: { color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 20, marginTop: -8 },
  heroStats: { flexDirection: 'row', gap: Spacing.sm },
  heroStat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 9 },
  heroStatValue: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  heroStatLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  heroCta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: '#FFFFFF', borderRadius: Radius.lg, padding: Spacing.md },
  heroCtaIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#E7F8F0', alignItems: 'center', justifyContent: 'center' },
  heroCtaTitle: { color: '#0F172A', fontSize: 15, fontWeight: '800' },
  heroCtaHint: { color: '#475569', fontSize: 12, marginTop: 1 },
  tabs: { gap: Spacing.sm, paddingVertical: 2 },
  tab: { height: 38, paddingHorizontal: 13, borderRadius: Radius.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tabText: { fontSize: 13, fontWeight: '700' },
  list: { gap: Spacing.md },
  empty: { borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.xxl, alignItems: 'center', gap: Spacing.md },
  emptyIcon: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  steps: { alignSelf: 'stretch', gap: Spacing.md, marginTop: Spacing.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cta: { height: 48, borderRadius: Radius.md, paddingHorizontal: Spacing.xxl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: Spacing.sm, alignSelf: 'stretch' },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
