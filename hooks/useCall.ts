import { useEffect } from 'react';
import { CallStatus, useCallContext } from '../context/CallContext';

export type { CallStatus };

const isRoomLinkedToCallState = (
    roomId: string,
    activeCallRoomId: string | null,
    boundRoomId: string | null
) => {
    if (!roomId) return false;
    if (activeCallRoomId) return activeCallRoomId === roomId;
    return boundRoomId === roomId;
};

export const useCall = (roomId: string) => {
    const {
        bindRoom,
        boundRoomId,
        activeCallRoomId,
        callStatus,
        callType,
        isCaller,
        agoraToken,
        remoteUid,
        isJoined,
        acceptCall: acceptCallGlobal,
        endCall: endCallGlobal,
        declineCall: declineCallGlobal,
        startCall: startCallGlobal,
        isAudioMuted,
        isVideoMuted,
        isRemoteVideoMuted,
        isSpeakerOn,
        toggleAudio: toggleAudioGlobal,
        toggleVideo: toggleVideoGlobal,
        toggleSpeaker: toggleSpeakerGlobal,
        hasOngoingCall,
    } = useCallContext();

    useEffect(() => {
        if (roomId) {
            bindRoom(roomId);
        }
    }, [bindRoom, roomId]);

    const isRoomLinked = isRoomLinkedToCallState(roomId, activeCallRoomId, boundRoomId);

    const scopedCallStatus: CallStatus = isRoomLinked ? callStatus : 'idle';
    const scopedCallType = isRoomLinked ? callType : null;

    return {
        startCall: async (type: 'audio' | 'video' = 'video') => {
            if (!roomId) {
                throw new Error('Room ID is missing');
            }
            await startCallGlobal(roomId, type);
        },
        callStatus: scopedCallStatus,
        callType: scopedCallType,
        isCaller: isRoomLinked ? isCaller : false,
        agoraToken: isRoomLinked ? agoraToken : null,
        remoteUid: isRoomLinked ? remoteUid : 0,
        isJoined: isRoomLinked ? isJoined : false,
        acceptCall: async () => {
            await acceptCallGlobal(roomId || undefined);
        },
        endCall: async () => {
            await endCallGlobal(roomId || undefined);
        },
        declineCall: async () => {
            await declineCallGlobal(roomId || undefined);
        },
        isAudioMuted: isRoomLinked ? isAudioMuted : false,
        isVideoMuted: isRoomLinked ? isVideoMuted : false,
        isRemoteVideoMuted: isRoomLinked ? isRemoteVideoMuted : false,
        isSpeakerOn: isRoomLinked ? isSpeakerOn : false,
        toggleAudio: () => {
            if (!isRoomLinked) return;
            toggleAudioGlobal();
        },
        toggleVideo: () => {
            if (!isRoomLinked) return;
            toggleVideoGlobal();
        },
        toggleSpeaker: () => {
            if (!isRoomLinked) return;
            toggleSpeakerGlobal();
        },
        activeCallRoomId,
        hasOngoingCall,
    };
};

