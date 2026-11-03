package com.cd4.backend.modules.ai.repositories;

import com.cd4.backend.modules.ai.models.AiChatConversation;
import com.cd4.backend.modules.ai.models.AiChatMessage;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public final class AiRepositories {
    private AiRepositories() {}

    public interface Conversations extends JpaRepository<AiChatConversation, UUID> {
        List<AiChatConversation> findByUserIdOrderByUpdatedAtDesc(UUID userId, Pageable pageable);
    }

    public interface Messages extends JpaRepository<AiChatMessage, UUID> {
        @Query("select m from AiChatMessage m where m.conversationId = :conversationId order by m.createdAt desc, m.id desc")
        List<AiChatMessage> findLatest(UUID conversationId, Pageable pageable);
    }
}
