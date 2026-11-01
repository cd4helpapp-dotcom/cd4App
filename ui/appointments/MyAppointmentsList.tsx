import React from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CalendarCheck, CalendarX, Clock, MessageCircle, RotateCcw, Stethoscope } from 'lucide-react-native';
import { elevation, Layout, Radius, Spacing, Typography } from '../../constants/Design';
import { useAppTheme } from '../../hooks/useAppTheme';
import { AVATAR_PLACEHOLDER, avatarSource } from '../../src/utils/avatar';

function DoctorAvatar({ uri }: { uri?: string | null }) {
  const [failed, setFailed] = React.useState(false);
  return <Image source={failed ? AVATAR_PLACEHOLDER : avatarSource(uri)} onError={() => setFailed(true)} style={styles.avatar} />;
}

export type AppointmentListItem = {
  id: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  appointmentType?: 'consultation' | 'second_opinion';
  date?: string; // YYYY-MM-DD
  startTime?: string; // HH:MM[:SS]
  endTime?: string;
  doctorId: string;
  doctorName: string;
  specialization?: string | null;
  city?: string | null;
  image?: string | null;
};

type Props = {
  items: AppointmentListItem[];
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onMessageDoctor: (item: AppointmentListItem) => void;
  onBookAgain: (item: AppointmentListItem) => void;
  onFindDoctor: () => void;
  bottomPadding?: number;
};

const toDate = (date?: string, time?: string): Date | null => {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;
  const [hh = 0, mm = 0] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
};

const formatTime = (time?: string): string => {
  const parsed = toDate('2000-01-01', time);
  if (!parsed) return '';
  return parsed.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
};

const formatDay = (date?: string): { label: string; sub: string } => {
  const parsed = toDate(date);
  if (!parsed) return { label: 'Date pending', sub: '' };
  const today = new Date();
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOf(parsed) - startOf(today)) / 86_400_000);
  const sub = parsed.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  if (diffDays === 0) return { label: 'Today', sub };
  if (diffDays === 1) return { label: 'Tomorrow', sub };
  return { label: sub, sub: parsed.toLocaleDateString('en-IN', { year: 'numeric' }) };
};

type Segment = 'upcoming' | 'past';

export default function MyAppointmentsList({ items, isLoading, isRefreshing, onRefresh, onMessageDoctor, onBookAgain, onFindDoctor, bottomPadding = 24 }: Props) {
  const { theme } = useAppTheme();
  const [segment, setSegment] = React.useState<Segment>('upcoming');

  const { upcoming, past } = React.useMemo(() => {
    const now = Date.now();
    const withTime = items.map((item) => ({ item, start: toDate(item.date, item.startTime), end: toDate(item.date, item.endTime || item.startTime) }));
    const isUpcoming = ({ item, end }: (typeof withTime)[number]) =>
      (item.status === 'pending' || item.status === 'confirmed') && (!end || end.getTime() >= now);
    const up = withTime.filter(isUpcoming).sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
    const ps = withTime.filter((row) => !isUpcoming(row)).sort((a, b) => (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0));
    return { upcoming: up.map((row) => row.item), past: ps.map((row) => row.item) };
  }, [items]);

  // Open on "Past" only when there is nothing upcoming but there is history.
  React.useEffect(() => {
    if (!isLoading && upcoming.length === 0 && past.length > 0) setSegment('past');
  }, [isLoading, past.length, upcoming.length]);

  const list = segment === 'upcoming' ? upcoming : past;
  const statusStyle = (status: AppointmentListItem['status'], isPast: boolean) => {
    if (isPast && (status === 'confirmed' || status === 'pending')) return { bg: theme.surfaceMuted, fg: theme.textSecondary, label: 'Ended' };
    switch (status) {
      case 'confirmed': return { bg: theme.successLight, fg: theme.success, label: 'Confirmed' };
      case 'pending': return { bg: theme.warningSoft, fg: theme.warning, label: 'Awaiting confirmation' };
      case 'completed': return { bg: theme.primarySoft, fg: theme.primary, label: 'Completed' };
      default: return { bg: theme.dangerSoft, fg: theme.danger, label: 'Cancelled' };
    }
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} colors={[theme.primary]} tintColor={theme.primary} />}
    >
      <View style={[styles.segment, { backgroundColor: theme.surfaceMuted }]} accessibilityRole="tablist">
        {(['upcoming', 'past'] as Segment[]).map((key) => {
          const active = segment === key;
          const count = key === 'upcoming' ? upcoming.length : past.length;
          return (
            <Pressable
              key={key}
              onPress={() => setSegment(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.segmentItem, active && [styles.segmentItemActive, { backgroundColor: theme.cardBackground }, elevation(1)]]}
            >
              <Text style={[Typography.label, { color: active ? theme.text : theme.textSecondary }]}>
                {key === 'upcoming' ? 'Upcoming' : 'Past'}{count > 0 ? ` · ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={theme.primary} /></View>
      ) : list.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
            {segment === 'upcoming' ? <CalendarCheck size={26} color={theme.primary} /> : <CalendarX size={26} color={theme.primary} />}
          </View>
          <Text style={[Typography.subheading, { color: theme.text }]}>
            {segment === 'upcoming' ? 'No upcoming appointments' : 'No past appointments yet'}
          </Text>
          <Text style={[Typography.body, styles.emptyText, { color: theme.textSecondary }]}>
            {segment === 'upcoming' ? 'Book a verified doctor and your consultation will show up here.' : 'Completed and cancelled consultations appear here.'}
          </Text>
          {segment === 'upcoming' ? (
            <Pressable onPress={onFindDoctor} accessibilityRole="button" style={({ pressed }) => [styles.cta, { backgroundColor: pressed ? theme.primaryPressed : theme.buttonPrimary }]}>
              <Stethoscope size={16} color="#FFFFFF" />
              <Text style={styles.ctaText}>Find a doctor</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        list.map((item) => {
          const day = formatDay(item.date);
          const status = statusStyle(item.status, segment === 'past');
          const isSecondOpinion = item.appointmentType === 'second_opinion';
          const canMessage = item.status === 'confirmed' || item.status === 'pending' || item.status === 'completed';
          return (
            <View key={item.id} style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }, elevation(1)]}>
              <View style={styles.cardTop}>
                <View style={[styles.dateTile, { backgroundColor: theme.primarySoft }]}>
                  <Text style={[styles.dateTileLabel, { color: theme.primary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{day.label}</Text>
                  {day.sub ? <Text style={[Typography.caption, { color: theme.primary }]} numberOfLines={1}>{day.sub}</Text> : null}
                </View>
                <View style={styles.flex}>
                  <View style={styles.timeRow}>
                    <Clock size={14} color={theme.textSecondary} />
                    <Text style={[Typography.bodyStrong, { color: theme.text }]}>
                      {formatTime(item.startTime)}{item.endTime ? ` – ${formatTime(item.endTime)}` : ''}
                    </Text>
                  </View>
                  <View style={styles.badges}>
                    <View style={[styles.badge, { backgroundColor: status.bg }]}>
                      <Text style={[styles.badgeText, { color: status.fg }]}>{status.label}</Text>
                    </View>
                    {isSecondOpinion ? (
                      <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
                        <Text style={[styles.badgeText, { color: theme.accent }]}>Second opinion</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>

              <View style={[styles.doctorRow, { borderTopColor: theme.divider }]}>
                <DoctorAvatar uri={item.image} />
                <View style={styles.flex}>
                  <Text style={[Typography.bodyStrong, { color: theme.text }]} numberOfLines={1}>{item.doctorName}</Text>
                  <Text style={[Typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
                    {[item.specialization, item.city].filter(Boolean).join(' · ') || 'Verified doctor'}
                  </Text>
                </View>
              </View>

              <View style={styles.actions}>
                {canMessage ? (
                  <Pressable onPress={() => onMessageDoctor(item)} accessibilityRole="button" style={({ pressed }) => [styles.action, { borderColor: theme.primaryBorder, backgroundColor: pressed ? theme.primaryBorder : theme.primarySoft }]}>
                    <MessageCircle size={15} color={theme.primary} />
                    <Text style={[Typography.label, { color: theme.primary }]}>Message</Text>
                  </Pressable>
                ) : null}
                {item.status === 'completed' || item.status === 'cancelled' ? (
                  <Pressable onPress={() => onBookAgain(item)} accessibilityRole="button" style={({ pressed }) => [styles.action, { borderColor: theme.borderColor, backgroundColor: pressed ? theme.surfaceMuted : theme.cardBackground }]}>
                    <RotateCcw size={15} color={theme.text} />
                    <Text style={[Typography.label, { color: theme.text }]}>Book again</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  content: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, maxWidth: Layout.contentMaxWidth, width: '100%', alignSelf: 'center', gap: Spacing.md },
  centered: { paddingVertical: Spacing.huge, alignItems: 'center' },
  segment: { flexDirection: 'row', borderRadius: Radius.md, padding: 4 },
  segmentItem: { flex: 1, height: 36, borderRadius: Radius.sm + 2, alignItems: 'center', justifyContent: 'center' },
  segmentItemActive: {},
  card: { borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md },
  cardTop: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  dateTile: { width: 100, height: 60, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  dateTileLabel: { fontSize: 15, fontWeight: '700' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11.5, fontWeight: '700' },
  doctorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth * 2, paddingTop: Spacing.md },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, height: 40, borderRadius: Radius.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  empty: { borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.xxl, alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  emptyIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  emptyText: { textAlign: 'center' },
  cta: { marginTop: Spacing.md, height: 46, paddingHorizontal: Spacing.xl, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', gap: 8 },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
