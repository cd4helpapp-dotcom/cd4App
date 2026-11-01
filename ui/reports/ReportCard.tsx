import React from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, FileText, FlaskConical, MessageCircle, Pill, RefreshCw, Trash2 } from 'lucide-react-native';
import type { MedicalReport } from '../../hooks/useMedicalReports';
import { getMedicalReportAnalysisErrorMessage } from '../../hooks/useMedicalReports';
import { elevation, Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import {
  formatFileSize,
  formatShortDate,
  getAttentionCount,
  getHighlights,
  getMedicineCount,
  getPlainSummary,
  getReportDate,
  getReportKind,
  getReportState,
  getReportTitle,
  type ReportHighlight,
} from '../../src/utils/reportInsights';

type Props = {
  report: MedicalReport;
  nowMs: number;
  isBusy?: boolean;
  onOpen: (report: MedicalReport) => void;
  onRetry: (report: MedicalReport) => void;
  onDelete: (report: MedicalReport) => void;
};

const useNativeDriver = Platform.OS !== 'web';

// Indeterminate bar for "AI is reading your report".
function ScanBar({ color, track }: { color: string; track: string }) {
  const progress = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver }));
    loop.start();
    return () => loop.stop();
  }, [progress]);
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-120, 260] });
  return (
    <View style={[styles.scanTrack, { backgroundColor: track }]}>
      <Animated.View style={[styles.scanFill, { backgroundColor: color, transform: [{ translateX }] }]} />
    </View>
  );
}

// Live seconds counter so waiting feels honest ("14 s so far") instead of a bar that never says how long.
function ElapsedLabel({ since, color }: { since: string; color: string }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const start = new Date(since).getTime();
  const seconds = Number.isFinite(start) ? Math.max(0, Math.round((now - start) / 1000)) : 0;
  return <Text style={[Typography.caption, { color }]}>{seconds}s so far · photos take about 15 s, long PDFs up to a minute</Text>;
}

const flagArrow = (flag: ReportHighlight['flag']) => (flag === 'high' ? '↑' : flag === 'low' ? '↓' : '');

export default function ReportCard({ report, nowMs, isBusy, onOpen, onRetry, onDelete }: Props) {
  const { theme } = useAppTheme();
  const kind = getReportKind(report);
  const state = getReportState(report, nowMs);
  const { date, isUploadDate } = getReportDate(report);
  const title = getReportTitle(report);
  const KindIcon = kind === 'prescription' ? Pill : kind === 'lab' ? FlaskConical : FileText;
  const kindLabel = kind === 'prescription' ? 'Prescription' : kind === 'lab' ? 'Lab report' : 'Document';
  const attention = state === 'ready' && kind !== 'prescription' ? getAttentionCount(report) : 0;
  const medicines = state === 'ready' && kind === 'prescription' ? getMedicineCount(report) : 0;
  const highlights = state === 'ready' && kind === 'lab' ? getHighlights(report, 3) : [];
  const summary = state === 'ready' ? getPlainSummary(report, 190) : '';
  const meta = [formatShortDate(date) + (isUploadDate ? '' : ''), kindLabel, formatFileSize(report.fileSizeBytes)].filter(Boolean).join(' · ');

  const tone =
    state === 'ready'
      ? { fg: theme.primary, bg: theme.primarySoft }
      : state === 'failed' || state === 'stuck'
        ? { fg: theme.warning, bg: theme.warningSoft }
        : { fg: theme.accent, bg: theme.accentSoft };

  return (
    // Header is the only card-wide tap target; action buttons below are siblings so web does not nest <button> in <button>.
    <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}>
      <Pressable
        onPress={() => (state === 'ready' || state === 'scanning' ? onOpen(report) : undefined)}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${state === 'ready' ? 'ready' : state === 'scanning' ? 'being read by AI' : state === 'stuck' ? 'taking longer than usual' : 'could not be read'}`}
        style={styles.top}
      >
        <View style={[styles.kindTile, { backgroundColor: tone.bg }]}>
          <KindIcon size={22} color={tone.fg} />
        </View>
        <View style={styles.flex}>
          <Text style={[Typography.subheading, { color: theme.text }]} numberOfLines={1}>{title}</Text>
          <Text style={[Typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>{meta}</Text>
        </View>
        {state === 'ready' ? <ChevronRight size={20} color={theme.textTertiary} /> : null}
      </Pressable>

      {state === 'ready' ? (
        <>
          <View style={styles.chips}>
            <View style={[styles.chip, { backgroundColor: theme.successLight }]}>
              <CheckCircle2 size={13} color={theme.success} />
              <Text style={[styles.chipText, { color: theme.success }]}>Ready</Text>
            </View>
            {kind === 'prescription' ? (
              medicines > 0 ? (
                <View style={[styles.chip, { backgroundColor: theme.primarySoft }]}>
                  <Pill size={13} color={theme.primary} />
                  <Text style={[styles.chipText, { color: theme.primary }]}>{medicines} medicine{medicines === 1 ? '' : 's'}</Text>
                </View>
              ) : null
            ) : attention > 0 ? (
              <View style={[styles.chip, { backgroundColor: theme.dangerSoft }]}>
                <AlertTriangle size={13} color={theme.danger} />
                <Text style={[styles.chipText, { color: theme.danger }]}>{attention} need{attention === 1 ? 's' : ''} attention</Text>
              </View>
            ) : kind === 'lab' ? (
              <View style={[styles.chip, { backgroundColor: theme.successLight }]}>
                <Text style={[styles.chipText, { color: theme.success }]}>Nothing flagged</Text>
              </View>
            ) : null}
          </View>

          {summary ? <Text style={[Typography.body, { color: theme.textSecondary }]} numberOfLines={3}>{summary}</Text> : null}

          {highlights.length > 0 ? (
            <View style={styles.highlights}>
              {highlights.map((item) => {
                const bad = item.flag === 'high' || item.flag === 'low';
                // Neutral tile like a printed lab report; only the value and a small High/Low tag carry colour.
                return (
                  <View key={item.name} style={[styles.highlight, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <Text style={[Typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[styles.value, { color: bad ? theme.danger : theme.text }]} numberOfLines={1}>
                      {item.value}
                    </Text>
                    {item.unit ? <Text style={[styles.unit, { color: theme.textTertiary }]} numberOfLines={1}>{item.unit}</Text> : null}
                    {bad ? (
                      <View style={[styles.flagTag, { backgroundColor: theme.dangerSoft }]}>
                        <Text style={[styles.flagTagText, { color: theme.danger }]}>
                          {flagArrow(item.flag)} {item.flag === 'high' ? 'High' : 'Low'}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={[styles.actions, { borderTopColor: theme.divider }]}>
            <Pressable onPress={() => onOpen(report)} accessibilityRole="button" style={({ pressed }) => [styles.primaryAction, { backgroundColor: pressed ? theme.primaryPressed : theme.buttonPrimary }]}>
              <MessageCircle size={15} color="#FFFFFF" />
              <Text style={styles.primaryActionText}>Read explanation & ask AI</Text>
            </Pressable>
            <Pressable onPress={() => onDelete(report)} accessibilityRole="button" accessibilityLabel="Delete report" hitSlop={8} style={[styles.iconAction, { backgroundColor: theme.dangerSoft }]}>
              <Trash2 size={16} color={theme.danger} />
            </Pressable>
          </View>
        </>
      ) : null}

      {state === 'scanning' ? (
        <View style={styles.statusBlock}>
          <View style={styles.statusRow}>
            <Clock size={14} color={theme.accent} />
            <Text style={[Typography.bodyStrong, { color: theme.accent }]}>AI is reading your report</Text>
          </View>
          <ScanBar color={theme.accent} track={theme.accentSoft} />
          <ElapsedLabel since={report.updatedAt || report.createdAt} color={theme.textSecondary} />
          <Text style={[Typography.caption, { color: theme.textTertiary }]}>You can leave this screen; it will be ready here.</Text>
        </View>
      ) : null}

      {state === 'stuck' || state === 'failed' ? (
        <View style={styles.statusBlock}>
          <View style={styles.statusRow}>
            <AlertTriangle size={14} color={theme.warning} />
            <Text style={[Typography.bodyStrong, { color: theme.warning }]}>{state === 'stuck' ? 'This is taking longer than usual' : 'We could not read this report'}</Text>
          </View>
          <Text style={[Typography.caption, { color: theme.textSecondary }]}>
            {state === 'stuck'
              ? 'The scan did not finish. Try again; your file is safe.'
              : getMedicalReportAnalysisErrorMessage(report.analysisError)}
          </Text>
          <View style={styles.actionsPlain}>
            <Pressable
              onPress={() => onRetry(report)}
              disabled={isBusy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.primaryAction, { backgroundColor: pressed ? theme.primaryPressed : theme.buttonPrimary, opacity: isBusy ? 0.6 : 1 }]}
            >
              <RefreshCw size={15} color="#FFFFFF" />
              <Text style={styles.primaryActionText}>{isBusy ? 'Trying…' : 'Try again'}</Text>
            </Pressable>
            <Pressable onPress={() => onDelete(report)} accessibilityRole="button" accessibilityLabel="Delete report" hitSlop={8} style={[styles.iconAction, { backgroundColor: theme.dangerSoft }]}>
              <Trash2 size={16} color={theme.danger} />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: { borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  kindTile: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: '700' },
  highlights: { flexDirection: 'row', gap: Spacing.sm },
  highlight: { flex: 1, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 3 },
  value: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  unit: { fontSize: 11, fontWeight: '500' },
  flagTag: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  flagTagText: { fontSize: 10.5, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth * 2, paddingTop: Spacing.md },
  actionsPlain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  primaryAction: { flex: 1, height: 42, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryActionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  iconAction: { width: 42, height: 42, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  statusBlock: { gap: Spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scanTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  scanFill: { width: 120, height: 6, borderRadius: 3 },
});
