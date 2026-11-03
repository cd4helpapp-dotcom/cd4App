package com.cd4.backend.modules.users.dtos;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public final class UserDtos {
    private UserDtos() {}

    /** Only ever returned to the account's owner. */
    public record MeResponse(
        UUID id, String email, String firstName, String lastName, String role, String phoneNumber,
        Integer age, String gender, String address, BigDecimal weight, String bloodPressure, Integer pulse,
        String profilePicture, boolean profileSetupCompleted, boolean isVerified, Map<String, Object> settings, String chatPublicKey
    ) {}

    /** What anyone may see about another person. Contact and health details are left out on purpose. */
    public record PublicProfile(UUID id, String firstName, String lastName, String profilePicture, String role, boolean isVerified) {}

    public record UpdateMeRequest(
        @Size(min = 1, max = 60) String firstName,
        @Size(min = 1, max = 60) String lastName,
        @Size(max = 20) String phoneNumber,
        @Min(1) @Max(120) Integer age,
        @Pattern(regexp = "Male|Female|Other") String gender,
        @Size(max = 300) String address,
        BigDecimal weight,
        @Size(max = 20) String bloodPressure,
        @Min(20) @Max(250) Integer pulse,
        @Size(max = 500) String profilePicture,
        Boolean profileSetupCompleted,
        Map<String, Object> settings
    ) {}

    public record PushTokenRequest(@Size(max = 300) String pushToken) {}

    public record ChatKeyRequest(@Size(min = 20, max = 300) String chatPublicKey) {}

    public record PresenceResponse(boolean online, Instant lastSeenAt) {}
}
