package com.cd4.backend.modules.subscriptions.services;

import com.cd4.backend.config.AppProperties;
import com.cd4.backend.modules.payments.services.RazorpayClient;
import com.cd4.backend.modules.subscriptions.models.SubscriptionPayment;
import com.cd4.backend.modules.subscriptions.models.UserSubscription;
import com.cd4.backend.modules.subscriptions.repositories.SubscriptionRepositories;
import com.cd4.backend.utils.ApiError;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class SubscriptionService {
    private final SubscriptionRepositories.Subscriptions subscriptions;
    private final SubscriptionRepositories.Payments payments;
    private final RazorpayClient razorpay;
    private final AppProperties properties;

    @Value("${PRO_MONTHLY_PRICE_INR:99}")
    private int monthlyPrice;

    @Value("${PRO_YEARLY_PRICE_INR:999}")
    private int yearlyPrice;

    public record OrderResponse(String orderId, BigDecimal amount, long amountPaise, String currency, String billingCycle, String keyId, String mode) {}

    public record StatusResponse(boolean active, String billingCycle, Instant expiresAt) {}

    public boolean isPro(UUID userId) {
        return !subscriptions.findCurrent(userId, Instant.now()).isEmpty();
    }

    public StatusResponse status(UUID userId) {
        List<UserSubscription> current = subscriptions.findCurrent(userId, Instant.now());
        if (current.isEmpty()) return new StatusResponse(false, null, null);
        return new StatusResponse(true, current.get(0).getBillingCycle(), current.get(0).getExpiresAt());
    }

    /** The order is saved against the person and the plan, so a cheap monthly payment can never be claimed as a yearly plan. */
    public OrderResponse createOrder(UUID userId, String billingCycleRaw) {
        String cycle = "monthly".equals(billingCycleRaw) ? "monthly" : "yearly";
        BigDecimal amount = BigDecimal.valueOf("monthly".equals(cycle) ? monthlyPrice : yearlyPrice);
        long paise = amount.multiply(BigDecimal.valueOf(100)).longValueExact();
        boolean live = properties.razorpay().isLive();
        String orderId;
        if (live) {
            RazorpayClient.Result order = razorpay.createOrder(paise, "sub_" + System.currentTimeMillis());
            if (!order.ok()) {
                throw new ApiError(HttpStatus.BAD_GATEWAY, "payment_provider_error", "Could not start the payment. Please try again.");
            }
            orderId = order.body().path("id").asText();
        } else {
            orderId = "order_test_" + UUID.randomUUID().toString().replace("-", "").substring(0, 18);
        }
        SubscriptionPayment payment = new SubscriptionPayment();
        payment.setUserId(userId);
        payment.setBillingCycle(cycle);
        payment.setAmount(amount);
        payment.setOrderId(orderId);
        payment.setRawPayload(Map.of("mode", live ? "live" : "test"));
        payments.save(payment);
        return new OrderResponse(orderId, amount, paise, "INR", cycle, live ? properties.razorpay().keyId() : null, live ? "live" : "test");
    }

    @Transactional
    public StatusResponse verify(UUID userId, String orderId, String paymentId, String signature) {
        // Locked, so a double tap activates once.
        SubscriptionPayment payment = payments.lockByOrderId(orderId).filter(p -> p.getUserId().equals(userId))
            .orElseThrow(() -> ApiError.notFound("This payment was not found."));
        if ("paid".equals(payment.getStatus())) {
            return status(userId);
        }
        boolean testOrder = "test".equals(payment.getRawPayload().get("mode"));
        if (!testOrder && !razorpay.verifyPaymentSignature(orderId, paymentId, signature)) {
            throw ApiError.badRequest("invalid_payment_signature", "We could not confirm this payment.");
        }
        Instant now = Instant.now();
        subscriptions.findOpen(userId).forEach(open -> {
            open.setStatus("cancelled");
            open.setCancelledAt(now);
        });
        Instant expires = now.plus(Duration.ofDays("monthly".equals(payment.getBillingCycle()) ? 30 : 365));
        UserSubscription subscription = new UserSubscription();
        subscription.setUserId(userId);
        subscription.setBillingCycle(payment.getBillingCycle());
        subscription.setStatus("active");
        subscription.setAmountPaid(payment.getAmount());
        subscription.setPaymentProvider("razorpay");
        subscription.setPaymentId(paymentId);
        subscription.setPaymentOrderId(orderId);
        subscription.setStartedAt(now);
        subscription.setExpiresAt(expires);
        subscription.setNextBillingAt(expires);
        subscriptions.saveAndFlush(subscription);
        payment.setSubscriptionId(subscription.getId());
        payment.setPaymentId(paymentId);
        payment.setStatus("paid");
        payment.setPaidAt(now);
        return new StatusResponse(true, subscription.getBillingCycle(), expires);
    }

    /** Stops renewal. The person keeps what they paid for until it runs out. */
    @Transactional
    public void cancel(UUID userId) {
        Instant now = Instant.now();
        subscriptions.findCurrent(userId, now).forEach(current -> {
            current.setCancelledAt(now);
            current.setNextBillingAt(null);
        });
    }
}
