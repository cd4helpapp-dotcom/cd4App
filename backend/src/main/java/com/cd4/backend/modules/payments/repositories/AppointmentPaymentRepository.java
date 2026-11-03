package com.cd4.backend.modules.payments.repositories;

import com.cd4.backend.modules.payments.models.AppointmentPayment;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface AppointmentPaymentRepository extends JpaRepository<AppointmentPayment, UUID> {
    Optional<AppointmentPayment> findByOrderId(String orderId);

    Optional<AppointmentPayment> findFirstByAppointmentIdAndStatus(UUID appointmentId, String status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from AppointmentPayment p where p.id = :id")
    Optional<AppointmentPayment> lockById(UUID id);

    @Query("""
        select count(p) > 0 from AppointmentPayment p
        where p.slotId = :slotId and p.status = 'created' and p.patientId <> :patientId and p.createdAt >= :since
        """)
    boolean existsHoldByOtherPatient(UUID slotId, UUID patientId, Instant since);

    // Unpaid orders are not receipts, so history shows only money that actually moved.
    @Query("select p from AppointmentPayment p where p.patientId = :patientId and p.status in ('paid', 'refunded') order by p.createdAt desc")
    List<AppointmentPayment> findHistoryForPatient(UUID patientId, Pageable pageable);

    @Query("select p from AppointmentPayment p where p.doctorId = :doctorId and p.status = 'paid' order by p.createdAt desc")
    List<AppointmentPayment> findEarningsForDoctor(UUID doctorId, Pageable pageable);
}
