package com.cd4.backend.modules.payments.services;

import com.cd4.backend.constants.AppointmentStatus;
import com.cd4.backend.modules.appointments.models.Appointment;
import com.cd4.backend.modules.appointments.repositories.AppointmentRepository;
import com.cd4.backend.modules.chat.services.ChatRoomService;
import com.cd4.backend.modules.payments.models.AppointmentPayment;
import com.cd4.backend.modules.payments.repositories.AppointmentPaymentRepository;
import com.cd4.backend.modules.slots.models.Slot;
import com.cd4.backend.modules.slots.repositories.SlotRepository;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The short database steps of a booking, in their own transactions.
 * Calls to Razorpay happen outside them, so a slow payment API never holds a row lock.
 */
@Component
@RequiredArgsConstructor
public class BookingTransactions {
    public enum Outcome { BOOKED, ALREADY_BOOKED, SLOT_LOST, INVALID }

    public record FinalizeResult(Outcome outcome, UUID appointmentId) {}

    private final AppointmentPaymentRepository payments;
    private final SlotRepository slots;
    private final AppointmentRepository appointments;
    private final ChatRoomService chatRooms;

    /**
     * Turns a paid order into a booking. The payment row is locked first, so the app's verify call and the webhook
     * can arrive together and only one of them creates the appointment.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public FinalizeResult finalizeBooking(UUID paymentRowId, String razorpayPaymentId, String signature, UUID aiReportId) {
        AppointmentPayment payment = payments.lockById(paymentRowId).orElse(null);
        if (payment == null) return new FinalizeResult(Outcome.INVALID, null);
        if (payment.getAppointmentId() != null) return new FinalizeResult(Outcome.ALREADY_BOOKED, payment.getAppointmentId());
        if ("refunded".equals(payment.getStatus())) return new FinalizeResult(Outcome.SLOT_LOST, null);

        Slot slot = slots.lockById(payment.getSlotId()).orElse(null);
        if (slot == null || slot.isBooked()) return new FinalizeResult(Outcome.SLOT_LOST, null);

        Appointment appointment = new Appointment();
        appointment.setPatientId(payment.getPatientId());
        appointment.setDoctorId(payment.getDoctorId());
        appointment.setSlotId(slot.getId());
        appointment.setStatus(AppointmentStatus.CONFIRMED);
        appointment.setAiReportId(aiReportId);
        appointment.setAppointmentType("second_opinion".equals(payment.getMetadata().get("appointment_type")) ? "second_opinion" : "consultation");
        appointments.saveAndFlush(appointment);

        slot.setBooked(true);
        slot.setAppointmentId(appointment.getId());

        payment.setAppointmentId(appointment.getId());
        if (razorpayPaymentId != null) payment.setPaymentId(razorpayPaymentId);
        if (signature != null) payment.setSignature(signature);
        payment.setStatus("paid");
        payment.setPaidAt(Instant.now());

        chatRooms.ensureRoom(payment.getPatientId(), payment.getDoctorId());
        return new FinalizeResult(Outcome.BOOKED, appointment.getId());
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void updateMetadata(UUID paymentRowId, Map<String, Object> changes) {
        payments.lockById(paymentRowId).ifPresent(payment -> {
            Map<String, Object> next = new HashMap<>(payment.getMetadata());
            next.putAll(changes);
            payment.setMetadata(next);
        });
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markRefunded(UUID paymentRowId, String razorpayPaymentId, Map<String, Object> changes) {
        payments.lockById(paymentRowId).ifPresent(payment -> {
            Map<String, Object> next = new HashMap<>(payment.getMetadata());
            next.putAll(changes);
            payment.setMetadata(next);
            payment.setStatus("refunded");
            if (razorpayPaymentId != null) payment.setPaymentId(razorpayPaymentId);
        });
    }

    /** The refund failed, so the money is still with CD4. The row stays visible as needing a manual refund. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markRefundFailed(UUID paymentRowId, String razorpayPaymentId, Map<String, Object> changes) {
        payments.lockById(paymentRowId).ifPresent(payment -> {
            Map<String, Object> next = new HashMap<>(payment.getMetadata());
            next.putAll(changes);
            payment.setMetadata(next);
            payment.setStatus("paid");
            if (razorpayPaymentId != null) payment.setPaymentId(razorpayPaymentId);
        });
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markFailed(UUID paymentRowId) {
        payments.lockById(paymentRowId).ifPresent(payment -> {
            if ("created".equals(payment.getStatus()) || payment.isTestMode()) payment.setStatus("failed");
        });
    }
}
