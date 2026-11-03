package com.cd4.backend.modules.notifications.repositories;

import com.cd4.backend.modules.notifications.models.InAppNotification;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface InAppNotificationRepository extends JpaRepository<InAppNotification, UUID> {
    Page<InAppNotification> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    long countByUserIdAndReadFalse(UUID userId);

    @Modifying
    @Query("update InAppNotification n set n.read = true where n.userId = :userId and n.read = false")
    int markAllRead(UUID userId);

    @Modifying
    @Query("update InAppNotification n set n.read = true where n.id = :id and n.userId = :userId")
    int markRead(UUID id, UUID userId);
}
