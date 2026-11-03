package com.cd4.backend.modules.payments.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.BookingResponse;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.CreateOrderRequest;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.EarningItem;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.OrderResponse;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.PaymentHistoryItem;
import com.cd4.backend.modules.payments.dtos.PaymentDtos.VerifyRequest;
import com.cd4.backend.modules.payments.services.PaymentService;
import com.cd4.backend.modules.payments.services.RazorpayWebhookService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class PaymentController {
    private final PaymentService paymentService;
    private final RazorpayWebhookService webhookService;

    @PostMapping("/api/v1/payments/appointments/order")
    @PreAuthorize("hasRole('PATIENT')")
    ApiResponse<OrderResponse> createOrder(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody CreateOrderRequest request) {
        return ApiResponse.ok(paymentService.createOrder(user, request));
    }

    @PostMapping("/api/v1/payments/appointments/verify")
    @PreAuthorize("hasRole('PATIENT')")
    ApiResponse<BookingResponse> verify(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody VerifyRequest request) {
        return ApiResponse.ok(paymentService.verifyAndBook(user, request));
    }

    @GetMapping("/api/v1/payments/history")
    ApiResponse<List<PaymentHistoryItem>> history(@AuthenticationPrincipal CurrentUser user, @RequestParam(defaultValue = "0") int page) {
        return ApiResponse.ok(paymentService.history(user.id(), page));
    }

    @GetMapping("/api/v1/payments/earnings")
    @PreAuthorize("hasRole('DOCTOR')")
    ApiResponse<List<EarningItem>> earnings(@AuthenticationPrincipal CurrentUser user, @RequestParam(defaultValue = "0") int page) {
        return ApiResponse.ok(paymentService.earnings(user.id(), page));
    }

    /** Raw body on purpose: the signature is over the exact bytes Razorpay sent. */
    @PostMapping("/api/v1/webhooks/razorpay")
    ApiResponse<Void> webhook(
        @RequestBody String rawBody,
        @RequestHeader(value = "X-Razorpay-Signature", required = false) String signature,
        @RequestHeader(value = "X-Razorpay-Event-Id", required = false) String eventId
    ) throws Exception {
        webhookService.handle(rawBody, signature, eventId);
        return ApiResponse.ok(null);
    }
}
