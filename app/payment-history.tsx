import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthContext } from '../context/AuthContext';
import { usePatientPaymentHistory } from '../hooks/useAdmin';
import Colors from '../constants/Colors';

const money = (amount: number, currency: string) => `${currency === 'INR' ? '₹' : currency} ${Math.round(amount).toLocaleString('en-IN')}`;

export default function PaymentHistoryScreen() {
  const { user } = useAuthContext();
  const { data = [], isLoading, error } = usePatientPaymentHistory(user?.id);
  const theme = Colors[useColorScheme() ?? 'light'];
  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}><ScrollView contentContainerStyle={styles.content}>
    <Text style={[styles.title, { color: theme.text }]}>Payment history</Text>
    <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Your consultation and subscription receipts</Text>
    {isLoading ? <ActivityIndicator color={theme.tint} style={styles.loader} /> : error ? <Text style={[styles.empty, { color: theme.textSecondary }]}>Could not load payment history.</Text> : data.length === 0 ? <Text style={[styles.empty, { color: theme.textSecondary }]}>No payments found yet.</Text> : data.map((item) => <View key={`${item.kind}-${item.id}`} style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}><View style={styles.row}><View style={[styles.icon, { backgroundColor: theme.tint + '16' }]}><Ionicons name={item.kind === 'subscription' ? 'card-outline' : 'medkit-outline'} size={19} color={theme.tint} /></View><View style={styles.main}><Text style={[styles.kind, { color: theme.text }]}>{item.kind === 'subscription' ? 'Pro subscription' : 'Doctor consultation'}</Text><Text style={[styles.date, { color: theme.textSecondary }]}>{new Date(item.paidAt || item.createdAt).toLocaleString('en-IN')}</Text></View><Text style={[styles.amount, { color: theme.text }]}>{money(item.amount, item.currency)}</Text></View><View style={styles.meta}><Text style={[styles.status, { color: item.status === 'paid' ? theme.tint : theme.textSecondary }]}>{item.status.toUpperCase()}</Text><Text style={[styles.id, { color: theme.textSecondary }]}>{item.paymentId || item.orderId || 'Payment pending'}</Text></View></View>)}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1 }, content: { padding: 16, paddingBottom: 36 }, title: { fontSize: 25, fontWeight: '800' }, subtitle: { fontSize: 13, marginTop: 4, marginBottom: 18 }, loader: { marginTop: 30 }, empty: { textAlign: 'center', marginTop: 36 }, card: { borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 10 }, row: { flexDirection: 'row', alignItems: 'center' }, icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, main: { flex: 1, marginLeft: 10 }, kind: { fontSize: 14, fontWeight: '800' }, date: { fontSize: 11, marginTop: 3 }, amount: { fontSize: 15, fontWeight: '800' }, meta: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 11 }, status: { fontSize: 10, fontWeight: '900' }, id: { flex: 1, textAlign: 'right', fontSize: 10 },
});
