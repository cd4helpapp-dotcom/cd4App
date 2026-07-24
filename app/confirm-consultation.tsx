import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarDays, ChevronLeft, CreditCard, MapPin, ShieldCheck, Stethoscope } from 'lucide-react-native';
import Colors from '../constants/Colors';
import { useThemePreference } from '../context/ThemePreferenceContext';
import { supabase } from '../src/lib/supabase';
import { openRazorpayCheckout } from '../services/razorpay';
import { useAuthContext } from '../context/AuthContext';
import { useBookAppointment } from '../hooks/useAppointment';
import { syncAppointmentWithDeviceCalendar } from '../services/appointmentCalendar';

type QuoteSnapshot = {
  orderId: string;
  amountPaise: number;
  grossAmount: number;
  currency: string;
};

const parseAmountInr = (value: string): number => {
  const numeric = Number(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 500;
};

const showUiAlert = (title: string, message: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${title}\n${message}`);
    return;
  }
  Alert.alert(title, message);
};

export default function ConfirmConsultationScreen() {
  const router = useRouter();
  const { resolvedColorScheme } = useThemePreference();
  const theme = Colors[resolvedColorScheme ?? 'light'];
  const { user, session } = useAuthContext();
  const bookAppointmentMutation = useBookAppointment();
  const params = useLocalSearchParams<{
    doctorId?: string;
    slotId?: string;
    doctorName?: string;
    doctorSpecialization?: string;
    doctorCity?: string;
    doctorFee?: string;
    concern?: string;
    slotDate?: string;
    slotStartTime?: string;
    slotEndTime?: string;
    reportId?: string;
    conversationId?: string;
  }>();

  const doctorId = String(params.doctorId || '').trim();
  const slotId = String(params.slotId || '').trim();
  const doctorName = String(params.doctorName || 'Best Available Specialist').trim();
  const doctorSpecialization = String(params.doctorSpecialization || 'General Physician').trim();
  const doctorCity = String(params.doctorCity || '').trim();
  const concern = String(params.concern || '').trim();
  const slotDateRaw = String(params.slotDate || '').trim();
  const slotStartTime = String(params.slotStartTime || '').trim();
  const slotEndTime = String(params.slotEndTime || '').trim();
  const reportId = String(params.reportId || '').trim();
  const conversationId = String(params.conversationId || '').trim();
  const fallbackGrossAmount = parseAmountInr(String(params.doctorFee || '500'));

  const parsedSlotDate = React.useMemo(() => {
    if (!slotDateRaw) return null;
    const date = new Date(slotDateRaw);
    return Number.isFinite(date.getTime()) ? date : null;
  }, [slotDateRaw]);

  const slotDateLabel = parsedSlotDate
    ? parsedSlotDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
    : 'Selected date';

  const [quote, setQuote] = React.useState<QuoteSnapshot | null>(null);
  const [isPreparing, setIsPreparing] = React.useState(true);
  const [isPaying, setIsPaying] = React.useState(false);
  const quoteRequestRef = React.useRef<{ key: string; promise: Promise<void> } | null>(null);

  const loadQuote = React.useCallback(async () => {
    if (!doctorId || !slotId) {
      showUiAlert('Booking failed', 'Doctor or slot details missing. Please select slot again.');
      router.replace('/(tabs)/appointments');
      return;
    }

    const requestKey = `${doctorId}:${slotId}:${session?.access_token || 'no-session'}`;
    const existingRequest = quoteRequestRef.current;
    if (existingRequest?.key === requestKey) {
      await existingRequest.promise;
      return;
    }

    setIsPreparing(true);
    const request = (async () => {
      if (!session?.access_token) {
        throw new Error('Authentication session missing. Please login again and retry booking.');
      }
      supabase.functions.setAuth(session.access_token);
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Payment setup timed out. Please retry.')), 15000);
      });
      const requestResult = await Promise.race([
        supabase.functions.invoke('manage-appointment-payment', {
          body: { action: 'create_order', doctorId, slotId },
        }),
        timeout,
      ]);
      const { data, error } = requestResult;

      if (error || data?.success === false) {
        throw new Error(data?.message || error?.message || 'Could not prepare payment order.');
      }

      const amountPaise = Number(data?.amountPaise || fallbackGrossAmount * 100);
      const grossAmount = Number(data?.payment?.gross_amount || amountPaise / 100 || fallbackGrossAmount);
      const orderId = String(data?.payment?.order_id || '').trim();

      if (!orderId || !Number.isFinite(amountPaise) || amountPaise <= 0) {
        throw new Error('Invalid payment order from server.');
      }

      setQuote({
        orderId,
        amountPaise: Math.round(amountPaise),
        grossAmount,
        currency: String(data?.payment?.currency || 'INR'),
      });
    })();

    quoteRequestRef.current = { key: requestKey, promise: request };
    try {
      await request;
    } catch (error: any) {
      showUiAlert('Payment setup failed', error?.message || 'Could not prepare payment right now.');
      router.replace('/(tabs)/appointments');
    } finally {
      if (quoteRequestRef.current?.key === requestKey) {
        quoteRequestRef.current = null;
      }
      setIsPreparing(false);
    }
  }, [doctorId, fallbackGrossAmount, router, session?.access_token, slotId]);

  React.useEffect(() => {
    void loadQuote();
  }, [loadQuote]);

  const handlePay = async () => {
    if (!quote) {
      showUiAlert('Please wait', 'Payment details are still loading.');
      return;
    }
    if (!user?.id) {
      showUiAlert('Login required', 'Please login again and retry booking.');
      router.replace('/auth/login');
      return;
    }

    setIsPaying(true);
    try {
      const paymentResult = await openRazorpayCheckout({
        description: 'Consultation Fee',
        amountPaise: quote.amountPaise,
        orderId: quote.orderId,
        prefill: {
          name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
          email: user?.email || '',
          contact: user?.phoneNumber || '',
        },
      });

      const appointment = await bookAppointmentMutation.mutateAsync({
        doctorId,
        slotId,
        orderId: String(paymentResult?.razorpay_order_id || quote.orderId || ''),
        paymentId: String(paymentResult?.razorpay_payment_id || ''),
        signature: String(paymentResult?.razorpay_signature || ''),
        aiReportId: reportId || undefined,
        concern: concern || undefined,
        conversationId: conversationId || undefined,
      });

      if (user?.id && parsedSlotDate && slotStartTime) {
        void syncAppointmentWithDeviceCalendar({
          syncKey: `patient:${user.id}`,
          appointmentId: appointment?.id || `${doctorId}:${slotId}`,
          title: `Consultation with ${doctorName}`,
          date: parsedSlotDate.toISOString(),
          startTime: slotStartTime,
          endTime: slotEndTime || slotStartTime,
          notes: `CD4 consultation with ${doctorName}`,
          reminderMinutes: 30,
        });
      }

      router.replace({
        pathname: '/payment-success',
        params: {
          amount: String(Math.round(quote.grossAmount)),
          paymentId: paymentResult.razorpay_payment_id,
          appointmentId: appointment?.id || '',
          doctorName,
          date: slotDateLabel,
          time: slotEndTime ? `${slotStartTime} - ${slotEndTime}` : slotStartTime,
        },
      });
    } catch (error: any) {
      showUiAlert('Payment failed', error?.message || 'Could not complete payment.');
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <ChevronLeft size={18} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Confirm Consultation</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={[styles.summaryCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Booking Summary</Text>
          <View style={styles.identityRow}>
            <View style={[styles.identityIcon, { backgroundColor: theme.successLight }]}>
              <Stethoscope size={18} color={theme.tint} />
            </View>
            <View style={styles.identityText}>
              <Text style={[styles.doctorName, { color: theme.text }]} numberOfLines={2}>{doctorName}</Text>
              <Text style={[styles.doctorMeta, { color: theme.textSecondary }]} numberOfLines={1}>{doctorSpecialization}</Text>
            </View>
            <ShieldCheck size={17} color={theme.tint} />
          </View>

          <View style={styles.metaRow}>
            <MapPin size={14} color={theme.textSecondary} />
            <Text style={[styles.metaText, { color: theme.textSecondary }]} numberOfLines={1}>
              {doctorCity || 'City unavailable'}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <CalendarDays size={14} color={theme.textSecondary} />
            <Text style={[styles.metaText, { color: theme.textSecondary }]} numberOfLines={1}>
              {slotDateLabel} • {slotEndTime ? `${slotStartTime} - ${slotEndTime}` : slotStartTime}
            </Text>
          </View>
          {!!concern && (
            <Text style={[styles.concernText, { color: theme.textSecondary }]}>Concern: {concern}</Text>
          )}
        </View>

        <View style={[styles.paymentCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Payment Details</Text>
          {isPreparing || !quote ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={theme.tint} />
              <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Preparing payment details...</Text>
            </View>
          ) : (
            <>
              <View style={styles.lineRow}>
                <Text style={[styles.totalLabel, { color: theme.text }]}>Amount to Pay</Text>
                <Text style={[styles.totalValue, { color: theme.text }]}>₹{Math.round(quote.grossAmount)}</Text>
              </View>
              <Text style={[styles.paymentNote, { color: theme.textSecondary }]}>
                You will be charged only this amount.
              </Text>
            </>
          )}
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
        <TouchableOpacity
          style={[styles.payButton, { backgroundColor: theme.tint, opacity: !quote || isPreparing || isPaying ? 0.8 : 1 }]}
          onPress={() => {
            void handlePay();
          }}
          disabled={!quote || isPreparing || isPaying}
          activeOpacity={0.88}
        >
          {isPaying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <CreditCard size={18} color="#fff" />
              <Text style={styles.payButtonText}>
                Pay ₹{Math.round(quote?.grossAmount || fallbackGrossAmount)} & Confirm Booking
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 120,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  headerSpacer: {
    width: 36,
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 9,
  },
  paymentCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.25,
    textTransform: 'uppercase',
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  identityIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  doctorName: {
    fontSize: 15,
    fontWeight: '800',
  },
  doctorMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    fontWeight: '500',
  },
  concernText: {
    marginTop: 2,
    fontSize: 12.5,
    fontWeight: '500',
  },
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lineLabel: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  lineValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  divider: {
    borderTopWidth: 1,
    marginTop: 4,
    paddingTop: 6,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  paymentNote: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '500',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    borderTopWidth: 1,
  },
  payButton: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  payButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});
