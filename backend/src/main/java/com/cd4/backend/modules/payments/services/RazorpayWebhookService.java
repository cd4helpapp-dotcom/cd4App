package com.cd4.backend.modules.payments.services;

import com.cd4.backend.modules.payments.models.AppointmentPayment;
import com.cd4.backend.modules.payments.models.PaymentWebhookEvent;
import com.cd4.backend.modules.payments.repositories.AppointmentPaymentRepository;
import com.cd4.backend.modules.payments.repositories.PaymentWebhookEventRepository;
import com.cd4.backend.utils.ApiError;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/** Books a paid order when the patient's app died before it could verify the payment itself. */
@Slf4j
@Service
@RequiredArgsConstructor
public class RazorpayWebhookService {
    private final RazorpayClient razorpay;
    private final PaymentWebhookEventRepository events;
    private final AppointmentPaymentRepository payments;
    private final PaymentService paymentService;
    private final BookingTransactions transactions;
    private final ObjectMapper mapper;

    public void handle(String rawBody, String signature, String eventIdHeader) throws Exception {
        if (!razorpay.verifyWebhookSignature(rawBody, signature)) {
            throw ApiError.unauthorized("Invalid signature.");
        }
        JsonNode body = mapper.readTree(rawBody);
        String type = body.path("event").asText("");
        // Razorpay retries deliveries. Falling back to a hash of the body still recognises a repeat.
        String eventId = eventIdHeader != null && !eventIdHeader.isBlank() ? eventIdHeader : sha256(rawBody);

        PaymentWebhookEvent event = events.findByEventId(eventId).orElse(null);
        if (event != null && event.isProcessed()) return;
        if (event == null) {
            event = new PaymentWebhookEvent();
            event.setEventId(eventId);
            event.setEventType(type);
            event.setPayload(mapper.convertValue(body, new TypeReference<Map<String, Object>>() {}));
            try {
                event = events.saveAndFlush(event);
            } catch (DataIntegrityViolationException duplicate) {
                return;
            }
        }

        String error = null;
        try {
            process(type, body);
        } catch (ApiError expected) {
            // A lost slot was already refunded inside the booking step. Retrying would not change anything.
            log.info("Webhook {} ended with {}", eventId, expected.getCode());
        } catch (Exception unexpected) {
            log.error("Webhook {} failed", eventId, unexpected);
            error = unexpected.getMessage();
        }
        event.setProcessed(error == null);
        event.setProcessedAt(Instant.now());
        event.setProcessingError(error);
        events.save(event);
        if (error != null) {
            // A non-2xx answer makes Razorpay deliver this again later.
            throw new IllegalStateException("Webhook processing failed");
        }
    }

    private void process(String type, JsonNode body) {
        JsonNode entity = body.path("payload").path("payment").path("entity");
        String orderId = entity.path("order_id").asText("");
        if (orderId.isBlank()) return;
        AppointmentPayment payment = payments.findByOrderId(orderId).orElse(null);
        if (payment == null) return;
        switch (type) {
            case "payment.captured", "payment.authorized", "order.paid" ->
                paymentService.finalizePaid(payment, entity.path("id").asText(null), null, null);
            case "payment.failed" -> transactions.markFailed(payment.getId());
            default -> { }
        }
    }

    private static String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }
}
