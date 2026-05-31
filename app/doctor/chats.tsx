import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, useColorScheme, TextInput, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Colors from '../../constants/Colors';
import { getImageUrl } from '../../constants/Config';
import { MessageCircle, Search, X } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useChatRooms, prefetchChatMessages } from '../../hooks/useChat';
import DoctorSafeScreen from '../../ui/doctor/DoctorSafeScreen';
import { useAuthContext } from '../../context/AuthContext';
import { useTabSwipeNavigation } from '../../hooks/useTabSwipeNavigation';

export default function DoctorChats() {
    const router = useRouter();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const { data: rooms = [], isFetching } = useChatRooms();
    const queryClient = useQueryClient();
    const { user } = useAuthContext();

    const [searchQuery, setSearchQuery] = useState('');
    const [brokenAvatarByRoomId, setBrokenAvatarByRoomId] = useState<Record<string, boolean>>({});
    const tabSwipeHandlers = useTabSwipeNavigation('doctor-chats');

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

    const showInitialSyncState = isFetching && rooms.length === 0 && !searchQuery.trim();

    // Filter rooms based on search query
    const filteredRooms = useMemo(() => {
        if (!searchQuery.trim()) return rooms;
        const q = searchQuery.toLowerCase().trim();
        return rooms.filter((room: any) => {
            const name = `${room.other_party?.firstName || ''} ${room.other_party?.lastName || ''}`.toLowerCase();
            const lastMsg = (room.last_message_text || '').toLowerCase();
            return name.includes(q) || lastMsg.includes(q);
        });
    }, [rooms, searchQuery]);

    const formatWhatsAppDate = (dateString: string) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return date.toLocaleDateString([], { weekday: 'short' });
        } else {
            return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
        }
    };

    const renderChat = ({ item }: { item: any }) => {
        const unreadCount = item.unread_count_doctor || 0;
        const firstName = item.other_party?.firstName || '';
        const lastName = item.other_party?.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';
        const isRoomEnabled = item.chat_enabled !== false;
        const disabledReason = item.chat_disabled_reason || 'Chat disabled';
        const previewText = isRoomEnabled ? (item.last_message_text || 'No messages yet') : disabledReason;
        const profileImageUrl = brokenAvatarByRoomId[item.id]
            ? null
            : getImageUrl(item.other_party?.profilePicture);

        return (
            <TouchableOpacity
                style={[styles.chatItem, { borderBottomColor: theme.borderColor + '40' }]}
                activeOpacity={0.6}
                disabled={!isRoomEnabled}
                onPress={() => router.push({
                    pathname: '/chat-detail',
                    params: { roomId: item.id, name: fullName, otherId: item.other_party?.id }
                })}
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
                                {firstName.charAt(0).toUpperCase()}
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
        <DoctorSafeScreen backgroundColor={theme.background} panHandlers={tabSwipeHandlers}>
            {/* Header */}
            <View style={styles.headerContainer}>
                <Text style={[styles.headerTitle, { color: theme.text }]}>Patient Chats</Text>
            </View>

            {/* Search Bar */}
            <View style={styles.searchContainer}>
                <View style={[styles.searchBar, { backgroundColor: theme.cardBackground }]}>
                    <Search size={18} color={theme.textSecondary} />
                    <TextInput
                        style={[styles.searchInput, { color: theme.text }]}
                        placeholder="Search patients..."
                        placeholderTextColor={theme.textSecondary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
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
            {showInitialSyncState ? (
                <View style={styles.emptyState}>
                    <Text style={{ color: theme.textSecondary }}>Syncing chats...</Text>
                </View>
            ) : filteredRooms.length === 0 ? (
                <View style={styles.emptyState}>
                    <MessageCircle size={48} color={theme.textSecondary} />
                    <Text style={{ marginTop: 16, fontSize: 16, fontWeight: '600', color: theme.text }}>
                        {searchQuery.trim() ? 'No matching chats' : 'No conversations yet'}
                    </Text>
                    <Text style={{ marginTop: 6, fontSize: 13, color: theme.textSecondary, textAlign: 'center' }}>
                        {searchQuery.trim() ? 'Try a different search term' : 'Patients who start a chat with you will appear here'}
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={filteredRooms}
                    keyExtractor={(item) => item.id}
                    renderItem={renderChat}
                    contentContainerStyle={{ paddingHorizontal: 16 }}
                    showsVerticalScrollIndicator={false}
                />
            )}
        </DoctorSafeScreen>
    );
}

const styles = StyleSheet.create({
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
