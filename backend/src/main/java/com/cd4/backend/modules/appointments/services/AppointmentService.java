package com.cd4.backend.modules.appointments.services;

import com.cd4.backend.config.AppProperties;
import com.cd4.backend.constants.AppointmentStatus;
import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.appointments.dtos.AppointmentDtos.AppointmentResponse;
import com.cd4.backend.modules.appointments.models.Appointment;
import com.cd4.backend.modules.appointments.repositories.AppointmentRepository;
import com.cd4.backend.modules.doctors.models.Doctor;
import com.cd4.backend.modules.doctors.repositories.DoctorRepository;
import com.cd4.backend.modules.notifications.services.NotificationService;
import com.cd4.backend.modules.payments.models.AppointmentPayment;
import com.cd4.backend.modules.payments.repositories.AppointmentPaymentRepository;
import com.cd4.backend.modules.slots.models.Slot;
import com.cd4.backend.modules.slots.repositories.SlotRepository;
import com.cd4.backend.modules.slots.services.SlotService;
import com.cd4.backend.modules.users.models.Profile;
import com.cd4.backend.modules.users.repositories.ProfileRepository;
import com.cd4.backend.utils.ApiError;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AppointmentService {
    private static final int PAGE_SIZE = 20;
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("d MMM, h:mm a", Locale.ENGLISH);

    private final AppointmentRepository appointments;
    private final SlotRepository slots;
    private final SlotService slotService;
    private final AppointmentPaymentRepository payments;
    private final ProfileRepository profiles;
    private final DoctorRepository doctors;
    private final NotificationService notifications;
    private final AppProperties properties;

    public record CancelOutcome(String cancelledBy, UUID patientId, UUID doctorId, String when, Optional<AppointmentPayment> paidPayment) {}

    @Transactional(readOnly = true)
    public List<AppointmentResponse> mine(CurrentUser user, int page) {
        PageRequest request = PageRequest.of(Math.max(page, 0), PAGE_SIZE);
        List<Appointment> rows = user.isDoctor()
            ? appointments.findByDoctorIdOrderByCreatedAtDesc(user.id(), request).getContent()
            : appointments.findByPatientIdOrderByCreatedAtDesc(user.id(), request).getContent();
        return toResponses(rows);
    }

    @Transactional(readOnly = true)
    public AppointmentResponse get(CurrentUser user, UUID id) {
        Appointment a = appointments.findById(id).orElseThrow(() -> ApiError.notFound("This appointment was not found."));
        requireParticipant(user, a);
        return toResponses(List.of(a)).get(0);
    }

    /**
     * Patients can cancel up to the cut-off before the visit, doctors and admins until it starts.
     * A slot freed by a patient reopens. One cancelled by the doctor stays closed, because they are not available then.
     */
    @Transactional
    public CancelOutcome cancel(CurrentUser user, UUID appointmentId) {
        Appointment a = appointments.lockById(appointmentId).orElseThrow(() -> ApiError.notFound("This appointment was not found."));
        String actor = actorOf(user, a);
        if (!AppointmentStatus.ACTIVE.contains(a.getStatus())) {
            throw ApiError.conflict("not_active", "This appointment is already closed.");
        }
        Slot slot = slots.lockById(a.getSlotId()).orElseThrow();
        Instant startsAt = slotService.startsAt(slot);
        Instant now = Instant.now();
        if (!startsAt.isAfter(now)) {
            throw ApiError.conflict("already_started", "This appointment has already started.");
        }
        if ("patient".equals(actor) && startsAt.isBefore(now.plus(cutoff()))) {
            throw ApiError.conflict("too_late", "Appointments can be cancelled up to " + properties.booking().patientChangeCutoffHours() + " hours before they start.");
        }
        a.setStatus(AppointmentStatus.CANCELLED);
        a.setCancelledAt(now);
        a.setCancelledBy(actor);
        slot.setBooked(!"patient".equals(actor));
        slot.setAppointmentId(null);
        Optional<AppointmentPayment> paid = payments.findFirstByAppointmentIdAndStatus(a.getId(), "paid");
        return new CancelOutcome(actor, a.getPatientId(), a.getDoctorId(), describe(slot), paid);
    }

    @Transactional
    public void reschedule(CurrentUser user, UUID appointmentId, UUID newSlotId) {
        Appointment a = appointments.lockById(appointmentId).orElseThrow(() -> ApiError.notFound("This appointment was not found."));
        if (!a.getPatientId().equals(user.id())) {
            throw ApiError.forbidden("Only the patient can move this appointment.");
        }
        if (!AppointmentStatus.ACTIVE.contains(a.getStatus())) {
            throw ApiError.conflict("not_active", "This appointment is already closed.");
        }
        Slot oldSlot = slots.lockById(a.getSlotId()).orElseThrow();
        Instant now = Instant.now();
        if (slotService.startsAt(oldSlot).isBefore(now.plus(cutoff()))) {
            throw ApiError.conflict("too_late", "Appointments can be moved up to " + properties.booking().patientChangeCutoffHours() + " hours before they start.");
        }
        Slot newSlot = slots.lockById(newSlotId).orElseThrow(() -> ApiError.conflict("slot_unavailable", "This time is no longer available."));
        if (!newSlot.getDoctorId().equals(a.getDoctorId()) || newSlot.isBooked() || !slotService.startsAt(newSlot).isAfter(now)) {
            throw ApiError.conflict("slot_unavailable", "This time is no longer available.");
        }
        Instant holdSince = now.minus(Duration.ofMinutes(properties.booking().slotHoldMinutes()));
        if (payments.existsHoldByOtherPatient(newSlot.getId(), user.id(), holdSince)) {
            throw ApiError.conflict("slot_on_hold", "Another patient is completing payment for this time. Please choose another.");
        }
        oldSlot.setBooked(false);
        oldSlot.setAppointmentId(null);
        newSlot.setBooked(true);
        newSlot.setAppointmentId(a.getId());
        a.setSlotId(newSlot.getId());
        payments.findFirstByAppointmentIdAndStatus(a.getId(), "paid").ifPresent(payment -> payment.setSlotId(newSlot.getId()));
        notifications.notify(a.getDoctorId(), "appointment_update", "Appointment rescheduled",
            "A patient moved their consultation to " + describe(newSlot) + ".", Map.of("appointmentId", a.getId().toString()));
    }

    /** The doctor closes a consultation. Patients cannot mark their own as completed. */
    @Transactional
    public void complete(CurrentUser user, UUID appointmentId) {
        Appointment a = appointments.lockById(appointmentId).orElseThrow(() -> ApiError.notFound("This appointment was not found."));
        if (!a.getDoctorId().equals(user.id()) && !user.isAdmin()) {
            throw ApiError.forbidden("Only the doctor can complete this appointment.");
        }
        if (!AppointmentStatus.ACTIVE.contains(a.getStatus())) {
            throw ApiError.conflict("not_active", "This appointment is already closed.");
        }
        a.setStatus(AppointmentStatus.COMPLETED);
    }

    public void requireParticipant(CurrentUser user, Appointment a) {
        actorOf(user, a);
    }

    private String actorOf(CurrentUser user, Appointment a) {
        if (a.getPatientId().equals(user.id())) return "patient";
        if (a.getDoctorId().equals(user.id())) return "doctor";
        if (user.isAdmin()) return "admin";
        throw ApiError.forbidden("You do not have access to this appointment.");
    }

    private Duration cutoff() {
        return Duration.ofHours(properties.booking().patientChangeCutoffHours());
    }

    public String describe(Slot slot) {
        return slot.getDate().atTime(slot.getStartTime()).atZone(ZoneId.of(properties.booking().timeZone())).format(WHEN);
    }

    private List<AppointmentResponse> toResponses(List<Appointment> rows) {
        Set<UUID> people = rows.stream().flatMap(a -> Stream.of(a.getPatientId(), a.getDoctorId())).collect(Collectors.toSet());
        Map<UUID, Profile> profileById = profiles.findByIdIn(people).stream().collect(Collectors.toMap(Profile::getId, Function.identity()));
        Map<UUID, Doctor> doctorById = doctors.findByIdIn(rows.stream().map(Appointment::getDoctorId).collect(Collectors.toSet())).stream()
            .collect(Collectors.toMap(Doctor::getId, Function.identity()));
        Map<UUID, Slot> slotById = slots.findByIdIn(rows.stream().map(Appointment::getSlotId).collect(Collectors.toSet())).stream()
            .collect(Collectors.toMap(Slot::getId, Function.identity()));
        return rows.stream().map(a -> {
            Slot slot = slotById.get(a.getSlotId());
            Profile patient = profileById.get(a.getPatientId());
            Profile doctor = profileById.get(a.getDoctorId());
            Doctor doctorRow = doctorById.get(a.getDoctorId());
            return new AppointmentResponse(a.getId(), a.getPatientId(), patient == null ? "" : patient.fullName(), a.getDoctorId(),
                doctor == null ? "" : doctor.fullName(), doctorRow == null ? "" : doctorRow.getSpecialization(), a.getSlotId(),
                slot == null ? null : slot.getDate(), slot == null ? null : slot.getStartTime(), slot == null ? null : slot.getEndTime(),
                a.getStatus(), a.getAppointmentType(), a.getCancelledAt(), a.getCancelledBy(), a.getCreatedAt());
        }).toList();
    }
}
