import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Image, Dimensions, Animated } from 'react-native';
import { supabase } from '../src/lib/supabase';
import { useAuthContext } from '../context/AuthContext';
import { useCallContext } from '../context/CallContext';
import { useRouter } from 'expo-router';
import { Phone, Video } from 'lucide-react-native';
import { getActiveRoomId } from '../hooks/usePushNotifications';

const { width, height } = Dimensions.get('window');

interface IncomingCall {
    id: string;
    room_id: string;
    caller_id: string;
    type: 'audio' | 'video';
    status: string;
    callerName?: string;
    callerPhone?: string;
    callerAvatar?: string;
}

export default function GlobalCallObserver() {
    const { user } = useAuthContext();
    const { bindRoom } = useCallContext();
    const router = useRouter();
    
    const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const bindRoomRef = useRef(bindRoom);

    useEffect(() => {
        bindRoomRef.current = bindRoom;
    }, [bindRoom]);

    useEffect(() => {
        const userId = user?.id;
        if (!userId) {
            setIncomingCall(null);
            return;
        }

        // Active pulse animation for incoming call avatars
        const startPulse = () => {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.15,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    })
                ])
            ).start();
        };

        const checkExistingCalls = async () => {
            const { data, error } = await supabase
                .from('call_sessions')
                .select('*')
                .eq('status', 'ringing')
                .neq('caller_id', userId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
                
            if (data && !error) {
                bindRoomRef.current(data.room_id);

                // Don't show global overlay if user is already in that chat room
                const activeRoom = getActiveRoomId();
                if (activeRoom && activeRoom === data.room_id) return;
                
                // Instantly show modal while fetching details
                setIncomingCall(data as IncomingCall);
                fetchCallerDetails(data);
            }
        };

        const channel = supabase
            .channel('global_call_sessions')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'call_sessions'
            }, async (payload: any) => {
                const session = payload.new;
                
                // If it's not a new/updated record we care about, exit
                if (!session || !session.id) return;

                // 1. If ringing and we are the receiver (not the caller)
                if (session.status === 'ringing' && session.caller_id !== userId) {
                    bindRoomRef.current(session.room_id);
                    
                    // Don't show global overlay if user is already in that chat room
                    const activeRoom = getActiveRoomId();
                    if (activeRoom && activeRoom === session.room_id) return;
                    
                    // Prevent showing screen if we are already seeing this call
                    setIncomingCall(current => {
                        if (current && current.id === session.id) return current;
                        
                        // Otherwise, fetch caller details and trigger modal
                        fetchCallerDetails(session);
                        return session as IncomingCall;
                    });
                    
                } 
                // 2. If the call was cancelled, answered somewhere else, or ended, dismiss
                else if (['active', 'ended', 'declined', 'missed'].includes(session.status)) {
                    setIncomingCall(current => {
                        if (current && current.id === session.id) {
                            return null;
                        }
                        return current;
                    });
                }
            })
            .subscribe();

        startPulse(); // Prepare animation
        checkExistingCalls(); // Check for calls already ringing on app boot

        return () => {
            supabase.removeChannel(channel);
            pulseAnim.stopAnimation();
        };
    }, [pulseAnim, user?.id]);

    const fetchCallerDetails = async (session: any) => {
        try {
            // First look up simple profile
            const { data: profile } = await supabase
                .from('profiles')
                .select('first_name, last_name, profile_picture')
                .eq('id', session.caller_id)
                .single();

            const fullName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : 'Unknown Caller';

            setIncomingCall(prev => {
                if (!prev || prev.id !== session.id) return prev;
                return {
                    ...prev,
                    callerName: fullName || 'Unknown Caller',
                    callerAvatar: profile?.profile_picture
                };
            });
        } catch (error) {
            console.error('Failed to fetch caller profile for incoming call:', error);
        }
    };

    const handleAccept = () => {
        if (!incomingCall) return;
        const targetRoom = incomingCall.room_id;
        setIncomingCall(null);
        
        // Navigate to the chat detail safely with autoAccept
        router.push({
            pathname: '/chat-detail',
            params: { 
                roomId: targetRoom, 
                autoAccept: 'true' 
            }
        });
    };

    const handleDecline = async () => {
        if (!incomingCall) return;
        const callId = incomingCall.id;
        setIncomingCall(null);

        try {
            await supabase
                .from('call_sessions')
                .update({ status: 'declined' })
                .eq('id', callId);
        } catch (error) {
            console.error('Error declining call from global overlay:', error);
        }
    };

    if (!incomingCall) return null;

    return (
        <Modal
            transparent
            visible={!!incomingCall}
            animationType="fade"
            onRequestClose={handleDecline} // Hardware back declines
        >
            <View style={styles.container}>
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20, 25, 30, 0.95)' }]}>
                    {incomingCall.callerAvatar && (
                        <Image source={{ uri: incomingCall.callerAvatar }} style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} blurRadius={15} />
                    )}
                </View>

                <View style={styles.content}>
                    <View style={styles.topSection}>
                        <Text style={styles.callTypeLabel}>
                            CD4 {incomingCall.type === 'video' ? 'Video' : 'Voice'} Call
                        </Text>
                        <Text style={styles.incomingLabel}>Incoming...</Text>
                    </View>

                    <View style={styles.centerSection}>
                        <Animated.View style={[styles.avatarPulseRing, { transform: [{ scale: pulseAnim }] }]}>
                            {incomingCall.callerAvatar ? (
                                <Image source={{ uri: incomingCall.callerAvatar }} style={styles.avatar} />
                            ) : (
                                <View style={styles.avatarPlaceholder}>
                                    <Text style={styles.avatarInitial}>
                                        {incomingCall.callerName ? incomingCall.callerName.charAt(0).toUpperCase() : '?'}
                                    </Text>
                                </View>
                            )}
                        </Animated.View>
                        <Text style={styles.callerName} numberOfLines={2}>
                            {incomingCall.callerName || 'Unknown'}
                        </Text>
                    </View>

                    <View style={styles.bottomSection}>
                        <View style={styles.actionRow}>
                            <TouchableOpacity style={styles.declineButton} onPress={handleDecline} activeOpacity={0.8}>
                                <View style={[styles.buttonIconBoundary, { backgroundColor: '#EF4444' }]}>
                                    <Phone size={32} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} />
                                </View>
                                <Text style={styles.actionLabel}>Decline</Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.acceptButton} onPress={handleAccept} activeOpacity={0.8}>
                                <View style={[styles.buttonIconBoundary, { backgroundColor: '#22C55E' }]}>
                                    {incomingCall.type === 'video' ? (
                                        <Video size={32} color="#FFF" />
                                    ) : (
                                        <Phone size={32} color="#FFF" />
                                    )}
                                </View>
                                <Text style={styles.actionLabel}>Accept</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        width,
        height,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 99999,
    },
    content: {
        flex: 1,
        width: '100%',
        paddingVertical: 60,
        paddingHorizontal: 24,
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    topSection: {
        alignItems: 'center',
        marginTop: 40,
    },
    callTypeLabel: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: 2,
        textTransform: 'uppercase',
        marginBottom: 8,
    },
    incomingLabel: {
        color: '#FFFFFF',
        fontSize: 28,
        fontWeight: '300',
    },
    centerSection: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarPulseRing: {
        width: 160,
        height: 160,
        borderRadius: 80,
        backgroundColor: 'rgba(255,255,255,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
    },
    avatar: {
        width: 140,
        height: 140,
        borderRadius: 70,
        borderWidth: 3,
        borderColor: '#FFFFFF',
    },
    avatarPlaceholder: {
        width: 140,
        height: 140,
        borderRadius: 70,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderWidth: 3,
        borderColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarInitial: {
        fontSize: 64,
        fontWeight: 'bold',
        color: '#FFFFFF',
    },
    callerName: {
        color: '#FFFFFF',
        fontSize: 32,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    bottomSection: {
        width: '100%',
        alignItems: 'center',
        marginBottom: 40,
    },
    actionRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        width: '100%',
        paddingHorizontal: 20,
    },
    declineButton: {
        alignItems: 'center',
    },
    acceptButton: {
        alignItems: 'center',
    },
    buttonIconBoundary: {
        width: 72,
        height: 72,
        borderRadius: 36,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
        marginBottom: 12,
    },
    actionLabel: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.5,
    }
});
