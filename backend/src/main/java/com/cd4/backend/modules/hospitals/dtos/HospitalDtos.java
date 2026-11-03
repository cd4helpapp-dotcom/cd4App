package com.cd4.backend.modules.hospitals.dtos;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public final class HospitalDtos {
    private HospitalDtos() {}

    public record OnboardingRequest(
        @NotBlank @Size(max = 200) String registeredName,
        @Size(max = 200) String displayName,
        @NotBlank @Size(max = 80) String facilityType,
        @NotBlank @Size(max = 80) String registrationNumber,
        @NotBlank @Size(max = 160) String registeringAuthority,
        @NotBlank @Size(max = 500) String fullAddress,
        @NotBlank @Size(max = 80) String city,
        @NotBlank @Size(max = 80) String state,
        @NotBlank @Size(max = 12) String pinCode,
        @NotBlank @Size(max = 120) String authorizedPersonName,
        @NotBlank @Size(max = 80) String designation,
        @NotBlank @Size(max = 20) String mobileNumber,
        @NotBlank @Email String officialEmail
    ) {}

    public record AddDoctorRequest(@NotNull UUID doctorId, @Size(max = 80) String department) {}
}
