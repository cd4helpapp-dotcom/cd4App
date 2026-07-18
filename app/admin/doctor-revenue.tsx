import React from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Colors from '../../constants/Colors';
import { useAdminRevenue, useSettleDoctorPayout } from '../../hooks/useAdmin';

const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

export default function AdminDoctorRevenueScreen() {
  const router = useRouter();
  const theme = Colors[useColorScheme() ?? 'light'];
  const { data, isLoading, isRefetching, refetch } = useAdminRevenue();
  const settle = useSettleDoctorPayout();
  const doctors = React.useMemo(() => [...(data?.doctorRevenue || [])].sort((a, b) => new Date(b.lastPaymentAt || 0).getTime() - new Date(a.lastPaymentAt || 0).getTime()), [data?.doctorRevenue]);
  const settleDoctor = (doctorId: string, doctorName: string, pending: number) => Alert.alert('Settle doctor payout', `${doctorName} will receive ${money(pending)}. Continue?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Mark paid', onPress: () => settle.mutate({ doctorId }) }]);
  const goBackOneStep = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/admin/revenue');
  };
  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}>
    <View style={styles.header}><TouchableOpacity onPress={goBackOneStep} hitSlop={10}><Ionicons name="arrow-back" size={22} color={theme.text} /></TouchableOpacity><View style={styles.headerCopy}><Text style={[styles.title, { color: theme.text }]}>All Doctor Revenue</Text><Text style={[styles.subtitle, { color: theme.textSecondary }]}>Complete doctor-wise payment and payout list</Text></View></View>
    {isLoading ? <ActivityIndicator color={theme.tint} /> : doctors.length === 0 ? <View style={[styles.empty, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}><Text style={[styles.detail, { color: theme.textSecondary }]}>No paid doctor consultations yet.</Text></View> : doctors.map((item) => <View key={item.doctorId} style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}><View style={styles.top}><View style={styles.nameWrap}><View style={[styles.avatar, { backgroundColor: theme.successLight }]}><Text style={[styles.avatarText, { color: theme.tint }]}>{item.doctorName.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</Text></View><Text style={[styles.name, { color: theme.text }]}>{item.doctorName}</Text></View><Text style={[styles.total, { color: theme.tint }]}>{money(item.payout)}</Text></View><Text style={[styles.detail, { color: theme.textSecondary }]}>Patient payments: {money(item.gross)}</Text><Text style={[styles.detail, { color: theme.textSecondary }]}>Platform commission: {money(item.commission)}</Text><Text style={[styles.detail, { color: theme.textSecondary }]}>Settled: {money(item.settledPayout)}  •  Pending: {money(item.pendingPayout)}</Text>{item.pendingPayout > 0 ? <TouchableOpacity style={[styles.button, { backgroundColor: theme.tint }]} onPress={() => settleDoctor(item.doctorId, item.doctorName, item.pendingPayout)} disabled={settle.isPending}><Text style={styles.buttonText}>{settle.isPending ? 'Processing…' : `Mark ${money(item.pendingPayout)} paid`}</Text></TouchableOpacity> : <Text style={[styles.paid, { color: theme.tint }]}>✓ Fully settled</Text>}</View>)}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1 }, content: { padding: 16, paddingBottom: 32 }, header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 }, headerCopy: { flex: 1 }, title: { fontSize: 23, fontWeight: '800' }, subtitle: { fontSize: 12, marginTop: 3 }, card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 }, empty: { borderWidth: 1, borderRadius: 14, padding: 16 }, top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, nameWrap: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }, avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, avatarText: { fontSize: 12, fontWeight: '900' }, name: { fontSize: 15, fontWeight: '800', flex: 1 }, total: { fontSize: 16, fontWeight: '900' }, detail: { fontSize: 12, marginTop: 6 }, button: { alignItems: 'center', borderRadius: 9, paddingVertical: 10, marginTop: 12 }, buttonText: { color: '#fff', fontSize: 13, fontWeight: '800' }, paid: { fontSize: 12, fontWeight: '800', marginTop: 12 } });
