import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';
import * as Notifications from 'expo-notifications';

const APPOINTMENT_CALENDAR_SYNC_PREFIX = '@cd4/appointment_calendar_sync';
const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;
const DEFAULT_REMINDER_MINUTES = 30;
const APPOINTMENT_NOTIFICATION_CHANNEL_ID = 'appointments';

type StoredAppointmentSyncRecord = {
  calendarEventId?: string;
  notificationId?: string;
  startsAtIso: string;
};

export type AppointmentCalendarSyncInput = {
  syncKey: string;
  appointmentId: string;
  title: string;
  date: string;
  startTime: string;
  endTime?: string | null;
  notes?: string;
  location?: string;
  reminderMinutes?: number;
};

const parseDateParts = (value: string): { year: number; month: number; day: number } | null => {
  const parts = value.split('-').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [year, month, day] = parts;
  if (!year || !month || !day) return null;
  return { year, month, day };
};

const parseTimeParts = (value: string): { hour: number; minute: number; second: number } | null => {
  const raw = value.trim();
  if (!raw) return null;

  const parts = raw.split(':').map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [hour, minute, second = 0] = parts;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }

  return { hour, minute, second };
};

const buildLocalDateTime = (date: string, time: string): Date | null => {
  const dateParts = parseDateParts(date);
  const timeParts = parseTimeParts(time);
  if (!dateParts || !timeParts) {
    return null;
  }

  const result = new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    timeParts.second,
    0
  );

  if (Number.isNaN(result.getTime())) {
    return null;
  }

  return result;
};

const buildSyncStorageKey = (syncKey: string, appointmentId: string): string =>
  `${APPOINTMENT_CALENDAR_SYNC_PREFIX}:${syncKey}:${appointmentId}`;

const readSyncRecord = async (
  storageKey: string
): Promise<StoredAppointmentSyncRecord | null> => {
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAppointmentSyncRecord;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeSyncRecord = async (storageKey: string, record: StoredAppointmentSyncRecord) => {
  await AsyncStorage.setItem(storageKey, JSON.stringify(record));
};

const removeSyncRecord = async (storageKey: string) => {
  try {
    await AsyncStorage.removeItem(storageKey);
  } catch {
    // Ignore local cleanup errors.
  }
};

const ensureCalendarPermission = async (): Promise<boolean> => {
  const existing = await Calendar.getCalendarPermissionsAsync();
  if (existing.status === 'granted') return true;

  const requested = await Calendar.requestCalendarPermissionsAsync();
  return requested.status === 'granted';
};

const ensureNotificationPermission = async (): Promise<boolean> => {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
};

const ensureAndroidAppointmentChannel = async () => {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(APPOINTMENT_NOTIFICATION_CHANNEL_ID, {
    name: 'Appointments',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF231F7C',
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
    bypassDnd: false,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.NOTIFICATION,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
  });
};

const getWritableCalendarId = async (): Promise<string | null> => {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writableCalendar = calendars.find((calendar) => calendar.allowsModifications);
  if (writableCalendar?.id) {
    return writableCalendar.id;
  }

  // Fallback for Android devices where no writable calendar is surfaced immediately.
  if (Platform.OS === 'android') {
    try {
      const defaultCalendar = await Calendar.getDefaultCalendarAsync();
      if (defaultCalendar?.source) {
        const newCalendarId = await Calendar.createCalendarAsync({
          title: 'CD4 Appointments',
          color: '#2E7D32',
          entityType: Calendar.EntityTypes.EVENT,
          sourceId: defaultCalendar.source.id,
          source: defaultCalendar.source,
          name: 'CD4 Appointments',
          ownerAccount: defaultCalendar.source.name,
          accessLevel: Calendar.CalendarAccessLevel.OWNER,
        });
        return newCalendarId;
      }
    } catch (error) {
      console.warn('Calendar fallback creation failed:', error);
    }
  }

  return null;
};

const cancelExistingNotificationIfAny = async (notificationId?: string) => {
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Ignore stale/cancelled notification ids.
  }
};

const deleteExistingCalendarEventIfAny = async (calendarEventId?: string) => {
  if (!calendarEventId) return;
  try {
    await Calendar.deleteEventAsync(calendarEventId);
  } catch {
    // Ignore stale/deleted event ids.
  }
};

export const clearAppointmentCalendarSync = async (
  input: Pick<AppointmentCalendarSyncInput, 'syncKey' | 'appointmentId'>
): Promise<void> => {
  if (Platform.OS === 'web') {
    return;
  }

  const storageKey = buildSyncStorageKey(input.syncKey, input.appointmentId);
  const existingRecord = await readSyncRecord(storageKey);
  if (!existingRecord) {
    return;
  }

  await cancelExistingNotificationIfAny(existingRecord.notificationId);
  await deleteExistingCalendarEventIfAny(existingRecord.calendarEventId);
  await removeSyncRecord(storageKey);
};

export const syncAppointmentWithDeviceCalendar = async (
  input: AppointmentCalendarSyncInput
): Promise<{ synced: boolean; calendarEventId?: string; notificationId?: string }> => {
  if (Platform.OS === 'web') {
    return { synced: false };
  }

  const reminderMinutes = Number.isFinite(input.reminderMinutes || DEFAULT_REMINDER_MINUTES)
    ? Math.max(1, input.reminderMinutes || DEFAULT_REMINDER_MINUTES)
    : DEFAULT_REMINDER_MINUTES;

  const startDate = buildLocalDateTime(input.date, input.startTime);
  if (!startDate) {
    console.warn('Calendar sync skipped: invalid appointment start time', input.appointmentId);
    return { synced: false };
  }

  const endDate =
    (input.endTime ? buildLocalDateTime(input.date, input.endTime) : null) ||
    new Date(startDate.getTime() + DEFAULT_APPOINTMENT_DURATION_MINUTES * 60 * 1000);

  const storageKey = buildSyncStorageKey(input.syncKey, input.appointmentId);
  const existingRecord = await readSyncRecord(storageKey);
  const startsAtIso = startDate.toISOString();

  if (existingRecord?.startsAtIso === startsAtIso) {
    return {
      synced: false,
      calendarEventId: existingRecord.calendarEventId,
      notificationId: existingRecord.notificationId,
    };
  }

  if (existingRecord) {
    await cancelExistingNotificationIfAny(existingRecord.notificationId);
    await deleteExistingCalendarEventIfAny(existingRecord.calendarEventId);
  }

  let calendarEventId: string | undefined;
  if (await ensureCalendarPermission()) {
    try {
      const calendarId = await getWritableCalendarId();
      if (calendarId) {
        calendarEventId = await Calendar.createEventAsync(calendarId, {
          title: input.title,
          startDate,
          endDate,
          notes: input.notes,
          location: input.location,
          alarms: [{ relativeOffset: -reminderMinutes }],
        });
      }
    } catch (error) {
      console.warn('Failed to create calendar event for appointment:', error);
    }
  }

  let notificationId: string | undefined;
  const reminderAt = new Date(startDate.getTime() - reminderMinutes * 60 * 1000);
  if (reminderAt.getTime() > Date.now() && (await ensureNotificationPermission())) {
    try {
      await ensureAndroidAppointmentChannel();
      notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Appointment Reminder',
          body: `${input.title} starts in ${reminderMinutes} minutes`,
          sound: 'default',
          data: {
            type: 'appointment_reminder',
            appointmentId: input.appointmentId,
          },
          ...(Platform.OS === 'android'
            ? ({ channelId: APPOINTMENT_NOTIFICATION_CHANNEL_ID } as any)
            : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminderAt,
        },
      });
    } catch (error) {
      console.warn('Failed to schedule appointment reminder notification:', error);
    }
  }

  await writeSyncRecord(storageKey, {
    calendarEventId,
    notificationId,
    startsAtIso,
  });

  return {
    synced: true,
    calendarEventId,
    notificationId,
  };
};
