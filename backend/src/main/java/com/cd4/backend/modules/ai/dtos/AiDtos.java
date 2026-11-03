package com.cd4.backend.modules.ai.dtos;

import com.cd4.backend.modules.ai.models.AiChatConversation;
import com.cd4.backend.modules.ai.models.AiChatMessage;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

public final class AiDtos {
    private AiDtos() {}

    public record CreateConversationRequest(@Size(max = 80) String concern) {}

    public record SendRequest(@NotBlank @Size(max = 4000) String text) {}

    public record ConversationResponse(UUID id, String concern, String title, Instant updatedAt) {
        public static ConversationResponse of(AiChatConversation c) {
            return new ConversationResponse(c.getId(), c.getConcern(), c.getTitle(), c.getUpdatedAt());
        }
    }

    public record MessageResponse(UUID id, String sender, String text, boolean showConsultNow, Instant createdAt) {
        public static MessageResponse of(AiChatMessage m) {
            return new MessageResponse(m.getId(), m.getSender(), m.getText(), m.isShowConsultNow(), m.getCreatedAt());
        }
    }

    public record ReplyResponse(MessageResponse user, MessageResponse ai) {}
}
