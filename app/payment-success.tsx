import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import Colors from '../constants/Colors';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const { user } = useAuthContext();
  const params = useLocalSearchParams<{
    amount?: string;
    paymentId?: string;
    appointmentId?: string;
    doctorName?: string;
    date?: string;
    time?: string;
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

  const continueToBooking = () => {
    router.replace({
      pathname: '/booking-confirmed',
      params: {
        appointmentId: params.appointmentId || '',
        doctorName: params.doctorName || '',
        date: params.date || '',
        time: params.time || '',
        paymentId: params.paymentId || '',
        amount: params.amount || '500',
      },
    });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      {isValidating ? (
        <ActivityIndicator color={theme.tint} />
      ) : !isValid ? null : (
      <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
        <CheckCircle2 size={54} color={theme.success} />
        <Text style={[styles.title, { color: theme.text }]}>Payment Successful</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Your payment has been received securely.</Text>
        <Text style={[styles.meta, { color: theme.textSecondary }]}>Amount: ₹{params.amount || '500'}</Text>
        <Text style={[styles.meta, { color: theme.textSecondary }]}>Payment ID: {params.paymentId || 'N/A'}</Text>

        <TouchableOpacity style={[styles.button, { backgroundColor: theme.buttonPrimary }]} onPress={continueToBooking}>
          <Text style={[styles.buttonText, { color: theme.buttonText }]}>Continue</Text>
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
  meta: { marginTop: 8, fontSize: 12, fontWeight: '600' },
  button: { marginTop: 18, minHeight: 46, borderRadius: 12, width: '100%', alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '800' },
});
