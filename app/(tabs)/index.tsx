import React from 'react';
import { StyleSheet, View, TouchableOpacity, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import Colors from '../../constants/Colors';
// import ModeToggle from '../../ui/ModeToggle';
import TeleConsultationView from '../../ui/home/TeleConsultationView';
import { Bot } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
// import DiabetesReversalView from '../../ui/home/DiabetesReversalView';

export default function HomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const floatingBottom = Math.max(insets.bottom + 24, 28);
  const tabSwipeHandlers = useTabSwipeNavigation('index');

  return (
    <View {...tabSwipeHandlers} style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={{ flex: 1 }}>
        {/* <ModeToggle /> */}

        <View style={{ flex: 1 }}>
          <TeleConsultationView theme={theme} />
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
});
