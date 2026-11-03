package com.cd4.backend.modules.doctors.dtos;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.UUID;

public final class DoctorDtos {
    private DoctorDtos() {}

    /** What patients see. Registration number, signature, KYC documents and contact details stay out. */
    public record DoctorPublic(
        UUID id, String firstName, String lastName, String profilePicture, String city, String specialization,
        String experience, String fee, String bio, BigDecimal rating, String degree, String currentHospitalClinic,
        String[] areasOfExpertise, String[] languagesSpoken, String treatmentApproach
    ) {}

    public record DoctorPrivate(
        UUID id, String city, String specialization, String experience, String fee, String bio, BigDecimal rating,
        String registrationNumber, String registrationCouncil, boolean isVerified, boolean kycVerified, String signaturePath,
        String degree, String university, Integer yearOfCompletion, String currentHospitalClinic, String previousWorkDetails,
        String[] areasOfExpertise, String[] languagesSpoken, String treatmentApproach, boolean profileCompletionDone
    ) {}

    public record UpdateDoctorRequest(
        @Size(min = 1, max = 80) String city,
        @Size(min = 1, max = 80) String specialization,
        @Size(max = 40) String experience,
        @Size(max = 40) String fee,
        @Size(max = 2000) String bio,
        @Size(max = 120) String degree,
        @Size(max = 160) String university,
        Integer yearOfCompletion,
        @Size(max = 160) String registrationCouncil,
        @Size(max = 160) String currentHospitalClinic,
        @Size(max = 2000) String previousWorkDetails,
        String[] areasOfExpertise,
        String[] languagesSpoken,
        @Size(max = 2000) String treatmentApproach
    ) {}

    public record SignatureRequest(@NotBlank @Size(max = 300) String signaturePath) {}
}
