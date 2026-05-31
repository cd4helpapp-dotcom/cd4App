import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useColorScheme, FlatList, TextInput, RefreshControl, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../../constants/Colors';
import { getImageUrl } from '../../constants/Config';
import { Search, MessageCircle, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useChatRooms, prefetchChatMessages } from '../../hooks/useChat';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';
import { useAuthContext } from '../../context/AuthContext';
import { ChatTabSkeleton } from '../../ui/common/TabLoadingSkeletons';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { getLocalizedDoctorName } from '../../src/i18n/nameLocalization';
import { useDeferredFocusSync } from '../../hooks/useDeferredFocusSync';

export default function ChatScreen() {
    const router = useRouter();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const { t, language } = useAppLanguage();
    const insets = useSafeAreaInsets();
    const tabSwipeHandlers = useTabSwipeNavigation('chat');

    const { data: rooms = [], refetch, isLoading } = useChatRooms();
    const queryClient = useQueryClient();
    const { user } = useAuthContext();

    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [brokenAvatarByRoomId, setBrokenAvatarByRoomId] = useState<Record<string, boolean>>({});
    const [isPullRefreshing, setIsPullRefreshing] = useState(false);
    const [isTabSwitchLoading, setIsTabSwitchLoading] = useState(false);

    // Prefetch top 5 most recent chat rooms instantly in the background
    React.useEffect(() => {
        if (rooms.length > 0) {
            rooms
                .filter((room: any) => room.chat_enabled !== false)
                .slice(0, 5)
                .forEach(room => {
                    prefetchChatMessages(queryClient, room.id, 40, user?.id).catch(() => {});
                });
        }
    }, [rooms, queryClient, user?.id]);

    const handleRefresh = React.useCallback(async () => {
        if (isPullRefreshing) return;
        setIsPullRefreshing(true);
        try {
            await refetch();
        } finally {
            setIsPullRefreshing(false);
        }
    }, [isPullRefreshing, refetch]);

    const syncChatOnFocus = React.useCallback(async () => {
        await refetch();
    }, [refetch]);
    const shouldShowChatInitialLoading = React.useCallback(
        () => rooms.length === 0,
        [rooms.length]
    );
    const showChatInitialLoading = React.useCallback(() => setIsTabSwitchLoading(true), []);
    const hideChatInitialLoading = React.useCallback(() => setIsTabSwitchLoading(false), []);

    useDeferredFocusSync({
        sync: syncChatOnFocus,
        shouldShowInitialLoading: shouldShowChatInitialLoading,
        onInitialLoadingStart: showChatInitialLoading,
        onInitialLoadingEnd: hideChatInitialLoading,
    });

    const showTabSyncSkeleton = (isTabSwitchLoading || (isLoading && rooms.length === 0)) && !isPullRefreshing && !searchQuery.trim();
    const getRoomDoctorDisplayName = React.useCallback(
        (room: any) =>
            getLocalizedDoctorName(
                {
                    firstName: room?.other_party?.firstName,
                    lastName: room?.other_party?.lastName,
                },
                language,
                { fallbackName: t('chat.unknown') }
            ),
        [language, t]
    );

    // Filter rooms based on search query
    const filteredRooms = useMemo(() => {
        if (!searchQuery.trim()) return rooms;
        const q = searchQuery.toLowerCase().trim();
        return rooms.filter((room: any) => {
            const name = getRoomDoctorDisplayName(room).toLowerCase();
            const lastMsg = (room.last_message_text || '').toLowerCase();
            return name.includes(q) || lastMsg.includes(q);
        });
    }, [getRoomDoctorDisplayName, rooms, searchQuery]);

    const formatWhatsAppDate = (dateString: string) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return t('chat.yesterday');
        } else if (diffDays < 7) {
            return date.toLocaleDateString([], { weekday: 'short' });
        } else {
            return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
        }
    };

    const renderRoom = ({ item }: { item: any }) => {
        const unreadCount = item.unread_count_patient || 0;
        const fullName = getRoomDoctorDisplayName(item);
        const isRoomEnabled = item.chat_enabled !== false;
        const disabledReason = item.chat_disabled_reason || t('chat.disabled');
        const previewText = isRoomEnabled ? (item.last_message_text || t('chat.noMessagesYet')) : disabledReason;
        const profileImageUrl = brokenAvatarByRoomId[item.id]
            ? null
            : getImageUrl(item.other_party?.profilePicture);

        return (
            <TouchableOpacity
                style={[styles.chatItem, { borderBottomColor: theme.borderColor + '40' }]}
                activeOpacity={0.6}
                disabled={!isRoomEnabled}
                onPress={() => {
                    router.push({
                        pathname: '/chat-detail',
                        params: { roomId: item.id, name: fullName, otherId: item.other_party?.id }
                    });
                }}
            >
                {/* Avatar */}
                <View>
                    <View style={[styles.avatar, { backgroundColor: theme.tint + '18', opacity: isRoomEnabled ? 1 : 0.55 }]}>
                        {profileImageUrl ? (
                            <Image
                                source={{ uri: profileImageUrl }}
                                style={styles.avatarImage}
                                onError={() =>
                                    setBrokenAvatarByRoomId((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: true }))
                                }
                            />
                        ) : (
                            <Text style={{ fontSize: 20, fontWeight: '700', color: theme.tint }}>
                                {(fullName || t('chat.unknown')).charAt(0).toUpperCase()}
                            </Text>
                        )}
                    </View>
                    {/* Online indicator temporarily disabled */}
                </View>

                {/* Content */}
                <View style={[styles.chatContent, { opacity: isRoomEnabled ? 1 : 0.68 }]}>
                    <View style={styles.chatRow}>
                        <Text numberOfLines={1} style={[styles.name, { color: theme.text, flex: 1, marginRight: 8 }]}>
                            {fullName}
                        </Text>
                        <Text style={[styles.time, { 
                            color: unreadCount > 0 ? theme.tint : theme.textSecondary, 
                            fontWeight: unreadCount > 0 ? '700' : '400' 
                        }]}>
                            {formatWhatsAppDate(item.last_message_at)}
                        </Text>
                    </View>
                    <View style={[styles.chatRow, { marginTop: 4 }]}>
                        <Text numberOfLines={1} style={[styles.lastMsg, { 
                            color: unreadCount > 0 ? theme.text : theme.textSecondary, 
                            fontWeight: unreadCount > 0 ? '500' : '400',
                            flex: 1, 
                            marginRight: 8 
                        }]}>
                            {previewText}
                        </Text>
                        {unreadCount > 0 && isRoomEnabled && (
                            <View style={[styles.badge, { backgroundColor: theme.tint }]}>
                                <Text style={styles.badgeText}>{unreadCount}</Text>
                            </View>
                        )}
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View {...tabSwipeHandlers} style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.headerContainer}>
                <Text style={[styles.headerTitle, { color: theme.text }]}>{t('tab.chat')}</Text>
            </View>

            {/* Search Bar */}
            <View style={styles.searchContainer}>
                <View style={[styles.searchBar, { backgroundColor: theme.cardBackground }]}>
                    <Search size={18} color={theme.textSecondary} />
                    <TextInput
                        style={[styles.searchInput, { color: theme.text }]}
                        placeholder={t('chat.searchDoctors')}
                        placeholderTextColor={theme.textSecondary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        onFocus={() => setIsSearchFocused(true)}
                        onBlur={() => setIsSearchFocused(false)}
                        returnKeyType="search"
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <X size={18} color={theme.textSecondary} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Chat List */}
            {showTabSyncSkeleton ? (
                <ChatTabSkeleton theme={theme} />
            ) : filteredRooms.length === 0 ? (
                <View style={styles.emptyState}>
                    <MessageCircle size={48} color={theme.textSecondary} />
                    <Text style={{ marginTop: 16, fontSize: 16, fontWeight: '600', color: theme.text }}>
                        {searchQuery.trim() ? t('chat.noMatchingChats') : t('chat.noConversationsYet')}
                    </Text>
                    <Text style={{ marginTop: 6, fontSize: 13, color: theme.textSecondary, textAlign: 'center' }}>
                        {searchQuery.trim() ? t('chat.tryDifferentSearch') : t('chat.bookToStart')}
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={filteredRooms}
                    keyExtractor={(item) => item.id}
                    renderItem={renderRoom}
                    contentContainerStyle={{ paddingHorizontal: 16 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={isPullRefreshing}
                            onRefresh={handleRefresh}
                            colors={[theme.tint]}
                            tintColor={theme.tint}
                        />
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    headerContainer: {
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 4,
    },
    headerTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
    searchContainer: {
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
    },
    searchInput: {
        flex: 1,
        marginLeft: 10,
        fontSize: 15,
        paddingVertical: 0,
    },
    chatItem: {
        flexDirection: 'row',
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
    },
    avatar: {
        width: 52,
        height: 52,
        borderRadius: 26,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarImage: {
        width: '100%',
        height: '100%',
    },
    chatContent: { flex: 1, marginLeft: 14, justifyContent: 'center' },
    chatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    name: { fontSize: 16, fontWeight: '600' },
    time: { fontSize: 12 },
    lastMsg: { fontSize: 14 },
    badge: {
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 6,
    },
    badgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    onlineIndicator: {
        position: 'absolute',
        right: 1,
        bottom: 1,
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: '#22c55e',
        borderWidth: 2.5,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
    },
});
