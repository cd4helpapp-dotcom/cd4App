import React from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAppLanguage } from '../../context/AppLanguageContext';

type Props = {
  since: string;
  isPdf: boolean;
  isPrescription: boolean;
};

const useNativeDriver = Platform.OS !== 'web';

// Step-by-step status shown while AI reads a file, like AI chat apps do after you attach a document.
// Only "Uploaded" is a confirmed server fact; the later steps advance on typical timings and the last one
// never shows as done — the screen switches to the result as soon as the server reports completion.
export default function AnalysisProgress({ since, isPdf, isPrescription }: Props) {
  const { theme } = useAppTheme();
  const { t } = useAppLanguage();
  const [now, setNow] = React.useState(() => Date.now());
  const pulse = React.useRef(new Animated.Value(0)).current;
  const scan = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver }),
      ])
    );
    const scanLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver }),
        Animated.timing(scan, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver }),
      ])
    );
    loop.start();
    scanLoop.start();
    return () => {
      clearInterval(id);
      loop.stop();
      scanLoop.stop();
    };
  }, [pulse, scan]);

  const start = new Date(since).getTime();
  const seconds = Number.isFinite(start) ? Math.max(0, Math.round((now - start) / 1000)) : 0;
  // Typical timings: photos are read carefully first, so 30–60 s; multi-page PDFs 30–90 s.
  const scale = 3;
  const steps = [
    { label: t('reports.stepUploaded'), doneAt: 0 },
    { label: isPdf ? t('reports.stepReadingPages') : t('reports.stepReadingPhoto'), doneAt: 4 * scale },
    { label: isPrescription ? t('reports.stepFindingMedicines') : t('reports.stepPickingValues'), doneAt: 9 * scale },
    { label: t('reports.stepWriting'), doneAt: Number.POSITIVE_INFINITY },
  ];
  const activeIndex = steps.findIndex((step) => seconds < step.doneAt || step.doneAt === Number.POSITIVE_INFINITY);
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  return (
    <View style={[styles.box, { backgroundColor: theme.surfaceMuted }]}>
      <View style={[styles.page, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        {[0.9, 0.7, 1, 0.6, 0.85].map((width, index) => (
          <View key={index} style={[styles.pageLine, { width: `${width * 100}%`, backgroundColor: theme.borderColor }]} />
        ))}
        <Animated.View
          style={[
            styles.scanLine,
            { backgroundColor: theme.primary, transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [0, 76] }) }] },
          ]}
        />
      </View>
      {steps.map((step, index) => {
        const done = index < activeIndex || (index === 0 && activeIndex > 0);
        const active = index === activeIndex;
        return (
          <View key={step.label} style={styles.row}>
            {done ? (
              <View style={[styles.mark, { backgroundColor: theme.success }]}>
                <Check size={12} color="#FFFFFF" strokeWidth={3} />
              </View>
            ) : active ? (
              <Animated.View style={[styles.mark, { backgroundColor: theme.primary, opacity: dotOpacity }]} />
            ) : (
              <View style={[styles.mark, { borderWidth: 2, borderColor: theme.borderColor }]} />
            )}
            <Text style={[Typography.body, { color: done ? theme.textSecondary : active ? theme.text : theme.textTertiary, fontWeight: active ? '600' : '400' }]}>
              {step.label}
              {active ? '…' : ''}
            </Text>
          </View>
        );
      })}
      <Text style={[Typography.caption, { color: theme.textTertiary, marginTop: 2 }]}>
        {isPdf ? t('reports.progressPdf', { seconds }) : t('reports.progressPhoto', { seconds })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  mark: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  page: { alignSelf: 'center', width: 76, height: 92, borderRadius: 10, borderWidth: 1, padding: 10, gap: 8, overflow: 'hidden', marginBottom: Spacing.xs },
  pageLine: { height: 5, borderRadius: 3 },
  scanLine: { position: 'absolute', left: 0, right: 0, top: 6, height: 3 },
});
