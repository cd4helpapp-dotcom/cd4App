import React from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { AlertCircle, CheckCircle2, Eye, Info } from 'lucide-react-native';
import { Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import { getRangeMeter, type PlainPoint, type ReportHighlight } from '../../src/utils/reportInsights';

const useNativeDriver = Platform.OS !== 'web';

// Cards settle into place one after another when a list first appears.
export function FadeInUp({ index = 0, style, children }: { index?: number; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const progress = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 320,
      delay: Math.min(index, 6) * 50,
      easing: Easing.out(Easing.cubic),
      useNativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, index]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return <Animated.View style={[style, { opacity: progress, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

// Shows where a value sits against its normal range. Renders nothing when the report gives no usable range.
export function RangeMeter({ item }: { item: ReportHighlight }) {
  const { theme } = useAppTheme();
  const meter = getRangeMeter(item);
  if (!meter) return null;
  const outside = item.flag === 'high' || item.flag === 'low' || meter.position < meter.normalStart || meter.position > meter.normalEnd;
  return (
    <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no">
      <View style={[styles.track, { backgroundColor: theme.dangerSoft }]}>
        <View
          style={[
            styles.normalZone,
            { left: `${meter.normalStart * 100}%`, width: `${(meter.normalEnd - meter.normalStart) * 100}%`, backgroundColor: theme.primaryBorder },
          ]}
        />
      </View>
      <View
        style={[
          styles.marker,
          { left: `${meter.position * 100}%`, backgroundColor: outside ? theme.danger : theme.primary, borderColor: theme.cardBackground },
        ]}
      />
    </View>
  );
}

// One finding in the summary, with a colour that shows how much it matters.
export function SummaryPoint({ point }: { point: PlainPoint }) {
  const { theme } = useAppTheme();
  const tone =
    point.tone === 'concern'
      ? { fg: theme.danger, bg: theme.dangerSoft, Icon: AlertCircle }
      : point.tone === 'watch'
        ? { fg: theme.warning, bg: theme.warningSoft, Icon: Eye }
        : point.tone === 'good'
          ? { fg: theme.success, bg: theme.successLight, Icon: CheckCircle2 }
          : { fg: theme.primary, bg: theme.primarySoft, Icon: Info };
  return (
    <View style={styles.point}>
      <View style={[styles.pointIcon, { backgroundColor: tone.bg }]}>
        <tone.Icon size={16} color={tone.fg} />
      </View>
      <View style={styles.pointText}>
        {point.title ? <Text style={[Typography.bodyStrong, { color: theme.text }]}>{point.title}</Text> : null}
        <Text style={[Typography.body, { color: point.title ? theme.textSecondary : theme.text }]}>{point.detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  meter: { height: 12, justifyContent: 'center' },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  normalZone: { position: 'absolute', top: 0, bottom: 0 },
  marker: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginLeft: -6 },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  pointIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, minWidth: 0, gap: 1 },
});
