package com.cd4.backend.modules.slots.repositories;

import com.cd4.backend.modules.slots.models.Slot;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface SlotRepository extends JpaRepository<Slot, UUID> {
    List<Slot> findByDoctorIdAndBookedFalseAndDateGreaterThanEqualOrderByDateAscStartTimeAsc(UUID doctorId, LocalDate from);

    List<Slot> findByDoctorIdAndDateGreaterThanEqualOrderByDateAscStartTimeAsc(UUID doctorId, LocalDate from);

    List<Slot> findByIdIn(Collection<UUID> ids);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Slot s where s.id = :id")
    Optional<Slot> lockById(UUID id);
}
