import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl, Dimensions, Modal, Pressable, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { useAdminStats, useDoctors, useAdminAnalytics, useAdminRegistrationTrends, useAdminRevenue, type AdminTrendRange } from '../../hooks/useAdmin';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LineChart } from 'react-native-chart-kit';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';

const { width } = Dimensions.get('window');

const StatCard = ({ title, value, icon, tint }: { title: string, value: string | number, icon: any, tint: string }) => (
    <View style={styles.card}>
        <View style={styles.cardHeader}>
            <View style={styles.iconContainer}>
                <Ionicons name={icon} size={20} color={tint} />
            </View>
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardValue}>{value}</Text>
    </View>
);

export default function AdminDashboard() {
    const insets = useSafeAreaInsets();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const router = useRouter();
    const tabSwipeHandlers = useTabSwipeNavigation('admin-dashboard');
    const [trendRange, setTrendRange] = React.useState<AdminTrendRange>('7d');
    const [selectedMonth, setSelectedMonth] = React.useState<string>(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [isMonthPickerVisible, setIsMonthPickerVisible] = React.useState(false);

    const { data: stats, isLoading: isLoadingStats, refetch: refetchStats, isRefetching: isRefetchingStats } = useAdminStats();
    const { data: analytics, isLoading: isLoadingAnalytics, refetch: refetchAnalytics } = useAdminAnalytics();
    const { data: revenue } = useAdminRevenue();
    const { data: registrationTrends, isLoading: isLoadingRegistrationTrends, refetch: refetchRegistrationTrends } = useAdminRegistrationTrends(trendRange, selectedMonth);
    const adAnalytics: any = null;
    const isLoadingAdsAnalytics = false;
    const { data: doctorsData } = useDoctors(1);

    const recentDoctors = doctorsData?.doctors?.slice(0, 5) || [];

    const onRefresh = React.useCallback(() => {
        refetchStats();
        refetchAnalytics();
        refetchRegistrationTrends();
    }, [refetchStats, refetchAnalytics, refetchRegistrationTrends]);

    const monthOptions = React.useMemo(() => {
        const now = new Date();
        return Array.from({ length: 12 }, (_, idx) => {
            const d = new Date(now.getFullYear(), now.getMonth() - idx, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString([], { month: 'short', year: '2-digit' });
            return { key, label };
        });
    }, []);
    const selectedMonthLabel = React.useMemo(
        () => monthOptions.find((item) => item.key === selectedMonth)?.label || 'Select Month',
        [monthOptions, selectedMonth]
    );

    if (isLoadingStats || (isLoadingAnalytics && !analytics)) {
        return (
            <View style={[styles.container, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={theme.tint} />
            </View>
        );
    }

    const chartConfig = {
        backgroundGradientFrom: "#1e1e1e",
        backgroundGradientTo: "#1e1e1e",
        color: (opacity = 1) => `rgba(67, 233, 123, ${opacity})`,
        strokeWidth: 2, // optional, default 3
        barPercentage: 0.5,
        useShadowColorFromDataset: false, // optional
        decimalPlaces: 0,
        labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
        propsForDots: {
            r: "4",
            strokeWidth: "2",
            stroke: "#43e97b"
        }
    };

    const SHOW_ADS_ANALYTICS = false;

    return (
        <View style={{ flex: 1 }} {...tabSwipeHandlers}>
            <ScrollView
                style={[styles.container, { backgroundColor: theme.background }]}
                contentContainerStyle={[styles.contentContainer, { paddingTop: insets.top + 20 }]}
                refreshControl={<RefreshControl refreshing={isRefetchingStats} onRefresh={onRefresh} tintColor={theme.tint} />}
            >
            <View style={styles.header}>
                <View>
                    <Text style={styles.welcomeText}>Welcome back,</Text>
                    <Text style={styles.adminText}>System Admin</Text>
                </View>
                <TouchableOpacity style={styles.profileButton} onPress={() => router.push('/admin/profile')}>
                    <Ionicons name="person-circle-outline" size={40} color={theme.text} />
                </TouchableOpacity>
            </View>

            <View style={styles.statsGrid}>
                <StatCard title="Total Doctors" value={stats?.totalDoctors || 0} icon="medical" tint={theme.tint} />
                <StatCard title="Verified" value={(stats as any)?.verifiedDoctors || 0} icon="checkmark-circle" tint={theme.tint} />
                <StatCard title="Pending" value={(stats as any)?.pendingDoctors || 0} icon="time" tint={theme.tint} />
                <StatCard title="Total Users" value={stats?.totalUsers || 0} icon="people" tint={theme.tint} />
            </View>

            {revenue ? (
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>Revenue</Text>
                        <TouchableOpacity onPress={() => router.push('/admin/revenue')}>
                            <Text style={styles.viewAllText}>Open Revenue Tab</Text>
                        </TouchableOpacity>
                    </View>
                    <View style={styles.statsGrid}>
                        <StatCard title="Appt Gross" value={`₹${Math.round(revenue.appointmentGross)}`} icon="cash" tint={theme.tint} />
                        <StatCard title="Doctor Payout" value={`₹${Math.round(revenue.doctorPayout)}`} icon="wallet" tint={theme.tint} />
                        <StatCard title="Platform Commission" value={`₹${Math.round(revenue.platformCommission)}`} icon="analytics" tint={theme.tint} />
                        <StatCard title="Subscriptions" value={`₹${Math.round(revenue.subscriptionRevenue)}`} icon="card" tint={theme.tint} />
                    </View>
                </View>
            ) : null}

            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Review Queue</Text>
                </View>
                <View style={styles.reviewCard}>
                    <View style={styles.reviewLeft}>
                        <View style={styles.reviewIconWrap}>
                            <Ionicons name="shield-checkmark-outline" size={18} color={theme.tint} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.reviewTitle}>Doctor Verification Review</Text>
                            <Text style={styles.reviewSubtitle}>
                                Pending profiles: {(stats as any)?.pendingDoctors || 0}
                            </Text>
                        </View>
                    </View>
                    <TouchableOpacity
                        style={styles.reviewActionBtn}
                        onPress={() => router.push('/admin/doctors')}
                    >
                        <Text style={styles.reviewActionText}>Open</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Users & Doctors Growth</Text>
                </View>
                <View style={styles.filterRow}>
                    {[
                        { key: '7d', label: 'Last 7 Days' },
                        { key: '30d', label: 'Last Month' },
                        { key: '12m', label: 'Monthly' },
                    ].map((item) => (
                        <TouchableOpacity
                            key={item.key}
                            style={[
                                styles.filterChip,
                                trendRange === item.key && styles.filterChipActive,
                            ]}
                            onPress={() => setTrendRange(item.key as AdminTrendRange)}
                        >
                            <Text
                                style={[
                                    styles.filterChipText,
                                    trendRange === item.key && styles.filterChipTextActive,
                                ]}
                            >
                                {item.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
                {trendRange === '30d' && (
                    <View style={styles.monthPickerRow}>
                        <Text style={styles.monthPickerLabel}>Month:</Text>
                        <TouchableOpacity
                            style={styles.monthPickerButton}
                            onPress={() => setIsMonthPickerVisible(true)}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="calendar-outline" size={15} color={theme.tint} />
                            <Text style={styles.monthPickerButtonText}>{selectedMonthLabel}</Text>
                            <Ionicons name="chevron-down" size={14} color="#bbb" />
                        </TouchableOpacity>
                    </View>
                )}

                {isLoadingRegistrationTrends && !registrationTrends ? (
                    <View style={[styles.chartContainer, { paddingVertical: 18 }]}>
                        <ActivityIndicator color={theme.tint} />
                    </View>
                ) : registrationTrends ? (
                    <>
                        <View style={styles.chartContainer}>
                            <Text style={styles.miniTitle}>Users Registrations</Text>
                            <LineChart
                                data={registrationTrends.usersChart}
                                width={width - 40}
                                height={200}
                                chartConfig={{
                                    ...chartConfig,
                                    color: (opacity = 1) => `rgba(67, 159, 255, ${opacity})`,
                                    propsForDots: {
                                        r: "3",
                                        strokeWidth: "2",
                                        stroke: "#439fff"
                                    }
                                }}
                                bezier
                                style={{ marginTop: 8, borderRadius: 16 }}
                            />
                        </View>

                        <View style={[styles.chartContainer, { marginTop: 14 }]}>
                            <Text style={styles.miniTitle}>Doctors Registrations</Text>
                            <LineChart
                                data={registrationTrends.doctorsChart}
                                width={width - 40}
                                height={200}
                                chartConfig={chartConfig}
                                bezier
                                style={{ marginTop: 8, borderRadius: 16 }}
                            />
                        </View>
                    </>
                ) : null}
            </View>
            <Modal
                visible={isMonthPickerVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setIsMonthPickerVisible(false)}
            >
                <Pressable style={styles.monthPickerBackdrop} onPress={() => setIsMonthPickerVisible(false)} />
                <View style={styles.monthPickerModal}>
                    <View style={styles.monthPickerModalHeader}>
                        <Text style={styles.monthPickerModalTitle}>Select Month</Text>
                        <TouchableOpacity onPress={() => setIsMonthPickerVisible(false)}>
                            <Text style={styles.monthPickerClose}>Close</Text>
                        </TouchableOpacity>
                    </View>
                    <ScrollView showsVerticalScrollIndicator={false}>
                        {monthOptions.map((item) => (
                            <TouchableOpacity
                                key={item.key}
                                style={[
                                    styles.monthPickerItem,
                                    selectedMonth === item.key && styles.monthPickerItemActive,
                                ]}
                                onPress={() => {
                                    setSelectedMonth(item.key);
                                    setIsMonthPickerVisible(false);
                                }}
                            >
                                <Text
                                    style={[
                                        styles.monthPickerItemText,
                                        selectedMonth === item.key && styles.monthPickerItemTextActive,
                                    ]}
                                >
                                    {item.label}
                                </Text>
                                {selectedMonth === item.key ? (
                                    <Ionicons name="checkmark" size={16} color={theme.tint} />
                                ) : null}
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            </Modal>

            {/* Revenue Chart */}
            {analytics?.revenue && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Revenue Trend (6 Months)</Text>
                    <View style={styles.chartContainer}>
                        <LineChart
                            data={analytics.revenue}
                            width={width - 40}
                            height={220}
                            chartConfig={chartConfig}
                            bezier
                            style={{
                                marginVertical: 8,
                                borderRadius: 16
                            }}
                        />
                    </View>
                </View>
            )}

            {SHOW_ADS_ANALYTICS && (
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Community Ads Analytics</Text>
                    <TouchableOpacity onPress={() => router.push('/admin/ads')}>
                        <Text style={styles.viewAllText}>Manage Ads</Text>
                    </TouchableOpacity>
                </View>

                {isLoadingAdsAnalytics && !adAnalytics ? (
                    <View style={[styles.chartContainer, { paddingVertical: 18 }]}>
                        <ActivityIndicator color={theme.tint} />
                    </View>
                ) : adAnalytics ? (
                    <>
                        <View style={styles.statsGrid}>
                            <StatCard title="Total Ads" value={adAnalytics.totalAds} icon="megaphone" tint={theme.tint} />
                            <StatCard title="Active Ads" value={adAnalytics.activeAds} icon="radio" tint={theme.tint} />
                            <StatCard title="Impressions (30d)" value={adAnalytics.impressions30d} icon="eye" tint={theme.tint} />
                            <StatCard title="CTR (30d)" value={`${adAnalytics.ctr30d}%`} icon="stats-chart" tint={theme.tint} />
                        </View>

                        <View style={styles.chartContainer}>
                            <Text style={styles.miniTitle}>Impressions (Last 7 Days)</Text>
                            <LineChart
                                data={adAnalytics.impressionsTrend}
                                width={width - 40}
                                height={190}
                                chartConfig={chartConfig}
                                bezier
                                style={{ marginTop: 8, borderRadius: 16 }}
                            />
                        </View>

                        <View style={[styles.chartContainer, { marginTop: 14 }]}>
                            <Text style={styles.miniTitle}>Clicks (Last 7 Days)</Text>
                            <LineChart
                                data={adAnalytics.clicksTrend}
                                width={width - 40}
                                height={190}
                                chartConfig={{
                                    ...chartConfig,
                                    color: (opacity = 1) => `rgba(67, 159, 255, ${opacity})`,
                                }}
                                bezier
                                style={{ marginTop: 8, borderRadius: 16 }}
                            />
                        </View>

                        <View style={[styles.topAdsCard]}>
                            <Text style={styles.topAdsTitle}>Top Ads by Impressions</Text>
                            {adAnalytics.topAds.length === 0 ? (
                                <Text style={styles.topAdsEmpty}>No ad events yet.</Text>
                            ) : (
                                adAnalytics.topAds.map((ad: any, idx: number) => (
                                    <View key={ad.adId} style={styles.topAdsRow}>
                                        <Text style={styles.topAdsName} numberOfLines={1}>
                                            {idx + 1}. {ad.title}
                                        </Text>
                                        <Text style={styles.topAdsMeta}>
                                            {ad.impressions} imp • {ad.clicks} clk • {ad.ctr.toFixed(1)}%
                                        </Text>
                                    </View>
                                ))
                            )}
                        </View>
                    </>
                ) : null}
            </View>
            )}

            {/* User Growth Chart */}
            {analytics?.userGrowth && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>User Registrations (Last 7 Days)</Text>
                    <View style={styles.chartContainer}>
                        <LineChart
                            data={analytics.userGrowth}
                            width={width - 40}
                            height={220}
                            chartConfig={{
                                ...chartConfig,
                                color: (opacity = 1) => `rgba(250, 112, 154, ${opacity})`,
                            }}
                            bezier
                            style={{
                                marginVertical: 8,
                                borderRadius: 16
                            }}
                        />
                    </View>
                </View>
            )}

            {/* Recent Doctors */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Recent Registrations</Text>
                    <TouchableOpacity onPress={() => router.push('/admin/doctors')}>
                        <Text style={styles.viewAllText}>View All</Text>
                    </TouchableOpacity>
                </View>

                {recentDoctors.map((doc: any, index: number) => (
                    <View key={doc._id || index} style={styles.doctorItem}>
                        <View style={styles.doctorInfo}>
                            <View style={[styles.avatarPlaceholder]}>
                                <Text style={styles.avatarText}>
                                    {doc.firstName?.[0]}{doc.lastName?.[0]}
                                </Text>
                            </View>
                            <View>
                                <Text style={styles.doctorName}>Dr. {doc.firstName} {doc.lastName}</Text>
                                <Text style={styles.doctorSpec}>{doc.specialization} • {doc.experience}</Text>
                            </View>
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: doc.isVerified ? 'rgba(67, 233, 123, 0.1)' : 'rgba(250, 112, 154, 0.1)' }]}>
                            <Text style={[styles.statusText, { color: doc.isVerified ? '#43e97b' : '#fa709a' }]}>
                                {doc.isVerified ? 'Verified' : 'Pending'}
                            </Text>
                        </View>
                    </View>
                ))}
            </View>

            <View style={{ height: 100 }} />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    chartContainer: {
        backgroundColor: '#1e1e1e',
        borderRadius: 16,
        padding: 12,
        borderWidth: 1,
        borderColor: '#333',
        alignItems: 'center',
    },
    miniTitle: {
        color: '#fff',
        fontSize: 13,
        fontFamily: 'Outfit-Bold',
        alignSelf: 'flex-start',
        marginLeft: 8,
    },
    container: {
        flex: 1,
    },
    contentContainer: {
        paddingHorizontal: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 30,
    },
    welcomeText: {
        color: '#aaa',
        fontSize: 14,
        fontFamily: 'Outfit-Regular',
    },
    adminText: {
        color: '#fff',
        fontSize: 24,
        fontFamily: 'Outfit-Bold',
    },
    profileButton: {
        padding: 5,
    },
    card: {
        width: (width - 48) / 2,
        minHeight: 124,
        padding: 14,
        backgroundColor: '#1E1E1E',
        borderRadius: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#2A2A2A',
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    iconContainer: {
        width: 32,
        height: 32,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    cardTitle: {
        fontSize: 12,
        lineHeight: 16,
        fontFamily: 'Outfit-Medium',
        color: '#A0A0A0',
        marginBottom: 8,
    },
    cardValue: {
        fontSize: 32,
        lineHeight: 36,
        fontFamily: 'Outfit-Bold',
        color: '#FFF',
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    section: {
        marginBottom: 30,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    filterRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 12,
    },
    filterChip: {
        borderWidth: 1,
        borderColor: '#333',
        backgroundColor: '#1E1E1E',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 7,
        marginRight: 8,
        marginBottom: 8,
    },
    filterChipActive: {
        borderColor: Colors.dark.tint,
        backgroundColor: 'rgba(67, 233, 123, 0.14)',
    },
    filterChipText: {
        color: '#B5B5B5',
        fontSize: 12,
        fontFamily: 'Outfit-Medium',
    },
    filterChipTextActive: {
        color: Colors.dark.tint,
        fontFamily: 'Outfit-SemiBold',
    },
    monthPickerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    monthPickerLabel: {
        color: '#aaa',
        fontSize: 12,
        fontFamily: 'Outfit-Regular',
        marginRight: 8,
    },
    monthPickerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#333',
        backgroundColor: '#171717',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    monthPickerButtonText: {
        color: '#fff',
        fontSize: 12,
        fontFamily: 'Outfit-Medium',
        marginHorizontal: 6,
    },
    monthPickerBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
    },
    monthPickerModal: {
        position: 'absolute',
        left: 18,
        right: 18,
        top: '20%',
        maxHeight: '60%',
        backgroundColor: '#141414',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#333',
        padding: 12,
    },
    monthPickerModalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    monthPickerModalTitle: {
        color: '#fff',
        fontSize: 15,
        fontFamily: 'Outfit-SemiBold',
    },
    monthPickerClose: {
        color: Colors.dark.tint,
        fontSize: 12,
        fontFamily: 'Outfit-SemiBold',
    },
    monthPickerItem: {
        borderWidth: 1,
        borderColor: '#2f2f2f',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 10,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    monthPickerItemActive: {
        borderColor: Colors.dark.tint,
        backgroundColor: 'rgba(67, 233, 123, 0.12)',
    },
    monthPickerItemText: {
        color: '#ddd',
        fontSize: 12,
        fontFamily: 'Outfit-Medium',
    },
    monthPickerItemTextActive: {
        color: Colors.dark.tint,
        fontFamily: 'Outfit-SemiBold',
    },
    monthChip: {
        borderWidth: 1,
        borderColor: '#2f2f2f',
        backgroundColor: '#171717',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginRight: 8,
    },
    monthChipActive: {
        borderColor: Colors.dark.tint,
        backgroundColor: 'rgba(67, 233, 123, 0.14)',
    },
    monthChipText: {
        color: '#B5B5B5',
        fontSize: 11,
        fontFamily: 'Outfit-Medium',
    },
    monthChipTextActive: {
        color: Colors.dark.tint,
        fontFamily: 'Outfit-SemiBold',
    },
    sectionTitle: {
        color: '#fff',
        fontSize: 20,
        fontFamily: 'Outfit-Bold',
    },
    viewAllText: {
        color: Colors.dark.tint,
        fontSize: 13,
        fontFamily: 'Outfit-SemiBold',
    },
    revenueCard: {
        padding: 20,
        backgroundColor: '#1e1e1e',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#333',
    },
    revenueLabel: {
        color: '#888',
        fontSize: 14,
        fontFamily: 'Outfit-Medium',
    },
    revenueAmount: {
        color: '#fff',
        fontSize: 36,
        fontFamily: 'Outfit-Bold',
        marginVertical: 10,
    },
    revenueGrowth: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(67, 233, 123, 0.1)',
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 10,
    },
    growthText: {
        color: '#43e97b',
        fontSize: 12,
        marginLeft: 5,
        fontFamily: 'Outfit-Medium',
    },
    doctorItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#1e1e1e',
        padding: 15,
        borderRadius: 15,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#333',
    },
    doctorInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    avatarPlaceholder: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#333',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 15,
    },
    avatarText: {
        fontSize: 16,
        fontFamily: 'Outfit-Bold',
        color: '#fff',
    },
    doctorName: {
        color: '#fff',
        fontSize: 16,
        fontFamily: 'Outfit-Medium',
    },
    doctorSpec: {
        color: '#666',
        fontSize: 12,
        fontFamily: 'Outfit-Regular',
        marginTop: 2,
    },
    statusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 20,
    },
    statusText: {
        fontSize: 10,
        fontFamily: 'Outfit-Bold',
        textTransform: 'uppercase',
    },
    topAdsCard: {
        marginTop: 14,
        backgroundColor: '#1e1e1e',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#333',
        padding: 12,
    },
    topAdsTitle: {
        color: '#fff',
        fontFamily: 'Outfit-Bold',
        fontSize: 14,
        marginBottom: 8,
    },
    topAdsEmpty: {
        color: '#aaa',
        fontFamily: 'Outfit-Regular',
        fontSize: 12,
    },
    topAdsRow: {
        paddingVertical: 6,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#2f2f2f',
    },
    topAdsName: {
        color: '#fff',
        fontSize: 12,
        fontFamily: 'Outfit-Medium',
        marginBottom: 2,
    },
    topAdsMeta: {
        color: '#bbb',
        fontSize: 11,
        fontFamily: 'Outfit-Regular',
    },
    reviewCard: {
        backgroundColor: '#1e1e1e',
        borderWidth: 1,
        borderColor: '#333',
        borderRadius: 14,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    reviewLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 12,
    },
    reviewIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 9,
        backgroundColor: 'rgba(67, 233, 123, 0.12)',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    reviewTitle: {
        color: '#fff',
        fontSize: 14,
        fontFamily: 'Outfit-SemiBold',
    },
    reviewSubtitle: {
        color: '#b8b8b8',
        fontSize: 12,
        marginTop: 2,
        fontFamily: 'Outfit-Regular',
    },
    reviewActionBtn: {
        borderWidth: 1,
        borderColor: Colors.dark.tint,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 7,
        backgroundColor: 'rgba(67, 233, 123, 0.14)',
    },
    reviewActionText: {
        color: Colors.dark.tint,
        fontFamily: 'Outfit-SemiBold',
        fontSize: 12,
    },
});

