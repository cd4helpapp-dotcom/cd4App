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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "chat_messages")
@Getter
@Setter
public class ChatMessage {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "room_id", nullable = false)
    private UUID roomId;

    @Column(name = "sender_id", nullable = false)
    private UUID senderId;

    @Column(nullable = false)
    private String text;

    @Column(nullable = false)
    private String type = "text";

    @Column(name = "attachment_url")
    private String attachmentUrl;

    @Column(name = "is_read", nullable = false)
    private boolean read;

    @Column(name = "reply_to_id")
    private UUID replyToId;

    @Column(name = "is_encrypted", nullable = false)
    private boolean encrypted;

    @Column(name = "encrypted_payload")
    private String encryptedPayload;

    @JdbcTypeCode(SqlTypes.SMALLINT)
    @Column(name = "encryption_version")
    private Short encryptionVersion;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
    }
}
