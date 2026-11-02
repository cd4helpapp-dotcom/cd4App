import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarDays, ChevronRight, Clock, MapPin, Star, Stethoscope } from 'lucide-react-native';
import { Radius, Spacing, Typography } from '../../constants/Design';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { formatClock } from '../../src/utils/slotTime';

export type DoctorCardData = {
  id: string;
  firstName: string;
  lastName: string;
  city?: string;
  specialization: string;
  experience?: string;
  fee?: string;
  rating?: number;
};

export type SlotCardData = {
  id: string;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  doctorId?: string;
  doctorName?: string;
  doctorSpecialization?: string;
};

const MAX_SLOTS = 5;

export const doctorDisplayName = (doctor: Pick<DoctorCardData, 'firstName' | 'lastName'>): string => {
  const name = `${doctor.firstName || ''} ${doctor.lastName || ''}`.trim();
  return name ? `Dr. ${name}` : 'Doctor';
};

const dayLabel = (date: string | null | undefined, t: (key: any) => string): string => {
  if (!date) return '';
  const day = new Date(`${date}T00:00:00`);
  if (Number.isNaN(day.getTime())) return date;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysAway = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (daysAway === 0) return t('ai.today');
  if (daysAway === 1) return t('ai.tomorrow');
  return day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

export function DoctorCards({ doctors, disabled, onViewSlots }: { doctors: DoctorCardData[]; disabled?: boolean; onViewSlots: (doctor: DoctorCardData) => void }) {
  const { theme } = useAppTheme();
  const { t } = useAppLanguage();
  return (
    <View style={styles.stack}>
      {doctors.map((doctor) => {
        const name = doctorDisplayName(doctor);
        const hasRating = typeof doctor.rating === 'number' && doctor.rating > 0;
        return (
          <View key={doctor.id} style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <View style={styles.doctorRow}>
              <View style={[styles.avatar, { backgroundColor: theme.primarySoft }]}>
                <Stethoscope size={20} color={theme.primary} />
              </View>
              <View style={styles.flex}>
                <Text style={[Typography.bodyStrong, { color: theme.text }]} numberOfLines={1}>{name}</Text>
                <Text style={[Typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>
                  {[doctor.specialization, doctor.experience].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {hasRating ? (
                <View style={[styles.rating, { backgroundColor: theme.warningSoft }]}>
                  <Star size={12} color={theme.warning} fill={theme.warning} />
                  <Text style={[styles.ratingText, { color: theme.warning }]}>{Number(doctor.rating).toFixed(1)}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.footer}>
              <View style={styles.flex}>
                {doctor.city ? (
                  <View style={styles.metaRow}>
                    <MapPin size={13} color={theme.textTertiary} />
                    <Text style={[Typography.caption, { color: theme.textSecondary }]} numberOfLines={1}>{doctor.city}</Text>
                  </View>
                ) : null}
                {doctor.fee ? <Text style={[Typography.bodyStrong, { color: theme.text }]}>{doctor.fee}</Text> : null}
              </View>
              <Pressable
                onPress={() => onViewSlots(doctor)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`${t('ai.viewSlots')}, ${name}`}
                style={({ pressed }) => [styles.action, { backgroundColor: pressed ? theme.primaryPressed : theme.buttonPrimary, opacity: disabled ? 0.55 : 1 }]}
              >
                <CalendarDays size={15} color="#FFFFFF" />
                <Text style={styles.actionText}>{t('ai.viewSlots')}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function SlotCards<T extends SlotCardData>({ slots, onSelect }: { slots: T[]; onSelect: (slot: T) => void }) {
  const { theme } = useAppTheme();
  const { t } = useAppLanguage();
  const visible = slots.slice(0, MAX_SLOTS);
  const doctorName = visible[0]?.doctorName;
  return (
    <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
      <View>
        <Text style={[Typography.overline, { color: theme.textTertiary }]}>{t('ai.availableTimes')}</Text>
        {doctorName ? <Text style={[Typography.bodyStrong, { color: theme.text }]} numberOfLines={1}>{doctorName}</Text> : null}
      </View>
      {visible.map((slot) => {
        const time = [slot.startTime, slot.endTime].filter(Boolean).map((value) => formatClock(String(value))).join(' – ');
        return (
          <Pressable
            key={slot.id}
            onPress={() => onSelect(slot)}
            accessibilityRole="button"
            accessibilityLabel={`${dayLabel(slot.date, t)} ${time}`}
            style={({ pressed }) => [styles.slot, { backgroundColor: pressed ? theme.primarySoft : theme.background, borderColor: theme.borderColor }]}
          >
            <View style={[styles.slotIcon, { backgroundColor: theme.primarySoft }]}>
              <Clock size={16} color={theme.primary} />
            </View>
            <View style={styles.flex}>
              <Text style={[Typography.bodyStrong, { color: theme.text }]}>{dayLabel(slot.date, t)}</Text>
              <Text style={[Typography.caption, { color: theme.textSecondary }]}>{time}</Text>
            </View>
            <ChevronRight size={18} color={theme.textTertiary} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  doctorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  ratingText: { fontSize: 12, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, borderRadius: Radius.md, paddingHorizontal: 14 },
  actionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  slot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderRadius: Radius.md, padding: 10 },
  slotIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
