package com.cd4.backend.modules.chat.dtos;

import com.cd4.backend.modules.chat.models.ChatMessage;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class ChatDtos {
    private ChatDtos() {}

    public record RoomResponse(
        UUID id, UUID otherPartyId, String otherPartyName, String otherPartyPicture, Instant otherPartyLastSeenAt,
        String lastMessageText, Instant lastMessageAt, int unreadCount, boolean chatEnabled, String chatDisabledReason
    ) {}

    public record SendMessageRequest(
        @Size(max = 8000) String text,
        @Pattern(regexp = "text|image|file") String type,
        @Size(max = 500) String attachmentUrl,
        UUID replyToId,
        boolean isEncrypted,
        @Size(max = 20000) String encryptedPayload,
        Short encryptionVersion
    ) {}

    public record MessageResponse(
        UUID id, UUID roomId, UUID senderId, String text, String type, String attachmentUrl, boolean isRead,
        UUID replyToId, boolean isEncrypted, String encryptedPayload, Short encryptionVersion, Instant createdAt
    ) {
        public static MessageResponse of(ChatMessage m) {
            return new MessageResponse(m.getId(), m.getRoomId(), m.getSenderId(), m.getText(), m.getType(), m.getAttachmentUrl(), m.isRead(),
                m.getReplyToId(), m.isEncrypted(), m.getEncryptedPayload(), m.getEncryptionVersion(), m.getCreatedAt());
        }
    }

    public record RoomEvent(String type, UUID roomId, Object data) {}
}
