/**
 * Web mock for useCall hook.
 * Audio/video calling is not supported in this project on web.
 */
export const useCall = (_roomId: string) => {
    return {
        startCall: async (_type: 'audio' | 'video' = 'video') => {
            console.warn('Video/Audio calls are not supported on web.');
            return null;
        },
        callStatus: 'idle' as const,
        callType: null as 'audio' | 'video' | null,
        isCaller: false,
        agoraToken: null as string | null,
        remoteUid: 0,
        isJoined: false,
        acceptCall: async () => { },
        endCall: async () => { },
        declineCall: async () => { },
        isAudioMuted: false,
        isVideoMuted: false,
        isRemoteVideoMuted: false,
        isSpeakerOn: false,
        toggleAudio: () => { },
        toggleVideo: () => { },
        toggleSpeaker: () => { },
        activeCallRoomId: null as string | null,
        hasOngoingCall: false,
    };
};

