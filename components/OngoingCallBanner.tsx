import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Phone, PhoneCall, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../constants/Colors';
import { useCallContext } from '../context/CallContext';

const getBannerLabel = (status: 'ringing' | 'active', type: 'audio' | 'video' | null) => {
    if (status === 'ringing') {
        return type === 'video' ? 'Video call ringing' : 'Audio call ringing';
    }
    return type === 'video' ? 'Video call in progress' : 'Audio call in progress';
};

export default function OngoingCallBanner() {
    const router = useRouter();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const {
        hasOngoingCall,
        activeCallRoomId,
        callStatus,
        callType,
        endCall,
    } = useCallContext();

    // Banner should never render on chat-detail screen itself.
    // It is only meant as a "return to call" affordance on other screens/tabs.
    const isOnChatDetailScreen = pathname.endsWith('/chat-detail');

    if (!hasOngoingCall || !activeCallRoomId) return null;
    if (callStatus !== 'ringing') return null;
    if (isOnChatDetailScreen) return null;

    const label = getBannerLabel(callStatus, callType);

    return (
        <View
            pointerEvents="box-none"
            style={[
                styles.wrapper,
                {
                    top: insets.top + 8,
                },
            ]}
        >
            <View
                style={[
                    styles.banner,
                    {
                        backgroundColor: '#0B121A',
                        borderColor: '#1C2A3A',
                    },
                ]}
            >
                <TouchableOpacity
                    style={styles.left}
                    activeOpacity={0.9}
                    onPress={() => {
                        router.push({
                            pathname: '/chat-detail',
                            params: { roomId: activeCallRoomId, resumeCall: 'true' },
                        });
                    }}
                >
                    <View style={styles.iconWrap}>
                        {callType === 'video' ? <PhoneCall size={15} color="#fff" /> : <Phone size={15} color="#fff" />}
                    </View>
                    <View>
                        <Text style={styles.title}>{label}</Text>
                        <Text style={[styles.subtitle, { color: '#9AB0C7' }]}>Tap to return to call</Text>
                    </View>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.endButton, { backgroundColor: theme.error }]}
                    onPress={() => {
                        void endCall(activeCallRoomId);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <X size={14} color="#fff" />
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        position: 'absolute',
        left: 12,
        right: 12,
        zIndex: 4000,
        elevation: 30,
    },
    banner: {
        borderRadius: 14,
        borderWidth: 1,
        paddingVertical: 10,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
    },
    left: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 12,
    },
    iconWrap: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: 'rgba(255,255,255,0.16)',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    title: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
    },
    subtitle: {
        fontSize: 12,
        marginTop: 2,
    },
    endButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
