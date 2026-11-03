package com.cd4.backend.modules.slots.dtos;

import com.cd4.backend.modules.slots.models.Slot;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

public final class SlotDtos {
    private SlotDtos() {}

    public record CreateSlotRequest(@NotNull LocalDate date, @NotNull LocalTime startTime, @NotNull LocalTime endTime) {}

    public record SlotResponse(UUID id, UUID doctorId, LocalDate date, LocalTime startTime, LocalTime endTime, boolean isBooked) {
        public static SlotResponse of(Slot s) {
            return new SlotResponse(s.getId(), s.getDoctorId(), s.getDate(), s.getStartTime(), s.getEndTime(), s.isBooked());
        }
    }
}
