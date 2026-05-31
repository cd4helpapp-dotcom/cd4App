import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    ActivityIndicator,
    Image,
    Switch,
    TouchableOpacity,
    TextInput,
    useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDoctors, useVerifyDoctor, useAdminDoctorSearch } from '../../hooks/useAdmin';
import { Doctor } from '../../src/types';
import Colors from '../../constants/Colors';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import Toast from 'react-native-toast-message';
import { useRouter } from 'expo-router';

const renderValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-';
    const text = String(value).trim();
    return text.length > 0 ? text : '-';
};

const renderDate = (value?: string): string => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString();
};

export default function DoctorsListScreen() {
    const [page, setPage] = useState(1);
    const [allDoctors, setAllDoctors] = useState<Doctor[]>([]);
    const [searchInput, setSearchInput] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const tabSwipeHandlers = useTabSwipeNavigation('admin-doctors');
    const router = useRouter();

    const { data, isLoading, isRefetching, refetch } = useDoctors(page);
    const verifyMutation = useVerifyDoctor();
    const {
        data: searchedDoctors,
        isFetching: isSearchingDoctors,
    } = useAdminDoctorSearch(debouncedSearch);
    const getDoctorId = (doctor: Doctor): string => String((doctor as any).id || (doctor as any)._id || '');

    const doctors = data?.doctors || [];
    const totalPages = data?.totalPages || 1;
    const normalizedQuery = debouncedSearch.trim().toLowerCase();
    const isSearchMode = normalizedQuery.length >= 3;

    useEffect(() => {
        if (page === 1) {
            setAllDoctors(doctors);
            return;
        }

        if (!doctors.length) return;
        setAllDoctors((prev) => {
            const map = new Map<string, Doctor>();
            prev.forEach((item) => map.set(getDoctorId(item), item));
            doctors.forEach((item) => map.set(getDoctorId(item), item));
            return Array.from(map.values());
        });
    }, [doctors, page]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchInput);
        }, 350);
        return () => clearTimeout(timer);
    }, [searchInput]);

    const onRefresh = () => {
        setPage(1);
        refetch();
    };

    const filteredDoctors = React.useMemo(() => {
        if (!normalizedQuery) return allDoctors;
        if (!isSearchMode) {
            return allDoctors.filter((doc) => {
                const haystack = [
                    `${doc.firstName || ''} ${doc.lastName || ''}`.trim(),
                    doc.email || '',
                    doc.specialization || '',
                    doc.city || '',
                    doc.phoneNumber || '',
                    doc.registrationNumber || '',
                ]
                    .join(' ')
                    .toLowerCase();
                return haystack.includes(normalizedQuery);
            });
        }
        return searchedDoctors || [];
    }, [allDoctors, normalizedQuery, isSearchMode, searchedDoctors]);

    const loadMore = () => {
        if (page < totalPages && !isLoading && !isRefetching) {
            setPage((prev) => prev + 1);
        }
    };

    const toggleVerification = async (doctor: Doctor) => {
        const newStatus = !doctor.isVerified;

        const doctorId = getDoctorId(doctor);
        if (!doctorId) {
            Toast.show({
                type: 'error',
                text1: 'Missing doctor id',
                text2: 'Could not find doctor identifier for verification.',
            });
            return;
        }

        verifyMutation.mutate({ doctorId, isVerified: newStatus }, {
            onSuccess: (response: any) => {
                if (response.success) {
                    Toast.show({
                        type: 'success',
                        text1: 'Verification updated',
                        text2: `Doctor marked as ${newStatus ? 'Verified' : 'Pending'}.`,
                    });
                } else {
                    Toast.show({
                        type: 'error',
                        text1: 'Update failed',
                        text2: response.message || 'Could not update doctor verification.',
                    });
                }
            },
            onError: (error: any) => {
                Toast.show({
                    type: 'error',
                    text1: 'Error',
                    text2: error?.message || 'Failed to update verification status.',
                });
            },
        });
    };

    const renderDoctorItem = ({ item }: { item: Doctor }) => (
        <View style={[styles.card, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
            <View style={styles.cardHeader}>
                <TouchableOpacity
                    style={styles.profileTapArea}
                    activeOpacity={0.8}
                    onPress={() =>
                        router.push({
                            pathname: '/admin/doctor-profile',
                            params: { doctorId: getDoctorId(item) },
                        })
                    }
                >
                    <Image
                        source={{ uri: item.image || 'https://via.placeholder.com/50' }}
                        style={styles.avatar}
                    />
                    <View style={styles.infoContainer}>
                        <Text style={[styles.name, { color: theme.text }]}>Dr. {item.firstName} {item.lastName}</Text>
                        <Text style={[styles.specialization, { color: theme.textSecondary }]}>{renderValue(item.specialization)}</Text>
                        <Text style={[styles.details, { color: theme.textSecondary }]}>{renderValue(item.email)}</Text>
                    </View>
                </TouchableOpacity>
                <Switch
                    trackColor={{ false: '#767577', true: theme.successLight }}
                    thumbColor={item.isVerified ? theme.success : '#f4f3f4'}
                    onValueChange={() => toggleVerification(item)}
                    value={item.isVerified}
                    disabled={verifyMutation.isPending}
                />
            </View>
            <View style={[styles.cardFooter, { borderTopColor: theme.borderColor }]}>
                <View>
                    <Text style={[styles.status, { color: item.isVerified ? theme.success : theme.badgeText }]}>
                        {item.isVerified ? 'Verified' : 'Pending Verification'}
                    </Text>
                    <Text style={[styles.date, { color: theme.textSecondary }]}>
                        Created: {renderDate(item.createdAt)}
                    </Text>
                </View>
                <TouchableOpacity
                    style={[styles.viewDetailsButton, { borderColor: theme.tint }]}
                    activeOpacity={0.85}
                    onPress={() => {
                        router.push({
                            pathname: '/admin/doctor-profile',
                            params: { doctorId: getDoctorId(item) },
                        });
                    }}
                >
                    <Text style={[styles.viewDetailsButtonText, { color: theme.tint }]}>View Profile</Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} {...tabSwipeHandlers}>
            <View style={styles.headerContainer}>
                <Text style={[styles.header, { color: theme.text }]}>Manage Doctors</Text>
                <Text style={[styles.headerSubText, { color: theme.textSecondary }]}>
                    Review qualifications, documents, and verify only trusted doctors.
                </Text>
                <View style={[styles.searchWrap, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
                    <TextInput
                        value={searchInput}
                        onChangeText={setSearchInput}
                        placeholder="Search doctor, city, email..."
                        placeholderTextColor={theme.textSecondary}
                        style={[styles.searchInput, { color: theme.text }]}
                    />
                </View>
                {normalizedQuery.length > 0 && normalizedQuery.length < 3 ? (
                    <Text style={[styles.searchHint, { color: theme.textSecondary }]}>
                        Quick local search. Type 3+ chars for full database search.
                    </Text>
                ) : null}
            </View>

            {isLoading && page === 1 ? (
                <ActivityIndicator size="large" color={theme.tint} style={{ marginTop: 20 }} />
            ) : (
                <FlatList
                    data={filteredDoctors}
                    renderItem={renderDoctorItem}
                    keyExtractor={(item) => getDoctorId(item) || item.email}
                    contentContainerStyle={styles.listContent}
                    refreshing={isRefetching && page === 1}
                    onRefresh={onRefresh}
                    onEndReached={loadMore}
                    onEndReachedThreshold={0.5}
                    ListFooterComponent={
                        isSearchMode ? (
                            isSearchingDoctors ? (
                                <View style={styles.footerLoader}>
                                    <ActivityIndicator size="small" color={theme.tint} />
                                </View>
                            ) : null
                        ) : page < totalPages ? (
                            <View style={styles.footerLoader}>
                                <ActivityIndicator size="small" color={theme.tint} />
                            </View>
                        ) : null
                    }
                    ListEmptyComponent={
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                            {normalizedQuery ? 'No doctors match your search.' : 'No doctors found.'}
                        </Text>
                    }
                />
            )}

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    headerContainer: {
        padding: 20,
        paddingBottom: 10,
    },
    header: {
        fontSize: 24,
        fontWeight: '700',
    },
    headerSubText: {
        marginTop: 6,
        fontSize: 13,
        lineHeight: 19,
    },
    searchWrap: {
        marginTop: 12,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    searchInput: {
        fontSize: 14,
        paddingVertical: 0,
    },
    searchHint: {
        marginTop: 7,
        fontSize: 12,
    },
    listContent: {
        padding: 16,
        paddingBottom: 30,
    },
    card: {
        borderRadius: 14,
        padding: 16,
        marginBottom: 14,
        borderWidth: 1,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    profileTapArea: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatar: {
        width: 52,
        height: 52,
        borderRadius: 26,
        marginRight: 12,
        backgroundColor: '#E3E6EA',
    },
    infoContainer: {
        flex: 1,
    },
    name: {
        fontSize: 16,
        fontWeight: '700',
    },
    specialization: {
        fontSize: 14,
        marginTop: 2,
    },
    details: {
        fontSize: 12,
        marginTop: 2,
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        paddingTop: 10,
    },
    status: {
        fontSize: 12,
        fontWeight: '700',
    },
    date: {
        fontSize: 11,
        marginTop: 3,
    },
    viewDetailsButton: {
        borderWidth: 1,
        borderRadius: 9,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    viewDetailsButtonText: {
        fontSize: 12,
        fontWeight: '700',
    },
    emptyText: {
        textAlign: 'center',
        marginTop: 28,
        fontSize: 15,
    },
    footerLoader: {
        paddingVertical: 12,
    },
});
