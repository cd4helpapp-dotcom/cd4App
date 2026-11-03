package com.cd4.backend.modules.calls.services;

import com.cd4.backend.config.AppProperties;
import com.cd4.backend.modules.calls.dtos.CallDtos.CallResponse;
import com.cd4.backend.modules.calls.dtos.CallDtos.CallTokenResponse;
import com.cd4.backend.modules.calls.models.CallSession;
import com.cd4.backend.modules.calls.repositories.CallSessionRepository;
import com.cd4.backend.modules.chat.models.ChatRoom;
import com.cd4.backend.modules.chat.services.ChatService;
import com.cd4.backend.modules.notifications.services.NotificationService;
import com.cd4.backend.modules.users.models.Profile;
import com.cd4.backend.modules.users.repositories.ProfileRepository;
import com.cd4.backend.utils.ApiError;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CallService {
    private static final Duration RING_TIMEOUT = Duration.ofSeconds(45);
    private static final Duration MAX_ACTIVE = Duration.ofHours(3);
    private static final int TOKEN_SECONDS = 3600;
    private static final String CALLS_CHANNEL = "calls_ringtone_v3";

    private final CallSessionRepository calls;
    private final ChatService chatService;
    private final NotificationService notifications;
    private final ProfileRepository profiles;
    private final AppProperties properties;

    /** The partial unique index on call_sessions is what stops two live calls in one room, even when both people dial together. */
    public CallResponse start(UUID roomId, UUID callerId, String type) {
        ChatRoom room = chatService.requireRoom(roomId, callerId);
        ChatService.Window window = chatService.chatWindow(room.getPatientId(), room.getDoctorId());
        // Checked here, on the server, so a modified app cannot call outside the consultation window.
        if (!window.enabled()) {
            throw ApiError.conflict("chat_closed", window.reason());
        }
        CallSession session = new CallSession();
        session.setRoomId(roomId);
        session.setCallerId(callerId);
        session.setType(type);
        try {
            calls.saveAndFlush(session);
        } catch (DataIntegrityViolationException alreadyLive) {
            throw ApiError.conflict("call_in_progress", "A call is already in progress in this chat.");
        }
        CallResponse response = CallResponse.of(session);
        chatService.publish(roomId, "call.ringing", response);
        Profile caller = profiles.findById(callerId).orElse(null);
        String label = "video".equals(type) ? "video" : "voice";
        notifications.pushOnly(room.otherParty(callerId), caller == null ? "CD4" : caller.fullName(), "Incoming " + label + " call",
            Map.of("type", "incoming_call", "roomId", roomId.toString(), "callId", session.getId().toString(), "callType", type),
            CALLS_CHANNEL, (int) RING_TIMEOUT.toSeconds());
        return response;
    }

    @Transactional
    public CallResponse accept(UUID callId, UUID userId) {
        CallSession call = requireCall(callId, userId);
        if (call.getCallerId().equals(userId)) {
            throw ApiError.forbidden("The caller cannot answer their own call.");
        }
        // Only a call still ringing can be answered: the caller may have just hung up.
        if (!"ringing".equals(call.getStatus())) {
            throw ApiError.conflict("call_over", "This call has already ended.");
        }
        call.setStatus("active");
        return publishChange(call);
    }

    @Transactional
    public CallResponse decline(UUID callId, UUID userId) {
        CallSession call = requireCall(callId, userId);
        if (!"ringing".equals(call.getStatus())) return CallResponse.of(call);
        call.setStatus("declined");
        call.setEndedAt(Instant.now());
        return publishChange(call);
    }

    @Transactional
    public CallResponse end(UUID callId, UUID userId) {
        CallSession call = requireCall(callId, userId);
        if (!List.of("ringing", "active").contains(call.getStatus())) return CallResponse.of(call);
        boolean cancelledWhileRinging = "ringing".equals(call.getStatus());
        call.setStatus(cancelledWhileRinging ? "missed" : "ended");
        call.setEndedAt(Instant.now());
        if (cancelledWhileRinging) notifyMissed(call);
        return publishChange(call);
    }

    /** The caller's phone may have died, so the server closes calls nobody answered or ended. */
    @Scheduled(fixedDelay = 15_000)
    @Transactional
    public void closeAbandonedCalls() {
        Instant now = Instant.now();
        for (CallSession call : calls.findByStatusAndCreatedAtBefore("ringing", now.minus(RING_TIMEOUT))) {
            call.setStatus("missed");
            call.setEndedAt(now);
            notifyMissed(call);
            publishChange(call);
        }
        for (CallSession call : calls.findByStatusAndCreatedAtBefore("active", now.minus(MAX_ACTIVE))) {
            call.setStatus("ended");
            call.setEndedAt(now);
            publishChange(call);
        }
    }

    public CallTokenResponse token(UUID roomId, UUID userId) {
        ChatRoom room = chatService.requireRoom(roomId, userId);
        if (!chatService.chatWindow(room.getPatientId(), room.getDoctorId()).enabled()) {
            throw ApiError.conflict("chat_closed", "This consultation window has closed.");
        }
        String appId = properties.agora().appId();
        String certificate = properties.agora().appCertificate();
        if (appId == null || appId.isBlank() || certificate == null || certificate.isBlank()) {
            throw new ApiError(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "calls_unavailable", "Calling is not available right now.");
        }
        long uid = agoraUid(userId);
        String token = AgoraTokenBuilder.build(appId, certificate, roomId.toString(), uid, TOKEN_SECONDS, Instant.now().getEpochSecond());
        return new CallTokenResponse(appId, token, roomId.toString(), uid, TOKEN_SECONDS);
    }

    private CallSession requireCall(UUID callId, UUID userId) {
        CallSession call = calls.lockById(callId).orElseThrow(() -> ApiError.notFound("This call was not found."));
        chatService.requireRoom(call.getRoomId(), userId);
        return call;
    }

    private CallResponse publishChange(CallSession call) {
        CallResponse response = CallResponse.of(call);
        chatService.publish(call.getRoomId(), "call.updated", response);
        return response;
    }

    private void notifyMissed(CallSession call) {
        ChatRoom room = chatService.requireRoom(call.getRoomId(), call.getCallerId());
        Profile caller = profiles.findById(call.getCallerId()).orElse(null);
        String label = "video".equals(call.getType()) ? "video" : "voice";
        notifications.notify(room.otherParty(call.getCallerId()), "missed_call", "Missed call",
            "You missed a " + label + " call from " + (caller == null ? "your contact" : caller.fullName()) + ".",
            Map.of("roomId", call.getRoomId().toString()));
    }

    /** The same id every time for one person, in the positive range Agora accepts. */
    static long agoraUid(UUID userId) {
        long hash = 2166136261L;
        for (byte b : userId.toString().getBytes(StandardCharsets.UTF_8)) {
            hash ^= b & 0xff;
            hash = (hash * 16777619L) & 0xffffffffL;
        }
        return (hash % 2147483647L) + 1;
    }
}
