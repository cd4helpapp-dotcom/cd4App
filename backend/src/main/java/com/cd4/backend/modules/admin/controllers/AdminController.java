package com.cd4.backend.modules.admin.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.admin.services.AdminService;
import com.cd4.backend.modules.auth.services.AuthService;
import com.cd4.backend.modules.doctors.models.Doctor;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class AdminController {
    private final AdminService admin;
    private final AuthService auth;

    public record CreateAccount(@NotBlank @Email String email, @NotBlank @Size(min = 12, max = 72) String password, @NotBlank @Size(max = 60) String firstName, @NotBlank @Size(max = 60) String lastName, @NotBlank String role) {}

    public record CreatedAccount(UUID id) {}

    public record VerifyRequest(boolean verified) {}

    public record ResolveReport(@NotBlank String status, boolean hidePost) {}

    public record StatusRequest(@NotBlank String status) {}

    public record PayoutRequest(@NotBlank @Size(max = 120) String paymentReference, @Size(max = 500) String notes) {}

    public record PayoutResponse(UUID payoutId) {}

    @PostMapping("/accounts")
    ApiResponse<CreatedAccount> createAccount(@Valid @RequestBody CreateAccount request) {
        return ApiResponse.ok(new CreatedAccount(auth.createStaffAccount(request.email(), request.password(), request.firstName(), request.lastName(), request.role())));
    }

    @GetMapping("/doctors/pending")
    ApiResponse<List<Doctor>> pendingDoctors(@RequestParam(defaultValue = "0") int page) {
        return ApiResponse.ok(admin.pendingDoctors(page));
    }

    @PatchMapping("/doctors/{id}/verification")
    ApiResponse<Void> verify(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id, @RequestBody VerifyRequest request) {
        admin.verifyDoctor(user.id(), id, request.verified());
        return ApiResponse.ok(null);
    }

    @GetMapping("/community/reports")
    ApiResponse<List<Map<String, Object>>> reports() {
        return ApiResponse.ok(admin.openCommunityReports());
    }

    @PatchMapping("/community/reports/{id}")
    ApiResponse<Void> resolve(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id, @Valid @RequestBody ResolveReport request) {
        admin.resolveCommunityReport(user.id(), id, request.status(), request.hidePost());
        return ApiResponse.ok(null);
    }

    @GetMapping("/support/tickets")
    ApiResponse<List<Map<String, Object>>> tickets(@RequestParam(required = false) String status) {
        return ApiResponse.ok(admin.tickets(status));
    }

    @PatchMapping("/support/tickets/{id}")
    ApiResponse<Void> updateTicket(@PathVariable UUID id, @Valid @RequestBody StatusRequest request) {
        admin.updateTicket(id, request.status());
        return ApiResponse.ok(null);
    }

    @GetMapping("/hospitals/requests")
    ApiResponse<List<Map<String, Object>>> hospitalRequests(@RequestParam(required = false) String status) {
        return ApiResponse.ok(admin.hospitalRequests(status));
    }

    @PatchMapping("/hospitals/requests/{id}")
    ApiResponse<Void> updateHospitalRequest(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id, @Valid @RequestBody StatusRequest request) {
        admin.updateHospitalRequest(user.id(), id, request.status());
        return ApiResponse.ok(null);
    }

    @GetMapping("/payouts/due")
    ApiResponse<List<Map<String, Object>>> payoutsDue() {
        return ApiResponse.ok(admin.payoutSummary());
    }

    @PostMapping("/payouts/{doctorId}")
    ApiResponse<PayoutResponse> payout(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID doctorId, @Valid @RequestBody PayoutRequest request) {
        return ApiResponse.ok(new PayoutResponse(admin.recordPayout(user.id(), doctorId, request.paymentReference(), request.notes())));
    }

    @GetMapping("/audit-logs")
    ApiResponse<List<Map<String, Object>>> auditLogs() {
        return ApiResponse.ok(admin.auditLogs());
    }
}
