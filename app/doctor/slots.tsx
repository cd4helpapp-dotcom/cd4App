import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, useColorScheme,
    Modal, ActivityIndicator, Alert, Platform, ScrollView, TextInput, SectionList
} from 'react-native';
import Colors from '../../constants/Colors';
import { Calendar, Clock, Plus, X, ChevronDown, ListFilter, Archive } from 'lucide-react-native';
import { useDoctorSlots, useAddSlot } from '../../hooks/useAppointment';
import { Slot } from '../../src/types';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import DoctorSafeScreen from '../../ui/doctor/DoctorSafeScreen';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';

// Time slot options for dropdown (every 30 minutes)
const TIME_OPTIONS = [
    '06:00 AM', '06:30 AM', '07:00 AM', '07:30 AM',
    '08:00 AM', '08:30 AM', '09:00 AM', '09:30 AM',
    '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
    '12:00 PM', '12:30 PM', '01:00 PM', '01:30 PM',
    '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM',
    '04:00 PM', '04:30 PM', '05:00 PM', '05:30 PM',
    '06:00 PM', '06:30 PM', '07:00 PM', '07:30 PM',
    '08:00 PM', '08:30 PM', '09:00 PM', '09:30 PM',
    '10:00 PM', '10:30 PM', '11:00 PM', '11:30 PM',
];

// Helper: given a start time string like "10:00 AM", return the +30min end time
function getEndTime(startTime: string): string {
    const idx = TIME_OPTIONS.indexOf(startTime);
    if (idx >= 0 && idx < TIME_OPTIONS.length - 1) {
        return TIME_OPTIONS[idx + 1];
    }
    // Last slot wraps to next day midnight
    return '12:00 AM';
}

export default function DoctorSlots() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const [filterMode, setFilterMode] = useState<'upcoming' | 'past'>('upcoming');
    const [isAddModalVisible, setIsAddModalVisible] = useState(false);
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [selectedStartTime, setSelectedStartTime] = useState('');
    const [showStartTimePicker, setShowStartTimePicker] = useState(false);
    const tabSwipeHandlers = useTabSwipeNavigation('doctor-slots');
    
    // For web date input
    const [webDateValue, setWebDateValue] = useState('');

    const { data: slots = [], isLoading } = useDoctorSlots();
    const addSlotMutation = useAddSlot();

    const handleSuccess = () => {
        setIsAddModalVisible(false);
        setSelectedDate(new Date());
        setSelectedStartTime('');
        setWebDateValue('');
        Alert.alert('Success', 'Slot added successfully');
    };

    const handleError = (error: any) => {
        Alert.alert('Error', error?.message || 'Failed to add slot');
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });
    };

    const formatDateForAPI = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const getTodayISO = () => {
        const d = new Date();
        return formatDateForAPI(d);
    };

    const onDateChange = (event: DateTimePickerEvent, date?: Date) => {
        if (Platform.OS === 'android') {
            setShowDatePicker(false);
        }
        if (date) {
            setSelectedDate(date);
        }
    };

    const handleAddSlot = () => {
        if (!selectedStartTime) {
            Alert.alert('Validation Error', 'Please select a time slot');
            return;
        }
        const dateStr = Platform.OS === 'web'
            ? (webDateValue || getTodayISO())
            : formatDateForAPI(selectedDate);

        addSlotMutation.mutate({
            date: dateStr,
            startTime: selectedStartTime,
            endTime: getEndTime(selectedStartTime),
        }, {
            onSuccess: handleSuccess,
            onError: handleError
        });
    };

    // Filtering & Grouping
    const groupedSlots = React.useMemo(() => {
        if (!slots || slots.length === 0) return [];
        
        const todayRaw = new Date();
        const todayStr = formatDateForAPI(todayRaw);

        // Sort chronologically
        const sortedSlots = [...slots].sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (dateA !== dateB) return dateA - dateB;

            // Rudimentary string comparison for time slot
            const parseTime = (t: string) => {
                const isPM = t.toLowerCase().includes('pm');
                const parts = t.replace(/(am|pm)/i, '').trim().split(':');
                let h = parseInt(parts[0], 10);
                if (isPM && h !== 12) h += 12;
                if (!isPM && h === 12) h = 0;
                return h * 60 + parseInt(parts[1], 10);
            };

            return parseTime(a.startTime) - parseTime(b.startTime);
        });

        // Filter based on todayStr
        const filtered = sortedSlots.filter(s => {
            const slotDateRaw = new Date(s.date);
            const slotDateStr = formatDateForAPI(slotDateRaw);
            
            if (filterMode === 'upcoming') {
                return slotDateStr >= todayStr;
            } else {
                return slotDateStr < todayStr;
            }
        });

        // If 'past', we usually want newest past dates first
        if (filterMode === 'past') {
            filtered.sort((a, b) => {
                const dateA = new Date(a.date).getTime();
                const dateB = new Date(b.date).getTime();
                if (dateA !== dateB) return dateB - dateA; // reverse date
                return 0; 
            });
        }

        // Group by human-readable date string
        const groups: { [key: string]: Slot[] } = {};
        filtered.forEach(s => {
            const d = new Date(s.date);
            const dStr = formatDateForAPI(d);
            
            // Format group title
            let title = '';
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = formatDateForAPI(tomorrow);

            if (dStr === todayStr) {
                title = 'Today, ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            } else if (tomorrowStr === dStr) {
                title = 'Tomorrow, ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            } else {
                title = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: filterMode === 'past' ? 'numeric' : undefined });
            }

            if (!groups[title]) groups[title] = [];
            groups[title].push(s);
        });

        return Object.keys(groups).map(title => ({
            title,
            data: groups[title]
        }));

    }, [slots, filterMode]);


    const renderSlotCard = ({ item }: { item: Slot }) => {
        const isPast = filterMode === 'past';
        const colorBooked = '#FF4D4D';
        const colorAvailable = theme.success;
        const activeColor = item.isBooked ? colorBooked : colorAvailable;

        return (
            <View style={[
                styles.slotCard, 
                { backgroundColor: theme.cardBackground, borderColor: theme.borderColor },
                isPast && { opacity: 0.65 }
            ]}>
                <View style={[styles.slotBorderLeft, { backgroundColor: activeColor }]} />
                
                <View style={styles.slotContent}>
                    <View style={styles.slotTopRow}>
                        <View style={styles.timeGroup}>
                            <Clock size={16} color={theme.text} style={{ marginRight: 6 }} />
                            <Text style={[styles.timeText, { color: theme.text }]}>
                                {item.startTime} - {item.endTime}
                            </Text>
                        </View>

                        <View style={[styles.statusBadge, { 
                            backgroundColor: item.isBooked ? `${colorBooked}15` : theme.successLight 
                        }]}>
                            <View style={[styles.statusDot, { backgroundColor: activeColor }]} />
                            <Text style={[styles.statusText, { color: activeColor }]}>
                                {item.isBooked ? 'Booked' : 'Available'}
                            </Text>
                        </View>
                    </View>

                    {item.isBooked && (
                        <View style={styles.patientInfoRow}>
                            <View style={[styles.patientPill, { backgroundColor: theme.background }]}>
                                <Text style={[styles.consultLabel, { color: theme.textSecondary }]}>Teleconsultation</Text>
                            </View>
                        </View>
                    )}
                </View>
            </View>
        );
    };

    const renderSectionHeader = ({ section: { title } }: any) => (
        <View style={[styles.sectionHeaderWrap, { backgroundColor: theme.background }]}>
            <Text style={[styles.sectionTitle, { color: theme.tint }]}>{title}</Text>
        </View>
    );

    return (
        <DoctorSafeScreen backgroundColor={theme.background} panHandlers={tabSwipeHandlers}>
            <View style={styles.header}>
                <View>
                    <Text style={[styles.headerTitle, { color: theme.text }]}>Manage Slots</Text>
                    <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>Organize your availability easily</Text>
                </View>

                {filterMode === 'upcoming' && (
                    <TouchableOpacity
                        style={[styles.addButton, { backgroundColor: theme.tint }]}
                        onPress={() => setIsAddModalVisible(true)}
                        activeOpacity={0.8}
                    >
                        <Plus size={18} color="#fff" />
                        <Text style={styles.addButtonText}>Add Slot</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* Filter Toggle */}
            <View style={styles.segmentContainer}>
                <View style={[styles.segmentWrapper, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <TouchableOpacity
                        style={[styles.segmentButton, filterMode === 'upcoming' && { backgroundColor: theme.tint }]}
                        onPress={() => setFilterMode('upcoming')}
                        activeOpacity={0.8}
                    >
                        <ListFilter size={14} color={filterMode === 'upcoming' ? '#fff' : theme.textSecondary} style={{ marginRight: 6 }} />
                        <Text style={[styles.segmentText, { color: filterMode === 'upcoming' ? '#fff' : theme.textSecondary }]}>
                            Upcoming
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.segmentButton, filterMode === 'past' && { backgroundColor: theme.tint }]}
                        onPress={() => setFilterMode('past')}
                        activeOpacity={0.8}
                    >
                        <Archive size={14} color={filterMode === 'past' ? '#fff' : theme.textSecondary} style={{ marginRight: 6 }} />
                        <Text style={[styles.segmentText, { color: filterMode === 'past' ? '#fff' : theme.textSecondary }]}>
                            Previous
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {isLoading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="large" color={theme.tint} />
                </View>
            ) : (
                <SectionList
                    sections={groupedSlots}
                    keyExtractor={(item) => item._id || item.id}
                    renderItem={renderSlotCard}
                    renderSectionHeader={renderSectionHeader}
                    contentContainerStyle={styles.listContainer}
                    showsVerticalScrollIndicator={false}
                    stickySectionHeadersEnabled={false}
                    ListEmptyComponent={
                        <View style={styles.emptyStateContainer}>
                            <View style={[styles.emptyStateIconWrap, { backgroundColor: theme.cardBackground }]}>
                                {filterMode === 'past' ? (
                                    <Archive size={42} color={theme.textSecondary} opacity={0.6} />
                                ) : (
                                    <Calendar size={42} color={theme.textSecondary} opacity={0.6} />
                                )}
                            </View>
                            <Text style={[styles.emptyStateTitle, { color: theme.text }]}>No {filterMode} slots</Text>
                            <Text style={[styles.emptyStateHint, { color: theme.textSecondary }]}>
                                {filterMode === 'past' 
                                    ? "You don't have any previous slots in the records." 
                                    : "Create some slots to let patients find your availability."}
                            </Text>
                            {filterMode === 'upcoming' && (
                                <TouchableOpacity
                                    style={[styles.emptyStateButton, { borderColor: theme.tint }]}
                                    onPress={() => setIsAddModalVisible(true)}
                                >
                                    <Plus size={16} color={theme.tint} />
                                    <Text style={[styles.emptyStateButtonText, { color: theme.tint }]}>Create First Slot</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    }
                />
            )}

            {/* Add Slot Modal */}
            <Modal
                visible={isAddModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setIsAddModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.cardBackground }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: theme.text }]}>Add New Slot</Text>
                            <TouchableOpacity onPress={() => {
                                setIsAddModalVisible(false);
                                setShowStartTimePicker(false);
                            }}>
                                <X size={24} color={theme.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false}>
                            {/* ---- Date Picker ---- */}
                            <Text style={[styles.label, { color: theme.text }]}>Date</Text>

                            {Platform.OS === 'web' ? (
                                <View style={[styles.pickerButton, { borderColor: theme.borderColor, backgroundColor: theme.background }]}>
                                    <Calendar size={18} color={theme.tint} style={{ marginRight: 10 }} />
                                    <input
                                        type="date"
                                        value={webDateValue || getTodayISO()}
                                        min={getTodayISO()}
                                        onChange={(e: any) => setWebDateValue(e.target.value)}
                                        style={{
                                            flex: 1,
                                            border: 'none',
                                            outline: 'none',
                                            background: 'transparent',
                                            color: theme.text,
                                            fontSize: 16,
                                            fontFamily: 'inherit',
                                            cursor: 'pointer',
                                        }}
                                    />
                                </View>
                            ) : (
                                <>
                                    <TouchableOpacity
                                        style={[styles.pickerButton, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
                                        onPress={() => setShowDatePicker(true)}
                                    >
                                        <Calendar size={18} color={theme.tint} style={{ marginRight: 10 }} />
                                        <Text style={[styles.pickerButtonText, { color: theme.text }]}>
                                            {formatDate(selectedDate)}
                                        </Text>
                                        <ChevronDown size={18} color={theme.textSecondary} />
                                    </TouchableOpacity>

                                    {showDatePicker && (
                                        <View style={{ marginBottom: 12 }}>
                                            <DateTimePicker
                                                value={selectedDate}
                                                mode="date"
                                                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                                                onChange={onDateChange}
                                                minimumDate={new Date()}
                                                themeVariant={colorScheme === 'dark' ? 'dark' : 'light'}
                                            />
                                            {Platform.OS === 'ios' && (
                                                <TouchableOpacity
                                                    style={[styles.confirmPickerButton, { backgroundColor: theme.tint }]}
                                                    onPress={() => setShowDatePicker(false)}
                                                >
                                                    <Text style={{ color: '#fff', fontWeight: '600' }}>Confirm Date</Text>
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    )}
                                </>
                            )}

                            {/* ---- Time Slot Dropdown ---- */}
                            <Text style={[styles.label, { color: theme.text }]}>Time Slot (30 min)</Text>
                            <TouchableOpacity
                                style={[styles.pickerButton, { borderColor: theme.borderColor, backgroundColor: theme.background }]}
                                onPress={() => setShowStartTimePicker(!showStartTimePicker)}
                            >
                                <Clock size={18} color={theme.tint} style={{ marginRight: 10 }} />
                                <Text style={[styles.pickerButtonText, {
                                    color: selectedStartTime ? theme.text : theme.textSecondary
                                }]}>
                                    {selectedStartTime
                                        ? `${selectedStartTime} – ${getEndTime(selectedStartTime)}`
                                        : 'Select time slot'}
                                </Text>
                                <ChevronDown size={18} color={theme.textSecondary} />
                            </TouchableOpacity>

                            {showStartTimePicker && (
                                <View style={[styles.dropdownContainer, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                                    <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled={true}>
                                        {TIME_OPTIONS.map((time) => (
                                            <TouchableOpacity
                                                key={time}
                                                style={[
                                                    styles.dropdownItem,
                                                    selectedStartTime === time && { backgroundColor: theme.tint + '20' }
                                                ]}
                                                onPress={() => {
                                                    setSelectedStartTime(time);
                                                    setShowStartTimePicker(false);
                                                }}
                                            >
                                                <Text style={[
                                                    styles.dropdownItemText,
                                                    { color: theme.text },
                                                    selectedStartTime === time && { color: theme.tint, fontWeight: '700' }
                                                ]}>
                                                    {time} – {getEndTime(time)}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}
                        </ScrollView>

                        {/* Submit Button */}
                        <TouchableOpacity
                            style={[styles.submitButton, { backgroundColor: theme.tint }]}
                            onPress={handleAddSlot}
                            disabled={addSlotMutation.isPending}
                        >
                            {addSlotMutation.isPending ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.submitButtonText}>Create Slot</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </DoctorSafeScreen>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 16,
    },
    headerTitle: {
        fontSize: 26,
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    headerSubtitle: {
        fontSize: 14,
        marginTop: 2,
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 24,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 6,
        elevation: 2,
    },
    addButtonText: {
        color: '#fff',
        fontWeight: '700',
        marginLeft: 6,
        fontSize: 14,
    },
    segmentContainer: {
        paddingHorizontal: 20,
        marginBottom: 8,
    },
    segmentWrapper: {
        flexDirection: 'row',
        borderWidth: 1,
        borderRadius: 12,
        padding: 4,
    },
    segmentButton: {
        flex: 1,
        flexDirection: 'row',
        paddingVertical: 10,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 8,
    },
    segmentText: {
        fontSize: 14,
        fontWeight: '600',
    },
    listContainer: {
        paddingHorizontal: 20,
        paddingBottom: 40,
    },
    sectionHeaderWrap: {
        paddingVertical: 14,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        letterSpacing: -0.2,
    },
    slotCard: {
        flexDirection: 'row',
        borderRadius: 16,
        marginBottom: 14,
        borderWidth: 1,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 8,
        elevation: 1,
    },
    slotBorderLeft: {
        width: 6,
        height: '100%',
    },
    slotContent: {
        flex: 1,
        padding: 16,
    },
    slotTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    timeGroup: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    timeText: {
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: -0.2,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 4,
        marginRight: 6,
    },
    statusText: {
        fontWeight: '700',
        fontSize: 12,
    },
    patientInfoRow: {
        marginTop: 12,
        flexDirection: 'row',
    },
    patientPill: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
    },
    consultLabel: {
        fontSize: 12,
        fontWeight: '500',
    },
    emptyStateContainer: {
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyStateIconWrap: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
    },
    emptyStateTitle: {
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 8,
    },
    emptyStateHint: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
        paddingHorizontal: 40,
        marginBottom: 24,
    },
    emptyStateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 24,
        borderWidth: 1,
    },
    emptyStateButtonText: {
        fontWeight: '600',
        marginLeft: 8,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        padding: 24,
        paddingBottom: Platform.OS === 'ios' ? 40 : 24,
        maxHeight: '85%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    modalTitle: {
        fontSize: 22,
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 8,
        marginLeft: 4,
    },
    pickerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 14,
        height: 56,
        paddingHorizontal: 18,
        marginBottom: 20,
    },
    pickerButtonText: {
        flex: 1,
        fontSize: 16,
        fontWeight: '500',
    },
    confirmPickerButton: {
        alignSelf: 'center',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
        marginTop: 10,
        marginBottom: 10,
    },
    dropdownContainer: {
        borderWidth: 1,
        borderRadius: 14,
        marginTop: -16,
        marginBottom: 20,
        overflow: 'hidden',
    },
    dropdownItem: {
        paddingVertical: 14,
        paddingHorizontal: 18,
    },
    dropdownItemText: {
        fontSize: 15,
        fontWeight: '500',
    },
    submitButton: {
        height: 56,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 16,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 2,
    },
    submitButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    }
});
