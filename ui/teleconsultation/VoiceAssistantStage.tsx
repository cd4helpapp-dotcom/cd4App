import React from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Hand, Keyboard as KeyboardIcon, Mic, MicOff, PhoneOff, Plus } from 'lucide-react-native';
import { Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';

export type VoiceStageState = 'off' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'paused' | 'error';

type Props = {
  state: VoiceStageState;
  statusText: string;
  // Live caption: what the assistant is saying (or the patient's last words while listening).
  caption?: string;
  captionSpeaker?: 'assistant' | 'patient';
  onMicPress: () => void;
  onSwitchToText: () => void;
  onEnd: () => void;
  onNewSession?: () => void;
};

const useNativeDriver = Platform.OS !== 'web';

const STATE_LABEL: Record<VoiceStageState, string> = {
  off: 'Tap to start',
  connecting: 'Connecting',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  paused: 'Paused',
  error: 'Unavailable',
};

// The assistant's "presence": a glossy 3D sphere whose motion tells the patient what is happening.
function VoiceOrb({ state }: { state: VoiceStageState }) {
  const { isDark } = useAppTheme();
  const ring = React.useRef(new Animated.Value(0)).current;
  const breathe = React.useRef(new Animated.Value(0)).current;
  const spin = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loops: Animated.CompositeAnimation[] = [];
    ring.setValue(0);
    breathe.setValue(0);
    spin.setValue(0);

    if (state === 'listening') {
      loops.push(Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver })));
    }
    if (state === 'speaking' || state === 'listening') {
      const speed = state === 'speaking' ? 420 : 1400;
      loops.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(breathe, { toValue: 1, duration: speed, easing: Easing.inOut(Easing.sin), useNativeDriver }),
            Animated.timing(breathe, { toValue: 0, duration: speed, easing: Easing.inOut(Easing.sin), useNativeDriver }),
          ])
        )
      );
    }
    if (state === 'thinking' || state === 'connecting') {
      loops.push(Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver })));
    }
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [breathe, ring, spin, state]);

  const isActive = state === 'listening' || state === 'speaking' || state === 'thinking' || state === 'connecting';
  const sphereColors = (
    state === 'error' || state === 'off' || state === 'paused'
      ? isDark ? ['#3B4A63', '#1E293B', '#111827'] : ['#E2E8F0', '#CBD5E1', '#94A3B8']
      : state === 'speaking'
        ? ['#6EE7B7', '#10B981', '#047857']
        : ['#A7F3D0', '#34D399', '#059669']
  ) as [string, string, string];

  const sphereScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, state === 'speaking' ? 1.07 : 1.03] });
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.orbWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {state === 'listening' ? (
        <Animated.View style={[styles.orbRing, { borderColor: '#34D399', opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
      ) : null}
      {state === 'thinking' || state === 'connecting' ? (
        <Animated.View style={[styles.orbSpinner, { transform: [{ rotate }] }]} />
      ) : null}
      <Animated.View style={[styles.orbShadow, { opacity: isActive ? 1 : 0.5, transform: [{ scale: sphereScale }] }]}>
        <LinearGradient colors={sphereColors} start={{ x: 0.2, y: 0.1 }} end={{ x: 0.85, y: 0.95 }} style={styles.sphere}>
          {/* Specular highlight + soft rim light make the flat circle read as a lit 3D sphere. */}
          <LinearGradient
            colors={['rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.highlight}
          />
          <View style={styles.rimLight} />
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

export default function VoiceAssistantStage({ state, statusText, caption, captionSpeaker = 'assistant', onMicPress, onSwitchToText, onEnd, onNewSession }: Props) {
  const { theme } = useAppTheme();
  const isBusy = state === 'connecting';
  const stateColor =
    state === 'error' ? theme.danger : state === 'paused' || state === 'off' ? theme.textSecondary : state === 'speaking' ? theme.accent : theme.primary;

  const mainButton = (() => {
    if (state === 'speaking') return { Icon: Hand, label: 'Interrupt', bg: theme.cardBackground, fg: theme.text, border: theme.borderColor };
    if (state === 'listening') return { Icon: Mic, label: 'Pause microphone', bg: theme.buttonPrimary, fg: '#FFFFFF', border: theme.buttonPrimary };
    if (state === 'thinking') return { Icon: Mic, label: 'Waiting for reply', bg: theme.primarySoft, fg: theme.primary, border: theme.primarySoft };
    return { Icon: state === 'paused' ? MicOff : Mic, label: 'Start talking', bg: theme.buttonPrimary, fg: '#FFFFFF', border: theme.buttonPrimary };
  })();

  return (
    <View style={[styles.stage, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
      <VoiceOrb state={state} />

      <View style={[styles.statusChip, { backgroundColor: theme.surfaceMuted }]} accessibilityLiveRegion="polite">
        <View style={[styles.statusDot, { backgroundColor: stateColor }]} />
        <Text style={[Typography.label, { color: stateColor }]}>{STATE_LABEL[state]}</Text>
      </View>
      <Text style={[Typography.body, styles.statusText, { color: theme.textSecondary }]} numberOfLines={2}>
        {statusText}
      </Text>

      {caption ? (
        <View style={[styles.caption, { backgroundColor: theme.background, borderColor: theme.divider }]}>
          <Text style={[Typography.overline, { color: captionSpeaker === 'assistant' ? theme.primary : theme.textSecondary }]}>
            {captionSpeaker === 'assistant' ? 'CD4 ASSISTANT' : 'YOU'}
          </Text>
          <Text style={[Typography.body, { color: theme.text }]} numberOfLines={5}>
            {caption}
          </Text>
        </View>
      ) : null}

      <View style={styles.controls}>
        <View style={styles.sideControl}>
          <Pressable
            onPress={onSwitchToText}
            accessibilityRole="button"
            accessibilityLabel="Type instead"
            style={({ pressed }) => [styles.sideButton, { backgroundColor: pressed ? theme.surfaceMuted : theme.background, borderColor: theme.borderColor }]}
          >
            <KeyboardIcon size={20} color={theme.text} />
          </Pressable>
          <Text style={[Typography.caption, { color: theme.textSecondary }]}>Type</Text>
        </View>

        <View style={styles.sideControl}>
          <Pressable
            onPress={onMicPress}
            disabled={isBusy}
            accessibilityRole="button"
            accessibilityLabel={mainButton.label}
            style={({ pressed }) => [
              styles.mainButton,
              { backgroundColor: mainButton.bg, borderColor: mainButton.border, opacity: pressed ? 0.88 : 1 },
            ]}
          >
            {isBusy ? <ActivityIndicator color={theme.primary} /> : <mainButton.Icon size={28} color={mainButton.fg} />}
          </Pressable>
          <Text style={[Typography.caption, { color: theme.textSecondary }]}>{mainButton.label}</Text>
        </View>

        <View style={styles.sideControl}>
          <Pressable
            onPress={onEnd}
            accessibilityRole="button"
            accessibilityLabel="End voice session"
            style={({ pressed }) => [styles.sideButton, { backgroundColor: pressed ? theme.dangerBorder : theme.dangerSoft, borderColor: theme.dangerBorder }]}
          >
            <PhoneOff size={20} color={theme.danger} />
          </Pressable>
          <Text style={[Typography.caption, { color: theme.textSecondary }]}>End</Text>
        </View>
      </View>

      {onNewSession ? (
        <Pressable onPress={onNewSession} accessibilityRole="button" hitSlop={8} style={styles.newSession}>
          <Plus size={14} color={theme.primary} />
          <Text style={[Typography.label, { color: theme.primary }]}>New conversation</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const ORB = 148;

const styles = StyleSheet.create({
  stage: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.lg,
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  orbWrap: {
    width: ORB + 48,
    height: ORB + 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  orbRing: {
    position: 'absolute',
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    borderWidth: 3,
  },
  orbSpinner: {
    position: 'absolute',
    width: ORB + 22,
    height: ORB + 22,
    borderRadius: (ORB + 22) / 2,
    borderWidth: 3,
    borderColor: 'transparent',
    borderTopColor: '#34D399',
    borderRightColor: 'rgba(46,196,182,0.35)',
  },
  orbShadow: {
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    shadowColor: '#059669',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  sphere: {
    flex: 1,
    borderRadius: ORB / 2,
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: ORB * 0.08,
    left: ORB * 0.2,
    width: ORB * 0.5,
    height: ORB * 0.32,
    borderRadius: ORB,
    transform: [{ rotate: '-18deg' }],
  },
  rimLight: {
    position: 'absolute',
    bottom: ORB * 0.06,
    right: ORB * 0.14,
    width: ORB * 0.34,
    height: ORB * 0.12,
    borderRadius: ORB,
    backgroundColor: 'rgba(255,255,255,0.18)',
    transform: [{ rotate: '-30deg' }],
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    textAlign: 'center',
    marginTop: Spacing.sm,
    minHeight: 22,
  },
  caption: {
    alignSelf: 'stretch',
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md + 2,
    marginTop: Spacing.lg,
    gap: 4,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.sm,
  },
  sideControl: {
    alignItems: 'center',
    gap: 6,
    minWidth: 72,
  },
  sideButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  mainButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#059669',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  newSession: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.lg,
  },
});
