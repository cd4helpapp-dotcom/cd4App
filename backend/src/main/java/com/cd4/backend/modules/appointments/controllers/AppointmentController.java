package com.cd4.backend.modules.appointments.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.appointments.dtos.AppointmentDtos.AppointmentResponse;
import com.cd4.backend.modules.appointments.dtos.AppointmentDtos.CancelResponse;
import com.cd4.backend.modules.appointments.dtos.AppointmentDtos.RescheduleRequest;
import com.cd4.backend.modules.appointments.services.AppointmentService;
import com.cd4.backend.modules.payments.services.PaymentService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/appointments")
@RequiredArgsConstructor
public class AppointmentController {
    private final AppointmentService appointmentService;
    private final PaymentService paymentService;

    @GetMapping
    ApiResponse<List<AppointmentResponse>> mine(@AuthenticationPrincipal CurrentUser user, @RequestParam(defaultValue = "0") int page) {
        return ApiResponse.ok(appointmentService.mine(user, page));
    }

    @GetMapping("/{id}")
    ApiResponse<AppointmentResponse> get(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        return ApiResponse.ok(appointmentService.get(user, id));
    }

    @PostMapping("/{id}/cancel")
    ApiResponse<CancelResponse> cancel(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        return ApiResponse.ok(new CancelResponse(paymentService.cancelAppointment(user, id)));
    }

    @PostMapping("/{id}/reschedule")
    ApiResponse<Void> reschedule(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id, @Valid @RequestBody RescheduleRequest request) {
        appointmentService.reschedule(user, id, request.slotId());
        return ApiResponse.ok(null);
    }

    @PostMapping("/{id}/complete")
    ApiResponse<Void> complete(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        appointmentService.complete(user, id);
        return ApiResponse.ok(null);
    }
}
