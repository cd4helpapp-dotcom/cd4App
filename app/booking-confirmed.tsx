import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarCheck2 } from 'lucide-react-native';
import Colors from '../constants/Colors';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';

export default function BookingConfirmedScreen() {
  const router = useRouter();
  const { user } = useAuthContext();
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

  React.useEffect(() => {
    let active = true;
    const validate = async () => {
      const appointmentId = String(params.appointmentId || '').trim();
      const paymentId = String(params.paymentId || '').trim();
      if (!appointmentId || !paymentId || !user?.id) {
        if (active) {
          setIsValid(false);
          setIsValidating(false);
          router.replace('/(tabs)/appointments');
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
        router.replace('/(tabs)/appointments');
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      {isValidating ? (
        <ActivityIndicator color={theme.tint} />
      ) : !isValid ? null : (
      <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <CalendarCheck2 size={54} color={theme.tint} />
        <Text style={[styles.title, { color: theme.text }]}>Booking Confirmed</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{params.doctorName || 'Doctor'} consultation is confirmed.</Text>

        <View style={[styles.infoBox, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}>
          <Text style={[styles.infoText, { color: theme.text }]}>Date: {params.date || '-'}</Text>
          <Text style={[styles.infoText, { color: theme.text }]}>Time: {params.time || '-'}</Text>
          <Text style={[styles.infoText, { color: theme.text }]}>Amount Paid: ₹{params.amount || '500'}</Text>
          <Text style={[styles.infoText, { color: theme.textSecondary }]}>Appointment ID: {params.appointmentId || 'N/A'}</Text>
          <Text style={[styles.infoText, { color: theme.textSecondary }]}>Payment ID: {params.paymentId || 'N/A'}</Text>
        </View>

        <TouchableOpacity style={[styles.button, { backgroundColor: theme.buttonPrimary }]} onPress={() => router.replace('/(tabs)/appointments')}>
          <Text style={[styles.buttonText, { color: theme.buttonText }]}>Go To Appointments</Text>
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
