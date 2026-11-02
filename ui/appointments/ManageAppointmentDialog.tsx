import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CalendarClock, CalendarX } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { Radius, Spacing, Typography, elevation } from '../../constants/Design';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAvailableSlots, useCancelAppointment, useRescheduleAppointment } from '../../hooks/useAppointment';
import { formatClock, slotMoment } from '../../src/utils/slotTime';
import type { AppointmentListItem } from './MyAppointmentsList';

export type ManageMode = 'cancel' | 'reschedule';

type Props = {
  item: AppointmentListItem | null;
  mode: ManageMode;
  onClose: () => void;
};

const dayLabel = (date: string) => {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

export default function ManageAppointmentDialog({ item, mode, onClose }: Props) {
  const { theme } = useAppTheme();
  const { t } = useAppLanguage();
  const [selectedSlotId, setSelectedSlotId] = React.useState<string | null>(null);
  const isReschedule = mode === 'reschedule';
  const slotsQuery = useAvailableSlots(isReschedule && item ? item.doctorId : '');
  const cancelMutation = useCancelAppointment();
  const rescheduleMutation = useRescheduleAppointment();
  const isBusy = cancelMutation.isPending || rescheduleMutation.isPending;

  React.useEffect(() => setSelectedSlotId(null), [item?.id, mode]);

  // Slots that start within 2 hours are hidden: the same 2 hour rule protects the doctor's day on both ends.
  const slots = React.useMemo(() => {
    const earliest = Date.now() + 2 * 60 * 60 * 1000;
    return (slotsQuery.data || []).filter((slot: any) => slotMoment(slot.date, slot.startTime) >= earliest);
  }, [slotsQuery.data]);

  const showError = (error: any) => {
    const message: Record<string, string> = {
      too_late: t('manage.errTooLate'),
      already_started: t('manage.errStarted'),
      not_active: t('manage.errNotActive'),
      slot_unavailable: t('manage.errSlotGone'),
      slot_on_hold: t('manage.errSlotGone'),
    };
    Toast.show({ type: 'error', text1: t('manage.errorTitle'), text2: message[error?.code] || t('manage.errGeneric') });
  };

  const confirm = () => {
    if (!item || isBusy) return;
    if (isReschedule) {
      if (!selectedSlotId) return;
      rescheduleMutation.mutate(
        { appointmentId: item.id, slotId: selectedSlotId, doctorId: item.doctorId },
        {
          onSuccess: () => {
            Toast.show({ type: 'success', text1: t('manage.rescheduled'), text2: t('manage.rescheduledBody') });
            onClose();
          },
          onError: showError,
        }
      );
      return;
    }
    cancelMutation.mutate(
      { appointmentId: item.id, doctorId: item.doctorId },
      {
        onSuccess: (result) => {
          Toast.show({
            type: 'success',
            text1: t('manage.cancelled'),
            text2: result?.refund === 'pending' ? t('manage.refundPending') : result?.refund === 'started' ? t('manage.refundStarted') : undefined,
          });
          onClose();
        },
        onError: showError,
      }
    );
  };

  const when = item?.date ? `${dayLabel(item.date)}, ${formatClock(item.startTime || '')}` : '';
  const canConfirm = !isBusy && (!isReschedule || Boolean(selectedSlotId));
  const Icon = isReschedule ? CalendarClock : CalendarX;
  const tone = isReschedule ? { fg: theme.primary, bg: theme.primarySoft } : { fg: theme.danger, bg: theme.dangerSoft };

  return (
    <Modal visible={Boolean(item)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={isBusy ? undefined : onClose} accessibilityLabel={t('manage.close')} />
        <View style={[styles.dialog, { backgroundColor: theme.cardBackground }, elevation(3)]}>
          <View style={[styles.icon, { backgroundColor: tone.bg }]}>
            <Icon size={24} color={tone.fg} />
          </View>
          <Text style={[Typography.heading, styles.center, { color: theme.text }]}>
            {isReschedule ? t('manage.rescheduleTitle') : t('manage.cancelTitle')}
          </Text>
          <Text style={[Typography.body, styles.center, { color: theme.textSecondary }]}>
            {isReschedule
              ? t('manage.rescheduleBody', { doctor: item?.doctorName })
              : t('manage.cancelBody', { doctor: item?.doctorName, when })}
          </Text>

          {isReschedule ? (
            slotsQuery.isLoading ? (
              <ActivityIndicator color={theme.primary} style={styles.loader} />
            ) : slots.length === 0 ? (
              <Text style={[Typography.body, styles.center, { color: theme.textSecondary }]}>{t('manage.noOtherSlots')}</Text>
            ) : (
              <ScrollView style={styles.slotList} contentContainerStyle={styles.slotListContent} showsVerticalScrollIndicator={false}>
                {slots.map((slot: any) => {
                  const id = slot._id || slot.id;
                  const active = selectedSlotId === id;
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setSelectedSlotId(id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      style={[styles.slot, { borderColor: active ? theme.primary : theme.borderColor, backgroundColor: active ? theme.primarySoft : theme.cardBackground }]}
                    >
                      <Text style={[Typography.bodyStrong, { color: theme.text }]}>{dayLabel(slot.date)}</Text>
                      <Text style={[Typography.body, { color: theme.textSecondary }]}>{formatClock(slot.startTime)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )
          ) : null}

          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              disabled={isBusy}
              accessibilityRole="button"
              style={[styles.action, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
            >
              <Text style={[Typography.label, { color: theme.text }]}>{isReschedule ? t('manage.close') : t('manage.keepBooking')}</Text>
            </Pressable>
            <Pressable
              onPress={confirm}
              disabled={!canConfirm}
              accessibilityRole="button"
              style={[styles.action, { borderColor: 'transparent', backgroundColor: isReschedule ? theme.buttonPrimary : theme.danger, opacity: canConfirm ? 1 : 0.5 }]}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={[Typography.label, styles.actionPrimaryText]} numberOfLines={1} adjustsFontSizeToFit>
                  {isReschedule ? t('manage.confirmReschedule') : t('manage.confirmCancel')}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  dialog: { width: '100%', maxWidth: 420, borderRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.md },
  icon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  center: { textAlign: 'center' },
  loader: { paddingVertical: Spacing.lg },
  slotList: { maxHeight: 260 },
  slotListContent: { gap: Spacing.sm },
  slot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 48 },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  action: { flex: 1, height: 46, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.sm },
  actionPrimaryText: { color: '#FFFFFF' },
});
