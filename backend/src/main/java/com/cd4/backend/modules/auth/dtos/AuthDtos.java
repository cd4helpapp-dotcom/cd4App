package com.cd4.backend.modules.auth.dtos;

import com.cd4.backend.modules.users.dtos.UserDtos.MeResponse;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class AuthDtos {
    private AuthDtos() {}

    public record RegisterRequest(
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Size(min = 8, max = 72) String password,
        @NotBlank @Size(max = 60) String firstName,
        @NotBlank @Size(max = 60) String lastName,
        // Only these two can be chosen when signing up. Hospital and admin accounts are created by an admin.
        @Pattern(regexp = "patient|doctor", message = "must be patient or doctor") String role,
        @Size(max = 60) String registrationNumber,
        @Size(max = 80) String specialization,
        @Size(max = 80) String city,
        @Size(max = 40) String experience,
        @Size(max = 40) String fee
    ) {}

    public record LoginRequest(@NotBlank @Email String email, @NotBlank String password) {}

    public record RefreshRequest(@NotBlank String refreshToken) {}

    public record ChangePasswordRequest(@NotBlank String currentPassword, @NotBlank @Size(min = 8, max = 72) String newPassword) {}

    public record TokenResponse(String accessToken, String refreshToken, long expiresInSeconds, MeResponse user) {}
}
