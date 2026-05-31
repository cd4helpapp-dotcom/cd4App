import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check, Circle, Info } from 'lucide-react-native';
import { Theme } from '../constants/Colors';

interface TimelineItemProps {
  type: 'completed' | 'future' | 'skipped';
  time?: string;
  title: string;
  subtitle: string;
  isLast?: boolean;
  theme: Theme;
  microHabit?: {
    tag: string;
    title: string;
    description: string;
  };
}

export default function TimelineItem({ type, time, title, subtitle, isLast, theme, microHabit }: TimelineItemProps) {
  return (
    <View style={styles.timelineItem}>
      <View style={styles.timelineLeft}>
        {type === 'completed' && <View style={[styles.timelineDotCompleted, { backgroundColor: theme.success }]} />}
        {type === 'future' && <View style={[styles.timelineDotFuture, { borderColor: theme.textSecondary, backgroundColor: theme.cardBackground }]} />}
        {type === 'skipped' && <View style={[styles.timelineDotSkipped, { backgroundColor: theme.textSecondary }]} />}
        {!isLast && <View style={[styles.timelineLine, { backgroundColor: theme.borderColor }]} />}
      </View>
      <View style={styles.timelineContent}>
        {microHabit ? (
          <View style={[styles.microHabitCard, { backgroundColor: theme.successLight }]}>
            <View style={[styles.microHabitImage, { backgroundColor: theme.successBorder }]}>
              <Info size={24} color="#1ABC9C" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.microHabitTag}>{microHabit.tag}</Text>
              <Text style={[styles.microHabitTitle, { color: theme.text }]}>{microHabit.title}</Text>
              <Text style={[styles.microHabitDesc, { color: theme.textSecondary }]}>{microHabit.description}</Text>
            </View>
          </View>
        ) : (
          <>
            {time && <Text style={[styles.timelineTime, { color: theme.success }]}>{type === 'completed' ? 'COMPLETED • ' : ''}{time}</Text>}
            <View style={[styles.timelineCard, { backgroundColor: type === 'skipped' ? theme.background : theme.cardBackground, borderColor: type === 'skipped' ? 'transparent' : theme.borderColor }]}>
              <View>
                <Text style={[styles.timelineTitle, { color: type === 'skipped' ? theme.textSecondary : theme.text }]}>{title}</Text>
                <Text style={[styles.timelineSubtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
              </View>
              {type === 'completed' && (
                <View style={[styles.checkIcon, { backgroundColor: theme.success }]}>
                  <Check size={16} color="#fff" strokeWidth={3} />
                </View>
              )}
              {type === 'skipped' && <Circle size={20} color={theme.textSecondary} />}
            </View>
          </>
        )}
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  timelineItem: { flexDirection: 'row', marginBottom: 30 },
  timelineLeft: { alignItems: 'center', marginRight: 15, width: 20 },
  timelineDotCompleted: { width: 14, height: 14, borderRadius: 7, marginTop: 2 },
  timelineDotFuture: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, marginTop: 2 },
  timelineDotSkipped: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  timelineLine: { width: 2, flex: 1, marginTop: 10, marginBottom: -10 },
  timelineContent: { flex: 1 },
  timelineTime: { fontSize: 11, fontWeight: '800', marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  timelineCard: { padding: 18, borderRadius: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1 },
  timelineTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  timelineSubtitle: { fontSize: 12, fontWeight: '500' },
  checkIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  microHabitCard: { borderRadius: 16, padding: 16, flexDirection: 'row' },
  microHabitImage: { width: 50, height: 50, borderRadius: 12, marginRight: 15, alignItems: 'center', justifyContent: 'center' },
  microHabitTag: { fontSize: 9, color: '#F39C12', fontWeight: '800', marginBottom: 4, letterSpacing: 0.5 },
  microHabitTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  microHabitDesc: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
});
