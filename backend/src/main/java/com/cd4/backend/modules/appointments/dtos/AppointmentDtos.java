package com.cd4.backend.modules.appointments.dtos;

import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

public final class AppointmentDtos {
    private AppointmentDtos() {}

    public record AppointmentResponse(
        UUID id, UUID patientId, String patientName, UUID doctorId, String doctorName, String specialization,
        UUID slotId, LocalDate date, LocalTime startTime, LocalTime endTime, String status, String appointmentType,
        Instant cancelledAt, String cancelledBy, Instant createdAt
    ) {}

    public record RescheduleRequest(@NotNull UUID slotId) {}

    public record CancelResponse(String refund) {}
}
