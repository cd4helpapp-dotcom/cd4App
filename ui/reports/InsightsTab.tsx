import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, ChevronRight, Compass, ShieldCheck, Stethoscope } from 'lucide-react-native';
import type { MedicalReport } from '../../hooks/useMedicalReports';
import { elevation, Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAppLanguage } from '../../context/AppLanguageContext';
import {
  getAttentionCount,
  getFollowUps,
  getHighlights,
  getReportKind,
  getReportState,
  getReportTitle,
} from '../../src/utils/reportInsights';
import { FadeInUp, RangeMeter } from './ReportVisuals';

type Props = {
  reports: MedicalReport[];
  nowMs: number;
  onOpen: (report: MedicalReport) => void;
  onAddReport: () => void;
};

// Cross-report overview: what needs attention and what to do next, built only from reports AI has finished reading.
export default function InsightsTab({ reports, nowMs, onOpen, onAddReport }: Props) {
  const { theme } = useAppTheme();
  const { t } = useAppLanguage();
  const ready = reports.filter((report) => getReportState(report, nowMs) === 'ready');

  const flagged = ready
    .filter((report) => getReportKind(report) === 'lab')
    .map((report) => ({ report, count: getAttentionCount(report), items: getHighlights(report, 6).filter((h) => h.flag === 'high' || h.flag === 'low') }))
    .filter((row) => row.count > 0);

  const followUps = Array.from(new Set(ready.flatMap((report) => getFollowUps(report, 2)))).slice(0, 5);

  if (ready.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
          <Compass size={26} color={theme.primary} />
        </View>
        <Text style={[Typography.heading, { color: theme.text, textAlign: 'center' }]}>{t('reports.insightsEmptyTitle')}</Text>
        <Text style={[Typography.body, { color: theme.textSecondary, textAlign: 'center' }]}>
          {t('reports.insightsEmptyBody')}
        </Text>
        <Pressable onPress={onAddReport} accessibilityRole="button" style={[styles.cta, { backgroundColor: theme.buttonPrimary }]}>
          <Text style={styles.ctaText}>{t('reports.addFirst')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.statRow}>
        <View style={[styles.stat, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <Text style={[Typography.title, { color: theme.text }]}>{ready.length}</Text>
          <Text style={[Typography.caption, { color: theme.textSecondary }]}>{t('reports.reportsRead')}</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: flagged.length ? theme.dangerSoft : theme.successLight, borderColor: theme.borderColor }]}>
          <Text style={[Typography.title, { color: flagged.length ? theme.danger : theme.success }]}>{flagged.length}</Text>
          <Text style={[Typography.caption, { color: theme.textSecondary }]}>{flagged.length === 1 ? t('reports.reportToReview') : t('reports.reportsToReview')}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[Typography.overline, { color: theme.textTertiary }]}>{t('reports.needsAttentionCaps')}</Text>
        {flagged.length === 0 ? (
          <View style={[styles.card, { backgroundColor: theme.successLight, borderColor: theme.borderColor }]}>
            <ShieldCheck size={20} color={theme.success} />
            <Text style={[Typography.body, { color: theme.text, flex: 1 }]}>{t('reports.nothingFlaggedLong')}</Text>
          </View>
        ) : (
          flagged.map(({ report, count, items }, index) => (
            <FadeInUp key={report.id} index={index}>
            <Pressable
              onPress={() => onOpen(report)}
              accessibilityRole="button"
              style={[styles.card, styles.cardCol, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}
            >
              <View style={styles.cardHead}>
                <AlertTriangle size={18} color={theme.danger} />
                <Text style={[Typography.subheading, { color: theme.text, flex: 1 }]} numberOfLines={1}>{getReportTitle(report)}</Text>
                <ChevronRight size={18} color={theme.textTertiary} />
              </View>
              {items.slice(0, 3).map((item) => (
                <View key={item.name} style={styles.flagRow}>
                  <Text style={[Typography.body, { color: theme.textSecondary }]} numberOfLines={1}>
                    {item.name}: <Text style={{ color: theme.danger, fontWeight: '700' }}>{item.value} {item.unit}</Text>
                    {item.reference ? `  (${t('reports.normalRange', { range: item.reference })})` : ''}
                  </Text>
                  <RangeMeter item={item} />
                </View>
              ))}
              {count > 3 ? <Text style={[Typography.caption, { color: theme.textTertiary }]}>{t('reports.moreInReport', { count: count - 3 })}</Text> : null}
            </Pressable>
            </FadeInUp>
          ))
        )}
      </View>

      {followUps.length > 0 ? (
        <View style={styles.section}>
          <Text style={[Typography.overline, { color: theme.textTertiary }]}>{t('reports.nextStepsCaps')}</Text>
          <View style={[styles.card, styles.cardCol, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            {followUps.map((step) => (
              <View key={step} style={styles.step}>
                <View style={[styles.dot, { backgroundColor: theme.primary }]} />
                <Text style={[Typography.body, { color: theme.text, flex: 1 }]}>{step}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: theme.primarySoft, borderColor: theme.borderColor }]}>
        <Stethoscope size={20} color={theme.primary} />
        <Text style={[Typography.caption, { color: theme.textSecondary, flex: 1 }]}>
          {t('reports.insightsDisclaimer')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.xl },
  statRow: { flexDirection: 'row', gap: Spacing.md },
  stat: { flex: 1, borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.lg, gap: 2 },
  section: { gap: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.lg },
  cardCol: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  flagRow: { gap: 2 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  empty: { borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.xxl, alignItems: 'center', gap: Spacing.md },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cta: { height: 46, borderRadius: Radius.md, paddingHorizontal: Spacing.xl, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
