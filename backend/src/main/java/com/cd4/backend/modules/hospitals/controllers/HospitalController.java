package com.cd4.backend.modules.hospitals.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.hospitals.dtos.HospitalDtos.AddDoctorRequest;
import com.cd4.backend.modules.hospitals.dtos.HospitalDtos.OnboardingRequest;
import com.cd4.backend.modules.hospitals.services.HospitalService;
import com.cd4.backend.modules.users.services.UserService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/hospitals")
@PreAuthorize("hasRole('HOSPITAL')")
@RequiredArgsConstructor
public class HospitalController {
    private final HospitalService hospitals;
    private final UserService users;

    @PostMapping("/onboarding")
    ApiResponse<Void> onboarding(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody OnboardingRequest request) {
        hospitals.submitOnboarding(user.id(), request, users.require(user.id()).getEmail());
        return ApiResponse.ok(null);
    }

    @GetMapping("/onboarding")
    ApiResponse<List<Map<String, Object>>> status(@AuthenticationPrincipal CurrentUser user) {
        return ApiResponse.ok(hospitals.onboardingStatus(user.id()));
    }

    @GetMapping("/doctors")
    ApiResponse<List<Map<String, Object>>> doctors(@AuthenticationPrincipal CurrentUser user) {
        return ApiResponse.ok(hospitals.doctors(user.id()));
    }

    @PostMapping("/doctors")
    ApiResponse<Void> addDoctor(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody AddDoctorRequest request) {
        hospitals.addDoctor(user.id(), request.doctorId(), request.department());
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/doctors/{doctorId}")
    ApiResponse<Void> removeDoctor(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID doctorId) {
        hospitals.removeDoctor(user.id(), doctorId);
        return ApiResponse.ok(null);
    }

    @GetMapping("/patients")
    ApiResponse<List<Map<String, Object>>> patients(@AuthenticationPrincipal CurrentUser user) {
        return ApiResponse.ok(hospitals.patients(user.id()));
    }
}
