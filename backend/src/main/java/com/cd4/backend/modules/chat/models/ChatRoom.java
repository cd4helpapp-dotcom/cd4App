package com.cd4.backend.modules.chat.models;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "chat_rooms")
@Getter
@Setter
public class ChatRoom {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "patient_id", nullable = false)
    private UUID patientId;

    @Column(name = "doctor_id", nullable = false)
    private UUID doctorId;

    @Column(name = "last_message_at")
    private Instant lastMessageAt;

    @Column(name = "last_message_text")
    private String lastMessageText;

    @Column(name = "unread_count_patient", nullable = false)
    private int unreadCountPatient;

    @Column(name = "unread_count_doctor", nullable = false)
    private int unreadCountDoctor;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
        if (lastMessageAt == null) lastMessageAt = createdAt;
    }

    public boolean hasParticipant(UUID userId) {
        return patientId.equals(userId) || doctorId.equals(userId);
    }

    public UUID otherParty(UUID userId) {
        return patientId.equals(userId) ? doctorId : patientId;
    }
}
