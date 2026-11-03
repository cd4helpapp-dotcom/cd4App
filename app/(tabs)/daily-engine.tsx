import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, useColorScheme } from 'react-native';
import { Bot, Volume2, Play } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import TimelineItem from '../../ui/TimelineItem';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import { useAuthContext } from '../../context/AuthContext';

const formatTimer = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
};

export default function DailyEngineScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const tabSwipeHandlers = useTabSwipeNavigation('daily-engine');
  const { user } = useAuthContext();
  const [secondsRemaining, setSecondsRemaining] = React.useState(15 * 60);
  const [isTimerRunning, setIsTimerRunning] = React.useState(false);
  const [isWalkCompleted, setIsWalkCompleted] = React.useState(false);

  React.useEffect(() => {
    if (!isTimerRunning) return;
    const timer = setInterval(() => {
      setSecondsRemaining((previous) => {
        if (previous <= 1) {
          setIsTimerRunning(false);
          setIsWalkCompleted(true);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isTimerRunning]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const firstName = user?.firstName?.trim() || 'there';
  const startTimer = () => {
    if (secondsRemaining === 0) setSecondsRemaining(15 * 60);
    setIsWalkCompleted(false);
    setIsTimerRunning(true);
  };

  return (
    <View {...tabSwipeHandlers} style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={[styles.greeting, { color: theme.text }]}>{greeting}, {firstName}</Text>
          <Text style={[styles.subGreeting, { color: theme.textSecondary }]}>Let's keep your sugar stable today.</Text>
        </View>

        <View style={[styles.aiCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <View style={styles.aiHeader}>
            <View style={[styles.aiAvatar, { backgroundColor: theme.primary }]}>
              <Bot size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.aiLabel, { color: theme.textSecondary }]}>AI Guide • Dr. Aarya</Text>
              <Text style={[styles.aiMessage, { color: theme.text }]}>"Namaste Nitesh! A 15-minute walk now will help flatten your post-lunch spike."</Text>
            </View>
          </View>
          <TouchableOpacity style={[styles.audioButton, { backgroundColor: theme.background }]}>
            <Volume2 size={20} color={theme.iconPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Happening Now</Text>
          <View style={[styles.expireBadge, { backgroundColor: theme.badgeBackground }]}>
            <Text style={[styles.expireText, { color: theme.badgeText }]}>Expiring in 20m</Text>
          </View>
        </View>

        <View style={[styles.actionCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <View style={styles.actionContent}>
            <Text style={[styles.actionTime, { color: theme.text }]}>2:00 PM: Post-meal Walk</Text>
            <Text style={[styles.actionDesc, { color: theme.textSecondary }]}>Walking immediately after a meal moves glucose into your muscles instead of storing it as fat.</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: theme.buttonPrimary }, isWalkCompleted && { opacity: 0.7 }]}
                onPress={startTimer}
                disabled={isWalkCompleted || isTimerRunning}
              >
                <Play size={12} color={theme.buttonText} style={{ marginRight: 5 }} />
                <Text style={[styles.primaryButtonText, { color: theme.buttonText }]}>
                  {isWalkCompleted ? 'Walk complete' : isTimerRunning ? formatTimer(secondsRemaining) : 'Start 15m Timer'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                onPress={() => { setIsTimerRunning(false); setIsWalkCompleted(true); }}
                disabled={isWalkCompleted}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.textSecondary }]}>{isWalkCompleted ? 'Completed' : 'I already did this'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={[styles.actionImagePlaceholder, { backgroundColor: theme.borderColor }]}>
            <View style={{ backgroundColor: theme.textSecondary, flex: 1, opacity: 0.1 }} />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 15 }]}>Today's Journey</Text>

        <View style={styles.timelineContainer}>
          <TimelineItem
            type="completed"
            time="1:00 PM"
            title="Log Lunch: Roti & Dal"
            subtitle="Great job keeping the carbs moderate!"
            theme={theme}
          />
          <TimelineItem
            type="future"
            title=""
            subtitle=""
            theme={theme}
            microHabit={{
              tag: "MICRO-HABIT",
              title: "Why eat Dal before Rice?",
              description: "The fiber and protein in Dal create a \"mesh\" in your stomach, slowing down sugar absorption."
            }}
          />
          <TimelineItem
            type="skipped"
            title="Morning Yoga"
            subtitle="Skipped for now. Tomorrow is a new day! ☀️"
            isLast={true}
            theme={theme}
          />
        </View>

        <View style={[styles.addHabitContainer, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.addHabitTitle, { color: theme.text }]}>Add a Micro-Habit</Text>
          <TouchableOpacity style={[styles.habitOption, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
            <Text style={{ color: theme.text }}>🥛 Drink Jeera Water</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.habitOption, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
            <Text style={{ color: theme.text }}>🚶 Stand while calling</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 100 },
  header: { marginBottom: 20, marginTop: 10 },
  greeting: { fontSize: 24, fontWeight: '800', marginBottom: 8 },
  subGreeting: { fontSize: 15, fontWeight: '500' },
  aiCard: { borderRadius: 20, padding: 16, marginBottom: 25, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 3 },
  aiHeader: { flexDirection: 'row', flex: 1, paddingRight: 10 },
  aiAvatar: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  aiLabel: { fontSize: 11, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 },
  aiMessage: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  audioButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle: { fontSize: 19, fontWeight: '800' },
  expireBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  expireText: { fontSize: 11, fontWeight: '700' },
  actionCard: { borderRadius: 24, overflow: 'hidden', marginBottom: 35, flexDirection: 'row', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.08, shadowRadius: 15, borderWidth: 1 },
  actionContent: { flex: 0.65, padding: 24 },
  actionImagePlaceholder: { flex: 0.35 },
  actionTime: { fontSize: 17, fontWeight: '800', marginBottom: 6 },
  actionDesc: { fontSize: 13, marginBottom: 20, lineHeight: 18, fontWeight: '500' },
  buttonRow: { flexDirection: 'column', gap: 12 },
  primaryButton: { paddingVertical: 12, paddingHorizontal: 15, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', shadowColor: '#00C853', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  primaryButtonText: { fontSize: 14, fontWeight: '800' },
  secondaryButton: { borderWidth: 1.5, paddingVertical: 12, paddingHorizontal: 15, borderRadius: 12, alignItems: 'center' },
  secondaryButtonText: { fontSize: 13, fontWeight: '600' },
  timelineContainer: { paddingLeft: 5 },
  addHabitContainer: { marginTop: 5, padding: 20, borderRadius: 20, borderWidth: 1 },
  addHabitTitle: { fontSize: 15, fontWeight: '700', marginBottom: 15 },
  habitOption: { padding: 14, borderRadius: 12, marginBottom: 10, borderWidth: 1 },
});
