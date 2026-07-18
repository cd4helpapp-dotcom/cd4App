import React from 'react';
import { ActivityIndicator, Alert, Dimensions, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAdminRevenue, useSettleDoctorPayout } from '../../hooks/useAdmin';
import Colors from '../../constants/Colors';
import { BarChart, LineChart } from 'react-native-chart-kit';

const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;
const chartWidth = Math.max(280, Math.min(420, Dimensions.get('window').width - 48));

export default function AdminRevenueScreen() {
  const router = useRouter();
  const { data, isLoading, isRefetching, refetch } = useAdminRevenue();
  const settle = useSettleDoctorPayout();
  const doctorRows = React.useMemo(() => [...(data?.doctorRevenue || [])].sort((a, b) => new Date(b.lastPaymentAt || 0).getTime() - new Date(a.lastPaymentAt || 0).getTime()), [data?.doctorRevenue]);
  const theme = Colors[useColorScheme() ?? 'light'];

  const settleDoctor = (doctorId: string, doctorName: string, pending: number) => {
    Alert.alert('Settle doctor payout', `${doctorName} will receive ${money(pending)}. Continue?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark paid', onPress: () => settle.mutate({ doctorId },) },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}>
        <View style={styles.header}><View><Text style={[styles.title, { color: theme.text }]}>Revenue</Text><Text style={[styles.sub, { color: theme.textSecondary }]}>Complete payment ledger and doctor settlements</Text></View><Ionicons name="analytics" size={28} color={theme.tint} /></View>
        {isLoading ? <ActivityIndicator color={theme.tint} /> : <>
          <View style={styles.grid}>
            {[
              ['Total collected', (data?.appointmentGross || 0) + (data?.subscriptionRevenue || 0), 'cash-outline'],
              ['Subscriptions', data?.subscriptionRevenue || 0, 'card-outline'],
              ['Doctor fees', data?.doctorPayout || 0, 'wallet-outline'],
              ['Platform commission', data?.platformCommission || 0, 'business-outline'],
            ].map(([label, value, icon]) => <View key={String(label)} style={[styles.metric, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}><Ionicons name={icon as any} size={18} color={theme.tint} /><Text style={[styles.metricLabel, { color: theme.textSecondary }]}>{label}</Text><Text style={[styles.metricValue, { color: theme.text }]}>{money(Number(value))}</Text></View>)}
          </View>
          <View style={[styles.netCard, { backgroundColor: theme.successLight, borderColor: theme.successBorder }]}><Text style={[styles.netLabel, { color: theme.textSecondary }]}>Net platform revenue</Text><Text style={[styles.netValue, { color: theme.tint }]}>{money(data?.totalRevenue || 0)}</Text><Text style={[styles.netHint, { color: theme.textSecondary }]}>Commission + subscription receipts − refunds</Text></View>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Revenue trend — last 6 months</Text>
          <View style={[styles.chartCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <LineChart
              data={{ labels: (data?.monthlyTrend || []).map((item) => item.label), datasets: [{ data: (data?.monthlyTrend || []).map((item) => item.platform) }] }}
              width={chartWidth} height={210} yAxisLabel="₹" yAxisSuffix="" fromZero
              chartConfig={{ backgroundGradientFrom: theme.cardBackground, backgroundGradientTo: theme.cardBackground, decimalPlaces: 0, color: (opacity = 1) => `rgba(46, 204, 113, ${opacity})`, labelColor: () => theme.textSecondary, propsForDots: { r: '4', strokeWidth: '2', stroke: theme.tint } }}
              bezier style={styles.chart}
            />
            <Text style={[styles.chartLegend, { color: theme.textSecondary }]}>Platform revenue = commission + subscriptions</Text>
          </View>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Doctor payout trend</Text>
          <View style={[styles.chartCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <BarChart
              data={{ labels: (data?.monthlyTrend || []).map((item) => item.label), datasets: [{ data: (data?.monthlyTrend || []).map((item) => item.doctorPayout) }] }}
              width={chartWidth} height={210} yAxisLabel="₹" yAxisSuffix="" fromZero showValuesOnTopOfBars
              chartConfig={{ backgroundGradientFrom: theme.cardBackground, backgroundGradientTo: theme.cardBackground, decimalPlaces: 0, color: (opacity = 1) => `rgba(67, 159, 255, ${opacity})`, labelColor: () => theme.textSecondary, barPercentage: 0.6 }}
              style={styles.chart}
            />
            <Text style={[styles.chartLegend, { color: theme.textSecondary }]}>Total doctor share generated from paid consultations</Text>
          </View>
          <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.text, marginTop: 24, marginBottom: 10 }]}>Doctor payout management</Text><TouchableOpacity onPress={() => router.push('/admin/doctor-revenue')}><Text style={[styles.viewAllText, { color: theme.tint }]}>View all ({doctorRows.length})</Text></TouchableOpacity></View>
          {doctorRows.length === 0 ? <View style={[styles.emptyCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}><Text style={[styles.detail, { color: theme.textSecondary }]}>No paid doctor consultations yet.</Text></View> : doctorRows.slice(0, 5).map((item) => <View key={item.doctorId} style={[styles.doctorCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}><View style={styles.doctorTop}><Text style={[styles.doctorName, { color: theme.text }]}>{item.doctorName}</Text><Text style={[styles.doctorAmount, { color: theme.tint }]}>{money(item.payout)} total</Text></View><Text style={[styles.detail, { color: theme.textSecondary }]}>Patient payments {money(item.gross)}  •  Platform commission {money(item.commission)}</Text><Text style={[styles.detail, { color: theme.textSecondary }]}>Settled {money(item.settledPayout)}  •  Pending {money(item.pendingPayout)}</Text>{item.pendingPayout > 0 ? <TouchableOpacity style={[styles.button, { backgroundColor: theme.tint }]} onPress={() => settleDoctor(item.doctorId, item.doctorName, item.pendingPayout)} disabled={settle.isPending}><Text style={styles.buttonText}>{settle.isPending ? 'Processing…' : `Mark ${money(item.pendingPayout)} paid`}</Text></TouchableOpacity> : <Text style={[styles.paid, { color: theme.tint }]}>✓ Fully settled</Text>}</View>)}
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Payout audit trail</Text>
          {(data?.payoutHistory || []).slice(0, 20).map((payout) => <View key={payout.id} style={[styles.auditRow, { borderBottomColor: theme.borderColor }]}><View><Text style={[styles.auditTitle, { color: theme.text }]}>{money(payout.amount)} • {payout.status}</Text><Text style={[styles.detail, { color: theme.textSecondary }]}>{new Date(payout.createdAt).toLocaleDateString('en-IN')}{payout.reference ? ` • Ref ${payout.reference}` : ''}</Text></View><Ionicons name={payout.status === 'paid' ? 'checkmark-circle' : 'time-outline'} size={19} color={theme.tint} /></View>)}
        </>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1 }, content: { padding: 16, paddingBottom: 36 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }, title: { fontSize: 26, fontWeight: '800' }, sub: { fontSize: 12, marginTop: 3 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metric: { width: '48%', minHeight: 112, borderWidth: 1, borderRadius: 14, padding: 12 }, metricLabel: { fontSize: 11, marginTop: 10 }, metricValue: { fontSize: 18, fontWeight: '800', marginTop: 4 }, netCard: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 12 }, netLabel: { fontSize: 12 }, netValue: { fontSize: 28, fontWeight: '900', marginTop: 3 }, netHint: { fontSize: 11, marginTop: 4 }, sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { fontSize: 17, fontWeight: '800', marginTop: 24, marginBottom: 10 }, chartCard: { borderWidth: 1, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 4 }, chart: { borderRadius: 12 }, chartLegend: { fontSize: 11, marginHorizontal: 10, marginBottom: 8 }, doctorCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 }, emptyCard: { borderWidth: 1, borderRadius: 14, padding: 14 }, doctorTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, doctorName: { fontSize: 15, fontWeight: '800', flex: 1 }, doctorAmount: { fontSize: 14, fontWeight: '800' }, detail: { fontSize: 12, marginTop: 6 }, button: { alignItems: 'center', borderRadius: 9, marginTop: 12, paddingVertical: 10 }, buttonText: { color: '#fff', fontWeight: '800', fontSize: 13 }, paid: { fontSize: 12, fontWeight: '800', marginTop: 12 }, viewAllText: { fontSize: 13, fontWeight: '800' }, auditRow: { borderBottomWidth: 1, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, auditTitle: { fontSize: 13, fontWeight: '700' },
});
