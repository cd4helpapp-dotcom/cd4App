package com.cd4.backend.modules.calls.dtos;

import com.cd4.backend.modules.calls.models.CallSession;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.time.Instant;
import java.util.UUID;

public final class CallDtos {
    private CallDtos() {}

    public record StartCallRequest(@NotNull UUID roomId, @NotNull @Pattern(regexp = "audio|video") String type) {}

    public record CallResponse(UUID id, UUID roomId, UUID callerId, String type, String status, Instant createdAt, Instant endedAt) {
        public static CallResponse of(CallSession c) {
            return new CallResponse(c.getId(), c.getRoomId(), c.getCallerId(), c.getType(), c.getStatus(), c.getCreatedAt(), c.getEndedAt());
        }
    }

    public record CallTokenResponse(String appId, String token, String channelName, long uid, long expiresInSeconds) {}
}
