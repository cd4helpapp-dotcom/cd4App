package com.cd4.backend.modules.doctors.models;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "doctors")
@Getter
@Setter
public class Doctor {
    @Id
    private UUID id;

    @Column(nullable = false)
    private String city;

    @Column(nullable = false)
    private String specialization;

    @Column(nullable = false)
    private String experience;

    @Column(nullable = false)
    private String fee;

    private String bio;
    private BigDecimal rating = new BigDecimal("5.0");

    @Column(name = "registration_number", nullable = false)
    private String registrationNumber;

    @Column(name = "kyc_verify", nullable = false)
    private boolean kycVerified;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "text[]")
    private String[] documents = new String[0];

    private String degree;
    private String university;

    @Column(name = "year_of_completion")
    private Integer yearOfCompletion;

    @Column(name = "registration_council")
    private String registrationCouncil;

    @Column(name = "current_hospital_clinic")
    private String currentHospitalClinic;

    @Column(name = "previous_work_details")
    private String previousWorkDetails;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "areas_of_expertise", columnDefinition = "text[]")
    private String[] areasOfExpertise = new String[0];

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "languages_spoken", columnDefinition = "text[]")
    private String[] languagesSpoken = new String[0];

    @Column(name = "treatment_approach")
    private String treatmentApproach;

    @Column(name = "profile_completion_done", nullable = false)
    private boolean profileCompletionDone;

    @Column(name = "profile_completion_done_at")
    private Instant profileCompletionDoneAt;

    @Column(name = "is_verified", nullable = false)
    private boolean verified;

    @Column(name = "signature_path")
    private String signaturePath;

    @Column(name = "last_seen_at")
    private Instant lastSeenAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
