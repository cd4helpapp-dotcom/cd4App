import React from 'react';
import { InteractionManager, StyleSheet, View, TouchableOpacity, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import Colors from '../../constants/Colors';
// import ModeToggle from '../../ui/ModeToggle';
import TeleConsultationView from '../../ui/home/TeleConsultationView';
import { Bot } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import { requestLocationPermissionOnce } from '../../services/locationPermission';
// import DiabetesReversalView from '../../ui/home/DiabetesReversalView';

export default function HomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const floatingBottom = Math.max(insets.bottom + 24, 28);
  const tabSwipeHandlers = useTabSwipeNavigation('index');
  const [shouldMountHomeContent, setShouldMountHomeContent] = React.useState(false);

  React.useEffect(() => {
    // Request location only after the authenticated home tab mounts. Keeping
    // this out of the root layout prevents the permission prompt from
    // appearing over login/signup screens.
    void requestLocationPermissionOnce();
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) setShouldMountHomeContent(true);
    });
    const fallbackTimer = setTimeout(() => {
      if (!cancelled) setShouldMountHomeContent(true);
    }, 450);

    return () => {
      cancelled = true;
      task?.cancel?.();
      clearTimeout(fallbackTimer);
    };
  }, []);

  return (
    <View {...tabSwipeHandlers} style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={{ flex: 1 }}>
        {/* <ModeToggle /> */}

        <View style={{ flex: 1 }}>
          {shouldMountHomeContent ? (
            <TeleConsultationView theme={theme} />
          ) : (
            <View style={styles.homeBootstrap}>
              <View style={[styles.bootstrapCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={[styles.bootstrapLine, { width: '58%', backgroundColor: theme.borderColor }]} />
                <View style={[styles.bootstrapLine, { width: '86%', backgroundColor: theme.borderColor, opacity: 0.75 }]} />
                <View style={[styles.bootstrapHero, { backgroundColor: theme.borderColor, opacity: 0.26 }]} />
                <View style={styles.bootstrapRow}>
                  <View style={[styles.bootstrapPill, { backgroundColor: theme.borderColor, opacity: 0.55 }]} />
                  <View style={[styles.bootstrapPill, { backgroundColor: theme.borderColor, opacity: 0.45 }]} />
                  <View style={[styles.bootstrapPill, { backgroundColor: theme.borderColor, opacity: 0.35 }]} />
                </View>
              </View>
              <View style={[styles.bootstrapCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={[styles.bootstrapLine, { width: '42%', backgroundColor: theme.borderColor }]} />
                <View style={[styles.bootstrapBlock, { backgroundColor: theme.borderColor, opacity: 0.24 }]} />
              </View>
            </View>
          )}
        </View>
      </View>

      {/* CD4 AI Floating Button - Commented out as requested */}
      {/* <TouchableOpacity
        style={[styles.aiFloatingButton, { backgroundColor: theme.tint, bottom: floatingBottom }]}
        activeOpacity={0.9}
        onPress={() => router.push({ pathname: '/ai-guidance', params: { variant: 'assistant', concern: 'General Assistant' } })}
      >
        <Bot size={18} color="#fff" />
        <Text style={styles.aiFloatingButtonText}>cd4.Ai</Text>
      </TouchableOpacity> */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  aiFloatingButton: {
    position: 'absolute',
    right: 16,
    minWidth: 108,
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0C2E22',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 8,
    gap: 6,
  },
  aiFloatingButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  homeBootstrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 14,
  },
  bootstrapCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  bootstrapLine: {
    height: 12,
    borderRadius: 999,
  },
  bootstrapHero: {
    height: 140,
    borderRadius: 20,
  },
  bootstrapRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bootstrapPill: {
    flex: 1,
    height: 34,
    borderRadius: 17,
  },
  bootstrapBlock: {
    height: 64,
    borderRadius: 16,
  },
});
