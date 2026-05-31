import React, { useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Maximize2, Phone, Video, X } from 'lucide-react-native';
import Colors from '../constants/Colors';
import { useCallContext } from '../context/CallContext';
import { RtcSurfaceView } from '../src/lib/agora';

const clamp = (value: number, min: number, max: number) => {
    'worklet';
    return Math.min(Math.max(value, min), max);
};

export default function GlobalCallPiP() {
    const router = useRouter();
    const pathname = usePathname();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const {
        callStatus,
        callType,
        activeCallRoomId,
        remoteUid,
        isJoined,
        isRemoteVideoMuted,
        endCall,
    } = useCallContext();

    const isOnChatDetailScreen = pathname.endsWith('/chat-detail');

    if (callStatus !== 'active' || !activeCallRoomId || isOnChatDetailScreen) return null;

    const pan = useRef(new Animated.ValueXY({ x: 220, y: 160 })).current;
    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_evt, gestureState) =>
                Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3,
            onPanResponderGrant: () => {
                pan.extractOffset();
            },
            onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
                useNativeDriver: false,
            }),
            onPanResponderRelease: (_evt, gestureState) => {
                pan.flattenOffset();
                const snapX = clamp((pan.x as any).__getValue(), 8, 280);
                const snapY = clamp((pan.y as any).__getValue(), 80, 520);
                Animated.spring(pan, {
                    toValue: { x: snapX, y: snapY },
                    useNativeDriver: false,
                    bounciness: 6,
                }).start();
            },
        })
    ).current;

    const showRemoteVideo =
        callType === 'video' &&
        remoteUid !== 0 &&
        isJoined &&
        !!RtcSurfaceView &&
        !isRemoteVideoMuted;

    return (
        <Animated.View
            {...panResponder.panHandlers}
            style={[
                styles.container,
                {
                    transform: [{ translateX: pan.x }, { translateY: pan.y }],
                },
            ]}
        >
            <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={0.95}
                onPress={() => {
                    router.push({
                        pathname: '/chat-detail',
                        params: { roomId: activeCallRoomId, resumeCall: 'true' },
                    });
                }}
            >
                {showRemoteVideo ? (
                    <RtcSurfaceView
                        canvas={{ uid: remoteUid }}
                        style={StyleSheet.absoluteFill}
                    />
                ) : (
                    <View style={[StyleSheet.absoluteFill, styles.fallback, { backgroundColor: '#111A25' }]}>
                        <View style={[styles.iconWrap, { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
                            {callType === 'video' ? <Video size={16} color="#fff" /> : <Phone size={16} color="#fff" />}
                        </View>
                        <Text style={styles.fallbackTitle}>{callType === 'video' ? 'Video Call' : 'Audio Call'}</Text>
                        <Text style={styles.fallbackSubtitle}>Tap to return</Text>
                    </View>
                )}
            </TouchableOpacity>

            <View style={styles.controls}>
                <TouchableOpacity
                    style={[styles.controlButton, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
                    onPress={() => {
                        router.push({
                            pathname: '/chat-detail',
                            params: { roomId: activeCallRoomId, resumeCall: 'true' },
                        });
                    }}
                >
                    <Maximize2 size={14} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.controlButton, { backgroundColor: theme.error }]}
                    onPress={() => {
                        void endCall(activeCallRoomId);
                    }}
                >
                    <X size={14} color="#fff" />
                </TouchableOpacity>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        width: 124,
        height: 188,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        backgroundColor: '#000',
        zIndex: 5000,
        elevation: 35,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
    },
    fallback: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 8,
    },
    iconWrap: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    fallbackTitle: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
    },
    fallbackSubtitle: {
        color: '#AFC1D4',
        fontSize: 11,
        marginTop: 3,
    },
    controls: {
        position: 'absolute',
        right: 6,
        top: 6,
        flexDirection: 'column',
        gap: 6,
    },
    controlButton: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
