import React from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { ArrowLeft, CheckCircle2, Clock3, Receipt } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Colors from '../../constants/Colors';
import DoctorSafeScreen from '../../ui/doctor/DoctorSafeScreen';
import { useDoctorEarnings, useDoctorTransactions, type DoctorTransaction } from '../../hooks/useDoctor';

const money = (value: number) => `₹${Math.round(value || 0).toLocaleString('en-IN')}`;

const dateLabel = (value: string | null) => {
    if (!value) return 'Date unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function DoctorTransactionsScreen() {
    const router = useRouter();
    const theme = Colors[useColorScheme() ?? 'light'];
    const { data: earnings } = useDoctorEarnings();
    const { data: transactions = [], isLoading, isRefetching, refetch } = useDoctorTransactions();

    const renderItem = ({ item }: { item: DoctorTransaction }) => {
        const settled = item.payoutStatus === 'paid';
        return (
            <View style={[styles.transactionCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={styles.transactionHeader}>
                    <View style={styles.patientWrap}>
                        <View style={[styles.receiptIcon, { backgroundColor: theme.tint + '16' }]}>
                            <Receipt size={17} color={theme.tint} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.patientName, { color: theme.text }]} numberOfLines={1}>{item.patientName}</Text>
                            <Text style={[styles.date, { color: theme.textSecondary }]}>{dateLabel(item.paidAt || item.createdAt)}</Text>
                        </View>
                    </View>
                    <Text style={[styles.doctorShare, { color: theme.tint }]}>{money(item.doctorShare)}</Text>
                </View>
                <View style={styles.detailGrid}>
                    <View style={styles.detailItem}><Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Patient paid</Text><Text style={[styles.detailValue, { color: theme.text }]}>{money(item.grossAmount)}</Text></View>
                    <View style={styles.detailItem}><Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Admin fee</Text><Text style={[styles.detailValue, { color: theme.text }]}>{money(item.platformCommission)}</Text></View>
                    <View style={styles.detailItem}><Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Your fee</Text><Text style={[styles.detailValue, { color: theme.tint }]}>{money(item.doctorShare)}</Text></View>
                </View>
                <View style={styles.statusRow}>
                    {settled ? <CheckCircle2 size={14} color={theme.tint} /> : <Clock3 size={14} color={theme.textSecondary} />}
                    <Text style={[styles.statusText, { color: settled ? theme.tint : theme.textSecondary }]}>{settled ? 'Paid to doctor' : 'Pending payout'}</Text>
                    {item.paymentId ? <Text style={[styles.paymentId, { color: theme.textSecondary }]} numberOfLines={1}>Payment ID: {item.paymentId}</Text> : null}
                </View>
            </View>
        );
    };

    return (
        <DoctorSafeScreen backgroundColor={theme.background} edges={['bottom']}>
            <FlatList
                data={transactions}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.tint} />}
                ListHeaderComponent={
                    <View>
                        <View style={styles.header}>
                            <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={10}><ArrowLeft size={22} color={theme.text} /></TouchableOpacity>
                            <View style={{ flex: 1 }}><Text style={[styles.title, { color: theme.text }]}>Transactions</Text><Text style={[styles.subtitle, { color: theme.textSecondary }]}>All paid consultation revenue</Text></View>
                        </View>
                        <View style={[styles.summaryCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                            <Text style={[styles.summaryTitle, { color: theme.text }]}>Revenue summary</Text>
                            <View style={styles.summaryGrid}>
                                <View style={styles.summaryItem}><Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>Total paid</Text><Text style={[styles.summaryValue, { color: theme.text }]}>{money(earnings?.totalPaid || 0)}</Text></View>
                                <View style={styles.summaryItem}><Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>Admin fee</Text><Text style={[styles.summaryValue, { color: theme.text }]}>{money(earnings?.platformCommission || 0)}</Text></View>
                                <View style={styles.summaryItem}><Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>Your total</Text><Text style={[styles.summaryValue, { color: theme.tint }]}>{money(earnings?.doctorPayout || 0)}</Text></View>
                            </View>
                            <Text style={[styles.summaryFooter, { color: theme.textSecondary }]}>Settled {money(earnings?.settledPayout || 0)} · Pending {money(earnings?.pendingPayout || 0)}</Text>
                        </View>
                        <Text style={[styles.sectionTitle, { color: theme.text }]}>Payment history</Text>
                    </View>
                }
                ListEmptyComponent={isLoading ? <ActivityIndicator color={theme.tint} style={{ marginTop: 30 }} /> : <Text style={[styles.empty, { color: theme.textSecondary }]}>No paid transactions yet.</Text>}
            />
        </DoctorSafeScreen>
    );
}

const styles = StyleSheet.create({
    content: { padding: 20, paddingBottom: 32 },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
    backButton: { marginRight: 12 },
    title: { fontSize: 24, fontWeight: '800' },
    subtitle: { marginTop: 3, fontSize: 12 },
    summaryCard: { borderWidth: 1, borderRadius: 16, padding: 15 },
    summaryTitle: { fontSize: 16, fontWeight: '800' },
    summaryGrid: { flexDirection: 'row', gap: 8, marginTop: 16 },
    summaryItem: { flex: 1 },
    summaryLabel: { fontSize: 10 },
    summaryValue: { marginTop: 4, fontSize: 15, fontWeight: '800' },
    summaryFooter: { marginTop: 14, fontSize: 11 },
    sectionTitle: { marginTop: 22, marginBottom: 10, fontSize: 18, fontWeight: '800' },
    transactionCard: { borderWidth: 1, borderRadius: 15, padding: 14, marginBottom: 10 },
    transactionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    patientWrap: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 },
    receiptIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    patientName: { fontSize: 14, fontWeight: '800' },
    date: { marginTop: 3, fontSize: 11 },
    doctorShare: { fontSize: 16, fontWeight: '900' },
    detailGrid: { flexDirection: 'row', gap: 8, marginTop: 15 },
    detailItem: { flex: 1 },
    detailLabel: { fontSize: 10 },
    detailValue: { marginTop: 3, fontSize: 13, fontWeight: '700' },
    statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
    statusText: { marginLeft: 5, fontSize: 11, fontWeight: '700' },
    paymentId: { flex: 1, marginLeft: 10, fontSize: 10, textAlign: 'right' },
    empty: { textAlign: 'center', marginTop: 30, fontSize: 13 },
});
