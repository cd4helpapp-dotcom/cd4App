package com.cd4.backend.modules.chat.repositories;

import com.cd4.backend.modules.chat.models.ChatRoom;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface ChatRoomRepository extends JpaRepository<ChatRoom, UUID> {
    Optional<ChatRoom> findByPatientIdAndDoctorId(UUID patientId, UUID doctorId);

    @Query("select r from ChatRoom r where r.patientId = :userId or r.doctorId = :userId order by r.lastMessageAt desc")
    List<ChatRoom> findForUser(UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from ChatRoom r where r.id = :id")
    Optional<ChatRoom> lockById(UUID id);
}
