package com.cd4.backend.modules.payments.services;

import com.cd4.backend.config.AppProperties;
import com.cd4.backend.constants.AppointmentStatus;
import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.appointments.models.Appointment;
import com.cd4.backend.modules.appointments.repositories.AppointmentRepository;
import com.cd4.backend.modules.appointments.services.AppointmentService;
import com.cd4.backend.modules.doctors.models.Doctor;
import com.cd4.backend.modules.doctors.repositories.DoctorRepository;
import com.cd4.backend.modules.notifications.services.NotificationService;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.BookingResponse;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.CreateOrderRequest;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.EarningItem;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.OrderResponse;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.PaymentHistoryItem;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.VerifyRequest;
import com.cd4.backend.modules.payments.models.AppointmentPayment;
import com.cd4.backend.modules.payments.repositories.AppointmentPaymentRepository;
import com.cd4.backend.modules.payments.services.BookingTransactions.FinalizeResult;
import com.cd4.backend.modules.payments.services.BookingTransactions.Outcome;
import com.cd4.backend.modules.slots.models.Slot;
import com.cd4.backend.modules.slots.repositories.SlotRepository;
import com.cd4.backend.modules.slots.services.SlotService;
import com.cd4.backend.utils.ApiError;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class PaymentService {
    private static final String SLOT_REFUNDED = "This slot was booked by another patient just before your payment completed. Your payment is being refunded automatically.";
    private static final String SLOT_REFUND_PENDING = "This slot was booked by another patient just before your payment completed. Your refund is being processed.";
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    private final AppointmentPaymentRepository payments;
    private final AppointmentRepository appointments;
    private final SlotRepository slots;
    private final SlotService slotService;
    private final DoctorRepository doctors;
    private final AppointmentService appointmentService;
    private final BookingTransactions transactions;
    private final RazorpayClient razorpay;
    private final NotificationService notifications;
    private final AppProperties properties;

    /** All the checks happen before any money moves, so a patient is never charged for a slot they cannot get. */
    public OrderResponse createOrder(CurrentUser user, CreateOrderRequest request) {
        Slot slot = slots.findById(request.slotId()).orElse(null);
        if (slot == null || !slot.getDoctorId().equals(request.doctorId())) {
            throw ApiError.badRequest("slot_mismatch", "This slot does not belong to the selected doctor. Please choose a slot again.");
        }
        if (slot.isBooked()) {
            throw ApiError.conflict("slot_booked", "Sorry, this slot was just booked by someone else. Please choose another slot.");
        }
        if (!slotService.startsAt(slot).isAfter(Instant.now())) {
            throw ApiError.badRequest("slot_in_past", "This slot has already passed. Please choose a later slot.");
        }
        Instant cooldownSince = Instant.now().minus(Duration.ofDays(properties.booking().rebookCooldownDays()));
        appointments.findFirstByPatientIdAndDoctorIdAndStatusInAndCreatedAtAfterOrderByCreatedAtDesc(user.id(), request.doctorId(), AppointmentStatus.COUNTS_FOR_COOLDOWN, cooldownSince)
            .ifPresent(recent -> {
                String next = recent.getCreatedAt().plus(Duration.ofDays(properties.booking().rebookCooldownDays())).atZone(ZoneId.of(properties.booking().timeZone())).format(DAY);
                throw ApiError.conflict("booking_cooldown", "You already booked this doctor in the last " + properties.booking().rebookCooldownDays() + " days. You can book again after " + next + ".");
            });
        Instant holdSince = Instant.now().minus(Duration.ofMinutes(properties.booking().slotHoldMinutes()));
        if (payments.existsHoldByOtherPatient(slot.getId(), user.id(), holdSince)) {
            throw ApiError.conflict("slot_on_hold", "Another patient is completing payment for this slot. Please choose another.");
        }
        Doctor doctor = doctors.findById(request.doctorId()).filter(Doctor::isVerified).orElseThrow(() -> ApiError.notFound("This doctor was not found."));

        BigDecimal fee = parseFee(doctor.getFee());
        BigDecimal doctorShare = fee.multiply(properties.booking().doctorShare()).setScale(2, RoundingMode.HALF_UP);
        long amountPaise = fee.multiply(BigDecimal.valueOf(100)).longValueExact();
        boolean live = properties.razorpay().isLive();

        String orderId;
        if (live) {
            RazorpayClient.Result order = razorpay.createOrder(amountPaise, "apt_" + System.currentTimeMillis());
            if (!order.ok()) {
                log.warn("Razorpay order failed: {}", order.error());
                throw new ApiError(org.springframework.http.HttpStatus.BAD_GATEWAY, "payment_provider_error", "Could not start the payment. Please try again.");
            }
            orderId = order.body().path("id").asText();
        } else {
            orderId = "order_test_" + UUID.randomUUID().toString().replace("-", "").substring(0, 18);
        }

        Map<String, Object> metadata = new HashMap<>();
        metadata.put("mode", live ? "live" : "test");
        metadata.put("appointment_type", "second_opinion".equals(request.appointmentType()) ? "second_opinion" : "consultation");
        Map<String, Object> context = new HashMap<>();
        if (request.concern() != null) context.put("concern", request.concern());
        if (request.conversationId() != null) context.put("conversation_id", request.conversationId().toString());
        if (request.aiReportId() != null) context.put("ai_report_id", request.aiReportId().toString());
        metadata.put("booking_context", context);

        AppointmentPayment payment = new AppointmentPayment();
        payment.setPatientId(user.id());
        payment.setDoctorId(request.doctorId());
        payment.setSlotId(slot.getId());
        payment.setOrderId(orderId);
        payment.setGrossAmount(fee);
        payment.setDoctorShare(doctorShare);
        payment.setPlatformCommission(fee.subtract(doctorShare));
        payment.setMetadata(metadata);
        payments.save(payment);

        return new OrderResponse(payment.getId(), orderId, fee, amountPaise, "INR", live ? properties.razorpay().keyId() : null, live ? "live" : "test");
    }

    public BookingResponse verifyAndBook(CurrentUser user, VerifyRequest request) {
        AppointmentPayment payment = payments.findByOrderId(request.orderId())
            .filter(p -> p.getPatientId().equals(user.id()))
            .orElseThrow(() -> ApiError.notFound("This payment was not found."));
        if (payment.getAppointmentId() != null) {
            return new BookingResponse(payment.getAppointmentId(), true);
        }
        if ("refunded".equals(payment.getStatus())) {
            throw ApiError.conflict("slot_taken_refunded", SLOT_REFUNDED);
        }
        // Only an order created without Razorpay keys has no signature to check.
        boolean valid = payment.isTestMode() || razorpay.verifyPaymentSignature(request.orderId(), request.paymentId(), request.signature());
        if (!valid) {
            throw ApiError.badRequest("invalid_payment_signature", "We could not confirm this payment.");
        }
        return finalizePaid(payment, request.paymentId(), request.signature(), request.aiReportId());
    }

    /** The one path from "Razorpay has the money" to "the patient has a booking", for both the app and the webhook. */
    public BookingResponse finalizePaid(AppointmentPayment payment, String razorpayPaymentId, String signature, UUID aiReportId) {
        FinalizeResult result = transactions.finalizeBooking(payment.getId(), razorpayPaymentId, signature, aiReportId);
        switch (result.outcome()) {
            case BOOKED -> {
                if (!payment.isTestMode() && razorpayPaymentId != null) ensureCaptured(payment, razorpayPaymentId);
                notifications.notify(payment.getDoctorId(), "payment", "New paid appointment", "A patient has booked and paid for a consultation.", Map.of("appointmentId", result.appointmentId().toString()));
                return new BookingResponse(result.appointmentId(), false);
            }
            case ALREADY_BOOKED -> {
                return new BookingResponse(result.appointmentId(), true);
            }
            case SLOT_LOST -> {
                boolean refunded = refund(payment.getId(), razorpayPaymentId, "slot_unavailable");
                throw ApiError.conflict(refunded ? "slot_taken_refunded" : "slot_taken_refund_pending", refunded ? SLOT_REFUNDED : SLOT_REFUND_PENDING);
            }
            default -> throw ApiError.badRequest("finalize_failed", "We could not complete this booking. Please contact support.");
        }
    }

    /** Cancels, refunds if money was taken, and tells the other person. */
    public String cancelAppointment(CurrentUser user, UUID appointmentId) {
        AppointmentService.CancelOutcome outcome = appointmentService.cancel(user, appointmentId);
        String refund = "none";
        if (outcome.paidPayment().isPresent()) {
            AppointmentPayment payment = outcome.paidPayment().get();
            refund = refund(payment.getId(), payment.getPaymentId(), "appointment_cancelled") ? "started" : "pending";
        }
        Map<String, Object> data = Map.of("appointmentId", appointmentId.toString());
        if ("patient".equals(outcome.cancelledBy())) {
            notifications.notify(outcome.doctorId(), "appointment_update", "Appointment cancelled", "The patient cancelled their consultation on " + outcome.when() + ".", data);
        } else {
            notifications.notify(outcome.patientId(), "appointment_update", "Appointment cancelled", "Your doctor cancelled the consultation on " + outcome.when() + ". Your refund has been started.", data);
        }
        return refund;
    }

    public List<PaymentHistoryItem> history(UUID patientId, int page) {
        return payments.findHistoryForPatient(patientId, PageRequest.of(Math.max(page, 0), 30)).stream()
            .map(p -> new PaymentHistoryItem(p.getId(), p.getAppointmentId(), p.getDoctorId(), p.getGrossAmount(), p.getCurrency(), p.getStatus(), p.getPaidAt(), p.getCreatedAt()))
            .toList();
    }

    public List<EarningItem> earnings(UUID doctorId, int page) {
        return payments.findEarningsForDoctor(doctorId, PageRequest.of(Math.max(page, 0), 30)).stream()
            .map(p -> new EarningItem(p.getId(), p.getAppointmentId(), p.getGrossAmount(), p.getDoctorShare(), p.getPayoutStatus(), p.getPaidAt()))
            .toList();
    }

    /** Returns true once the money is on its way back, or if no real money moved. */
    public boolean refund(UUID paymentRowId, String razorpayPaymentId, String reason) {
        AppointmentPayment row = payments.findById(paymentRowId).orElse(null);
        if (row == null) return false;
        if ("refunded".equals(row.getStatus())) return true;
        if (row.isTestMode()) {
            transactions.markFailed(paymentRowId);
            return true;
        }
        // Only a captured payment can be refunded.
        ensureCaptured(row, razorpayPaymentId);
        RazorpayClient.Result result = razorpay.refund(razorpayPaymentId, reason);
        if (result.ok() && result.body().hasNonNull("id")) {
            Map<String, Object> changes = new HashMap<>();
            changes.put("refund_id", result.body().path("id").asText());
            changes.put("refund_status", result.body().path("status").asText());
            changes.put("refund_reason", reason);
            changes.put("needs_manual_recovery", !"pending".equals(row.getPayoutStatus()));
            transactions.markRefunded(paymentRowId, razorpayPaymentId, changes);
            return true;
        }
        // The app and the webhook can race here, and Razorpay rejects the second refund. That is not a failure.
        if (payments.findById(paymentRowId).map(p -> "refunded".equals(p.getStatus())).orElse(false)) return true;
        log.error("Refund failed for payment row {}: {}", paymentRowId, result.error());
        Map<String, Object> changes = new HashMap<>();
        changes.put("refund_reason", reason);
        changes.put("needs_manual_refund", true);
        changes.put("refund_error", String.valueOf(result.error()));
        transactions.markRefundFailed(paymentRowId, razorpayPaymentId, changes);
        return false;
    }

    // A payment left "authorized" is only held, and Razorpay gives it back after some days unless it is captured.
    private void ensureCaptured(AppointmentPayment payment, String razorpayPaymentId) {
        RazorpayClient.Result current = razorpay.getPayment(razorpayPaymentId);
        if (!current.ok()) {
            transactions.updateMetadata(payment.getId(), Map.of("capture_error", String.valueOf(current.error())));
            return;
        }
        if (!"authorized".equals(current.body().path("status").asText())) return;
        RazorpayClient.Result captured = razorpay.capture(razorpayPaymentId, current.body().path("amount").asLong(), current.body().path("currency").asText("INR"));
        if (!captured.ok()) {
            transactions.updateMetadata(payment.getId(), Map.of("capture_error", String.valueOf(captured.error())));
        }
    }

    private BigDecimal parseFee(String fee) {
        String digits = fee == null ? "" : fee.replaceAll("[^0-9.]", "");
        try {
            BigDecimal value = new BigDecimal(digits);
            if (value.signum() > 0) return value.setScale(2, RoundingMode.HALF_UP);
        } catch (NumberFormatException ignored) {
            // A fee nobody can read falls back to the default.
        }
        return properties.booking().defaultFeeInr().setScale(2, RoundingMode.HALF_UP);
    }
}
