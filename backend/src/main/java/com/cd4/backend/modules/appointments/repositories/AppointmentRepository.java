package com.cd4.backend.modules.appointments.repositories;

import com.cd4.backend.modules.appointments.models.Appointment;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface AppointmentRepository extends JpaRepository<Appointment, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Appointment a where a.id = :id")
    Optional<Appointment> lockById(UUID id);

    Page<Appointment> findByPatientIdOrderByCreatedAtDesc(UUID patientId, Pageable pageable);

    Page<Appointment> findByDoctorIdOrderByCreatedAtDesc(UUID doctorId, Pageable pageable);

    Optional<Appointment> findFirstByPatientIdAndDoctorIdAndStatusInAndCreatedAtAfterOrderByCreatedAtDesc(UUID patientId, UUID doctorId, Collection<String> statuses, Instant after);

    List<Appointment> findByPatientIdAndDoctorIdAndStatusIn(UUID patientId, UUID doctorId, Collection<String> statuses);

    boolean existsByPatientIdAndDoctorId(UUID patientId, UUID doctorId);
}
