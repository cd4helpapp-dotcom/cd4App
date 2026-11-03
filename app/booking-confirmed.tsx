import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarCheck2 } from 'lucide-react-native';
import Colors from '../constants/Colors';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';
import { useAppLanguage } from '../context/AppLanguageContext';
import { shareAppointmentOnWhatsApp } from '../src/utils/whatsapp';

export default function BookingConfirmedScreen() {
  const router = useRouter();
  const { user } = useAuthContext();
  const { t } = useAppLanguage();
  const params = useLocalSearchParams<{
    appointmentId?: string;
    doctorName?: string;
    date?: string;
    time?: string;
    paymentId?: string;
    amount?: string;
  }>();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const [isValidating, setIsValidating] = React.useState(true);
  const [isValid, setIsValid] = React.useState(false);
  const autoSentRef = React.useRef(false);

  React.useEffect(() => {
    let active = true;
    const validate = async () => {
      const appointmentId = String(params.appointmentId || '').trim();
      const paymentId = String(params.paymentId || '').trim();
      if (!appointmentId || !paymentId || !user?.id) {
        if (active) {
          setIsValid(false);
          setIsValidating(false);
          router.replace({ pathname: '/(tabs)/appointments', params: { tab: 'mine' } });
        }
        return;
      }

      const { data, error } = await supabase
        .from('appointment_payments')
        .select('id, status')
        .eq('appointment_id', appointmentId)
        .eq('payment_id', paymentId)
        .eq('patient_id', user.id)
        .eq('status', 'paid')
        .maybeSingle();

      if (!active) return;
      if (error || !data?.id) {
        setIsValid(false);
        setIsValidating(false);
        router.replace({ pathname: '/(tabs)/appointments', params: { tab: 'mine' } });
        return;
      }
      setIsValid(true);
      setIsValidating(false);
    };
    void validate();
    return () => {
      active = false;
    };
  }, [params.appointmentId, params.paymentId, router, user?.id]);

  // Automatically trigger WhatsApp slip delivery on confirmation without requiring user to hunt for a button
  React.useEffect(() => {
    if (isValid && !autoSentRef.current) {
      autoSentRef.current = true;
      const timer = setTimeout(() => {
        void shareAppointmentOnWhatsApp({
          doctorName: params.doctorName,
          date: params.date,
          time: params.time,
          amount: params.amount,
          appointmentId: params.appointmentId,
          paymentId: params.paymentId,
          targetPhone: user?.phoneNumber,
        });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isValid, params.doctorName, params.date, params.time, params.amount, params.appointmentId, params.paymentId, user?.phoneNumber]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      {isValidating ? (
        <ActivityIndicator color={theme.tint} />
      ) : !isValid ? null : (
      <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <CalendarCheck2 size={54} color={theme.tint} />
        <Text style={[styles.title, { color: theme.text }]}>{t('payment.bookedTitle')}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{t('payment.bookedBody', { doctor: params.doctorName || t('payment.doctorFallback') })}</Text>

        <View style={[styles.infoBox, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
          <Text style={[styles.infoText, { color: theme.text }]}>{t('payment.dateLine', { date: params.date || '-' })}</Text>
          <Text style={[styles.infoText, { color: theme.text }]}>{t('payment.timeLine', { time: params.time || '-' })}</Text>
          <Text style={[styles.infoText, { color: theme.text }]}>{t('payment.amountPaid', { amount: params.amount || '500' })}</Text>
          <Text style={[styles.infoText, { color: theme.textSecondary }]}>{t('payment.appointmentId', { id: params.appointmentId || 'N/A' })}</Text>
          <Text style={[styles.infoText, { color: theme.textSecondary }]}>{t('payment.paymentId', { id: params.paymentId || 'N/A' })}</Text>
        </View>

        <TouchableOpacity style={[styles.button, { backgroundColor: theme.buttonPrimary }]} onPress={() => router.replace({ pathname: '/(tabs)/appointments', params: { tab: 'mine' } })}>
          <Text style={[styles.buttonText, { color: theme.buttonText }]}>{t('payment.goToAppointments')}</Text>
        </TouchableOpacity>
      </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: 16, padding: 18, alignItems: 'center' },
  title: { marginTop: 10, fontSize: 22, fontWeight: '800' },
  subtitle: { marginTop: 8, fontSize: 13, textAlign: 'center' },
  infoBox: { marginTop: 14, width: '100%', borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  infoText: { fontSize: 12, fontWeight: '600' },
  button: { marginTop: 18, minHeight: 46, borderRadius: 12, width: '100%', alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '800' },
});
