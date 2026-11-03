package com.cd4.backend.modules.chat.repositories;

import com.cd4.backend.modules.chat.models.ChatMessage;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, UUID> {
    @Query("select m from ChatMessage m where m.roomId = :roomId order by m.createdAt desc, m.id desc")
    List<ChatMessage> findLatest(UUID roomId, Pageable pageable);

    // Paging by a message rather than a page number, so a new message arriving cannot shift or repeat what is loaded.
    @Query("""
        select m from ChatMessage m
        where m.roomId = :roomId and (m.createdAt < :#{#before.createdAt} or (m.createdAt = :#{#before.createdAt} and m.id < :#{#before.id}))
        order by m.createdAt desc, m.id desc
        """)
    List<ChatMessage> findOlder(UUID roomId, ChatMessage before, Pageable pageable);

    @Modifying
    @Query("update ChatMessage m set m.read = true where m.roomId = :roomId and m.senderId <> :readerId and m.read = false")
    int markReadBy(UUID roomId, UUID readerId);
}
