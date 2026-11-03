package com.cd4.backend.modules.calls.repositories;

import com.cd4.backend.modules.calls.models.CallSession;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface CallSessionRepository extends JpaRepository<CallSession, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CallSession c where c.id = :id")
    Optional<CallSession> lockById(UUID id);

    Optional<CallSession> findFirstByRoomIdAndStatusInOrderByCreatedAtDesc(UUID roomId, Collection<String> statuses);

    List<CallSession> findByStatusAndCreatedAtBefore(String status, Instant before);
}
