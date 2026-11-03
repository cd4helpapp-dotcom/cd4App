package com.cd4.backend.modules.support.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.support.services.SupportService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/support/tickets")
@RequiredArgsConstructor
public class SupportController {
    private final SupportService support;

    public record CreateTicket(@Size(max = 120) String name, @Size(max = 160) String email, @Size(max = 30) String phone, @NotBlank @Size(max = 160) String subject, @NotBlank @Size(max = 4000) String message) {}

    @PostMapping
    ApiResponse<Void> create(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody CreateTicket request) {
        support.createTicket(user.id(), request.name(), request.email(), request.phone(), request.subject(), request.message());
        return ApiResponse.ok(null);
    }

    @GetMapping
    ApiResponse<List<Map<String, Object>>> own(@AuthenticationPrincipal CurrentUser user) {
        return ApiResponse.ok(support.own(user.id()));
    }
}
