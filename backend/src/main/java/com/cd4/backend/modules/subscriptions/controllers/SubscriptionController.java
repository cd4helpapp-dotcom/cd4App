package com.cd4.backend.modules.subscriptions.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.subscriptions.services.SubscriptionService;
import com.cd4.backend.modules.subscriptions.services.SubscriptionService.OrderResponse;
import com.cd4.backend.modules.subscriptions.services.SubscriptionService.StatusResponse;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/subscriptions")
@RequiredArgsConstructor
public class SubscriptionController {
    private final SubscriptionService subscriptions;

    public record CreateRequest(String billingCycle) {}

    public record VerifyRequest(@NotBlank String orderId, @NotBlank String paymentId, @NotBlank String signature) {}

    @GetMapping("/me")
    ApiResponse<StatusResponse> me(@AuthenticationPrincipal CurrentUser user) {
        return ApiResponse.ok(subscriptions.status(user.id()));
    }

    @PostMapping("/order")
    ApiResponse<OrderResponse> order(@AuthenticationPrincipal CurrentUser user, @RequestBody CreateRequest request) {
        return ApiResponse.ok(subscriptions.createOrder(user.id(), request.billingCycle()));
    }

    @PostMapping("/verify")
    ApiResponse<StatusResponse> verify(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody VerifyRequest request) {
        return ApiResponse.ok(subscriptions.verify(user.id(), request.orderId(), request.paymentId(), request.signature()));
    }

    @PostMapping("/cancel")
    ApiResponse<Void> cancel(@AuthenticationPrincipal CurrentUser user) {
        subscriptions.cancel(user.id());
        return ApiResponse.ok(null);
    }
}
