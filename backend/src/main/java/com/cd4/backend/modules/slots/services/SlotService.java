package com.cd4.backend.modules.slots.services;

import com.cd4.backend.config.AppProperties;
import com.cd4.backend.modules.slots.dtos.SlotDtos.CreateSlotRequest;
import com.cd4.backend.modules.slots.dtos.SlotDtos.SlotResponse;
import com.cd4.backend.modules.slots.models.Slot;
import com.cd4.backend.modules.slots.repositories.SlotRepository;
import com.cd4.backend.utils.ApiError;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class SlotService {
    private final SlotRepository slots;
    private final AppProperties properties;

    private ZoneId zone() {
        return ZoneId.of(properties.booking().timeZone());
    }

    /** When a slot begins as a moment in time. Slots are stored as local clinic time. */
    public Instant startsAt(Slot slot) {
        return slot.getDate().atTime(slot.getStartTime()).atZone(zone()).toInstant();
    }

    public List<SlotResponse> openSlots(UUID doctorId) {
        Instant now = Instant.now();
        return slots.findByDoctorIdAndBookedFalseAndDateGreaterThanEqualOrderByDateAscStartTimeAsc(doctorId, LocalDate.now(zone())).stream()
            .filter(slot -> startsAt(slot).isAfter(now))
            .map(SlotResponse::of)
            .toList();
    }

    public List<SlotResponse> ownSlots(UUID doctorId) {
        return slots.findByDoctorIdAndDateGreaterThanEqualOrderByDateAscStartTimeAsc(doctorId, LocalDate.now(zone())).stream().map(SlotResponse::of).toList();
    }

    @Transactional
    public SlotResponse create(UUID doctorId, CreateSlotRequest request) {
        if (!request.endTime().isAfter(request.startTime())) {
            throw ApiError.badRequest("invalid_time", "The end time must be after the start time.");
        }
        Slot slot = new Slot();
        slot.setDoctorId(doctorId);
        slot.setDate(request.date());
        slot.setStartTime(request.startTime());
        slot.setEndTime(request.endTime());
        if (!startsAt(slot).isAfter(Instant.now())) {
            throw ApiError.badRequest("slot_in_past", "This time has already passed.");
        }
        return SlotResponse.of(slots.save(slot));
    }

    @Transactional
    public void delete(UUID doctorId, UUID slotId) {
        Slot slot = slots.lockById(slotId).orElseThrow(() -> ApiError.notFound("This slot was not found."));
        if (!slot.getDoctorId().equals(doctorId)) {
            throw ApiError.forbidden("This slot is not yours.");
        }
        if (slot.isBooked()) {
            throw ApiError.conflict("slot_booked", "This slot has a booking. Cancel the appointment instead.");
        }
        slots.delete(slot);
    }
}
