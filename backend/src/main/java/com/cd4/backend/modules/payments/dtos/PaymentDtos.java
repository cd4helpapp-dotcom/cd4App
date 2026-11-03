package com.cd4.backend.modules.payments.dtos;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public final class PaymentDtos {
    private PaymentDtos() {}

    public record CreateOrderRequest(
        @NotNull UUID doctorId,
        @NotNull UUID slotId,
        String appointmentType,
        @Size(max = 300) String concern,
        UUID conversationId,
        UUID aiReportId
    ) {}

    public record OrderResponse(UUID paymentId, String orderId, BigDecimal amount, long amountPaise, String currency, String keyId, String mode) {}

    public record VerifyRequest(@NotBlank String orderId, @NotBlank String paymentId, @NotBlank String signature, UUID aiReportId) {}

    public record BookingResponse(UUID appointmentId, boolean alreadyBooked) {}

    public record PaymentHistoryItem(UUID id, UUID appointmentId, UUID doctorId, BigDecimal amount, String currency, String status, Instant paidAt, Instant createdAt) {}

    public record EarningItem(UUID id, UUID appointmentId, BigDecimal grossAmount, BigDecimal doctorShare, String payoutStatus, Instant paidAt) {}
}
