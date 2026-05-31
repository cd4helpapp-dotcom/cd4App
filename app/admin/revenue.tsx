import React from 'react';
import { ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAdminRevenue } from '../../hooks/useAdmin';
import Colors from '../../constants/Colors';

export default function AdminRevenueScreen() {
  const { data } = useAdminRevenue();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>Revenue</Text>
        <Text style={[styles.metric, { color: theme.textSecondary }]}>Appointment Gross: ₹{Math.round(data?.appointmentGross || 0)}</Text>
        <Text style={[styles.metric, { color: theme.textSecondary }]}>Doctor Payout (70%): ₹{Math.round(data?.doctorPayout || 0)}</Text>
        <Text style={[styles.metric, { color: theme.textSecondary }]}>Platform Commission (30%): ₹{Math.round(data?.platformCommission || 0)}</Text>
        <Text style={[styles.metric, { color: theme.textSecondary }]}>Subscription Revenue: ₹{Math.round(data?.subscriptionRevenue || 0)}</Text>
        <Text style={[styles.metric, { color: theme.textSecondary }]}>Total Platform Revenue: ₹{Math.round(data?.totalRevenue || 0)}</Text>

        <Text style={[styles.subtitle, { color: theme.text }]}>Doctor-wise Revenue</Text>
        {(data?.doctorRevenue || []).map((item) => (
          <View key={item.doctorId} style={[styles.row, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
            <Text style={[styles.doctor, { color: theme.tint }]}>{item.doctorId}</Text>
            <Text style={[styles.values, { color: theme.textSecondary }]}>Gross ₹{Math.round(item.gross)} | Payout ₹{Math.round(item.payout)} | Comm ₹{Math.round(item.commission)}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, gap: 8 },
  title: { fontSize: 24, fontWeight: '800' },
  subtitle: { fontSize: 16, fontWeight: '700', marginTop: 12 },
  metric: { fontSize: 14, fontWeight: '600' },
  row: { borderWidth: 1, borderRadius: 10, padding: 10 },
  doctor: { fontWeight: '700', fontSize: 12 },
  values: { fontSize: 12, marginTop: 4 },
});
