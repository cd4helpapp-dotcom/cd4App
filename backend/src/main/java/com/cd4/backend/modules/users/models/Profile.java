package com.cd4.backend.modules.users.models;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "profiles")
@Getter
@Setter
public class Profile {
    @Id
    private UUID id;

    @Column(name = "first_name", nullable = false)
    private String firstName;

    @Column(name = "last_name", nullable = false)
    private String lastName;

    @Column(nullable = false)
    private String email;

    @Column(name = "phone_number")
    private String phoneNumber;

    private Integer age;
    private String gender;
    private String address;
    private BigDecimal weight;

    @Column(name = "blood_pressure")
    private String bloodPressure;

    private Integer pulse;

    @Column(name = "profile_picture")
    private String profilePicture;

    @Column(name = "profile_setup_completed", nullable = false)
    private boolean profileSetupCompleted;

    @Column(name = "is_verified", nullable = false)
    private boolean verified;

    @Column(name = "role_id", nullable = false)
    private UUID roleId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private Map<String, Object> settings = new HashMap<>();

    @Column(name = "push_token")
    private String pushToken;

    @Column(name = "last_seen_at")
    private Instant lastSeenAt;

    @Column(name = "chat_public_key")
    private String chatPublicKey;

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

    public String fullName() {
        return (firstName + " " + lastName).trim();
    }
}
