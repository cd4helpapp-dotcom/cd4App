import React, { useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
    useColorScheme,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    ArrowLeft,
    MessageCircle,
    Calendar,
    Heart,
    MessageSquare,
    CreditCard,
    Bell,
    Activity,
    AlertTriangle,
    CheckCheck,
} from 'lucide-react-native';

import Colors from '../constants/Colors';
import { useNotificationsSystem } from '../hooks/useNotificationsSystem';
import { useAuthContext } from '../context/AuthContext';
import { AppNotification, NotificationType } from '../src/types';

const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
        case 'chat_message':
            return MessageCircle;
        case 'appointment_update':
            return Calendar;
        case 'community_like':
            return Heart;
        case 'community_comment':
            return MessageSquare;
        case 'payment':
            return CreditCard;
        case 'health_reminder':
            return Activity;
        case 'medical_report_alert':
            return AlertTriangle;
        case 'system':
        default:
            return Bell;
    }
};

const getNotificationColor = (type: NotificationType, tint: string) => {
    switch (type) {
        case 'chat_message':
            return '#4A90E2';
        case 'appointment_update':
            return '#25B26B';
        case 'community_like':
            return '#E05A5A';
        case 'community_comment':
            return '#F5A623';
        case 'payment':
            return '#7B61FF';
        case 'health_reminder':
            return tint;
        case 'medical_report_alert':
            return '#E05A5A';
        case 'system':
        default:
            return '#9AA5B1';
    }
};

const getRelativeTimeLabel = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (dateMidnight.getTime() === today.getTime()) return 'Today';
    if (dateMidnight.getTime() === yesterday.getTime()) return 'Yesterday';

    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const getGroupLabel = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (dateMidnight.getTime() >= today.getTime()) return 'Today';
    if (dateMidnight.getTime() >= yesterday.getTime()) return 'Yesterday';
    return 'Earlier';
};

type GroupedNotifications = {
    title: string;
    data: AppNotification[];
};

export default function NotificationsScreen() {
    const router = useRouter();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'] as typeof Colors.light;
    const insets = useSafeAreaInsets();

    const { user } = useAuthContext();
    const isDoctor = user?.role?.toLowerCase() === 'doctor';

    const {
        notifications,
        unreadCount,
        isLoading,
        refetch,
        markAsRead,
        markAllAsRead,
        isMarkingAllRead,
    } = useNotificationsSystem();

    const grouped = useMemo<GroupedNotifications[]>(() => {
        const groups: Record<string, AppNotification[]> = {};
        const order = ['Today', 'Yesterday', 'Earlier'];

        for (const notif of notifications) {
            const label = getGroupLabel(notif.created_at);
            if (!groups[label]) groups[label] = [];
            groups[label].push(notif);
        }

        return order
            .filter((key) => groups[key] && groups[key].length > 0)
            .map((key) => ({ title: key, data: groups[key] }));
    }, [notifications]);

    const handleNotificationPress = async (notif: AppNotification) => {
        if (!notif.is_read) {
            await markAsRead(notif.id).catch(() => { });
        }

        // Navigate based on type and role
        switch (notif.type) {
            case 'chat_message':
                if (notif.data?.roomId) {
                    router.push({
                        pathname: '/chat-detail',
                        params: {
                            roomId: notif.data.roomId,
                            name: notif.data.senderName || 'Chat',
                        },
                    } as any);
                }
                break;
            case 'appointment_update':
                if (!isDoctor && typeof notif.data?.aiReportId === 'string' && notif.data.aiReportId.trim()) {
                    router.push({
                        pathname: '/report-assistant',
                        params: { reportId: notif.data.aiReportId.trim() },
                    } as any);
                    break;
                }
                router.push(isDoctor ? '/doctor/slots' : '/(tabs)/appointments');
                break;
            case 'community_like':
            case 'community_comment':
                if (notif.data?.postId) {
                    router.push(`/community/post/${notif.data.postId}` as any);
                } else {
                    router.push(isDoctor ? '/doctor/community' : '/(tabs)/community');
                }
                break;
            case 'health_reminder':
                router.push(isDoctor ? '/doctor/dashboard' : '/(tabs)');
                break;
            case 'medical_report_alert':
                if (typeof notif.data?.reportId === 'string' && notif.data.reportId.trim()) {
                    router.push({
                        pathname: '/report-assistant',
                        params: { reportId: notif.data.reportId.trim() },
                    } as any);
                } else {
                    router.push('/report-assistant');
                }
                break;
            default:
                break;
        }
    };

    const renderNotificationItem = ({ item }: { item: AppNotification }) => {
        const IconComp = getNotificationIcon(item.type);
        const iconColor = getNotificationColor(item.type, theme.tint);

        return (
            <TouchableOpacity
                style={[
                    styles.notifItem,
                    {
                        backgroundColor: item.is_read ? theme.background : theme.cardBackground,
                        borderBottomColor: theme.borderColor,
                    },
                ]}
                activeOpacity={0.8}
                onPress={() => handleNotificationPress(item)}
            >
                <View style={[styles.notifIconWrap, { backgroundColor: iconColor + '18' }]}>
                    <IconComp size={20} color={iconColor} />
                </View>
                <View style={styles.notifContent}>
                    <Text
                        style={[
                            styles.notifTitle,
                            { color: theme.text, fontWeight: item.is_read ? '500' : '700' },
                        ]}
                        numberOfLines={1}
                    >
                        {item.title}
                    </Text>
                    <Text
                        style={[styles.notifBody, { color: theme.textSecondary }]}
                        numberOfLines={2}
                    >
                        {item.body}
                    </Text>
                    <Text style={[styles.notifTime, { color: theme.textSecondary }]}>
                        {getRelativeTimeLabel(item.created_at)}
                    </Text>
                </View>
                {!item.is_read && <View style={[styles.unreadDot, { backgroundColor: theme.tint }]} />}
            </TouchableOpacity>
        );
    };

    const renderSectionHeader = (title: string) => (
        <View style={[styles.sectionHeader, { backgroundColor: theme.background }]}>
            <Text style={[styles.sectionHeaderText, { color: theme.textSecondary }]}>{title}</Text>
        </View>
    );

    // Flatten grouped data with section headers for FlatList
    const flatData = useMemo(() => {
        const result: (AppNotification | { _sectionHeader: string })[] = [];
        for (const group of grouped) {
            result.push({ _sectionHeader: group.title });
            result.push(...group.data);
        }
        return result;
    }, [grouped]);

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View
                style={[
                    styles.header,
                    {
                        paddingTop: insets.top + 8,
                        borderBottomColor: theme.borderColor,
                        backgroundColor: theme.background,
                    },
                ]}
            >
                <TouchableOpacity
                    style={[styles.backBtn, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                    onPress={() => router.back()}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                    <ArrowLeft size={20} color={theme.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Notifications</Text>
                {unreadCount > 0 ? (
                    <TouchableOpacity
                        style={[styles.markAllBtn, { backgroundColor: theme.tint + '15' }]}
                        onPress={() => markAllAsRead()}
                        disabled={isMarkingAllRead}
                        activeOpacity={0.8}
                    >
                        {isMarkingAllRead ? (
                            <ActivityIndicator size="small" color={theme.tint} />
                        ) : (
                            <>
                                <CheckCheck size={14} color={theme.tint} />
                                <Text style={[styles.markAllText, { color: theme.tint }]}>Read all</Text>
                            </>
                        )}
                    </TouchableOpacity>
                ) : (
                    <View style={{ width: 80 }} />
                )}
            </View>

            {/* Content */}
            {isLoading ? (
                <View style={styles.loaderWrap}>
                    <ActivityIndicator size="large" color={theme.tint} />
                </View>
            ) : notifications.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Bell size={56} color={theme.textSecondary} style={{ opacity: 0.25, marginBottom: 16 }} />
                    <Text style={[styles.emptyTitle, { color: theme.text }]}>No notifications yet</Text>
                    <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                        You'll see messages, appointments, community activity and more here.
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={flatData}
                    keyExtractor={(item, index) =>
                        '_sectionHeader' in item ? `header-${(item as any)._sectionHeader}` : (item as AppNotification).id
                    }
                    renderItem={({ item }) => {
                        if ('_sectionHeader' in item) {
                            return renderSectionHeader((item as any)._sectionHeader);
                        }
                        return renderNotificationItem({ item: item as AppNotification });
                    }}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
                    refreshControl={
                        <RefreshControl
                            refreshing={false}
                            onRefresh={refetch}
                            tintColor={theme.tint}
                            colors={[theme.tint]}
                        />
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 14,
        borderBottomWidth: 1,
    },
    backBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '800',
        letterSpacing: -0.3,
    },
    markAllBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 16,
    },
    markAllText: {
        fontSize: 12,
        fontWeight: '700',
    },
    loaderWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 8,
    },
    emptySubtitle: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
        opacity: 0.7,
    },
    sectionHeader: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        paddingTop: 18,
    },
    sectionHeaderText: {
        fontSize: 13,
        fontWeight: '800',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    notifItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 14,
    },
    notifIconWrap: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    notifContent: {
        flex: 1,
    },
    notifTitle: {
        fontSize: 15,
        marginBottom: 3,
    },
    notifBody: {
        fontSize: 13,
        lineHeight: 18,
        opacity: 0.85,
    },
    notifTime: {
        fontSize: 11,
        marginTop: 6,
        opacity: 0.6,
    },
    unreadDot: {
        width: 9,
        height: 9,
        borderRadius: 5,
        marginTop: 8,
    },
});
