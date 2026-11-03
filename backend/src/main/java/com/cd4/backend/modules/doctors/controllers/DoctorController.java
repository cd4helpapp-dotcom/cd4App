package com.cd4.backend.modules.doctors.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.doctors.dtos.DoctorDtos.DoctorPrivate;
import com.cd4.backend.modules.doctors.dtos.DoctorDtos.DoctorPublic;
import com.cd4.backend.modules.doctors.dtos.DoctorDtos.SignatureRequest;
import com.cd4.backend.modules.doctors.dtos.DoctorDtos.UpdateDoctorRequest;
import com.cd4.backend.modules.doctors.services.DoctorService;
import com.cd4.backend.modules.slots.dtos.SlotDtos.SlotResponse;
import com.cd4.backend.modules.slots.services.SlotService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/doctors")
@RequiredArgsConstructor
public class DoctorController {
    private final DoctorService doctorService;
    private final SlotService slotService;

    @GetMapping
    ApiResponse<List<DoctorPublic>> search(
        @RequestParam(required = false) String city,
        @RequestParam(required = false) String specialization,
        @RequestParam(required = false) String name,
        @RequestParam(defaultValue = "0") int page
    ) {
        return ApiResponse.ok(doctorService.search(city, specialization, name, page));
    }

    @GetMapping("/{id:[0-9a-fA-F-]{36}}")
    ApiResponse<DoctorPublic> get(@PathVariable UUID id) {
        return ApiResponse.ok(doctorService.getPublic(id));
    }

    @GetMapping("/{id:[0-9a-fA-F-]{36}}/slots")
    ApiResponse<List<SlotResponse>> openSlots(@PathVariable UUID id) {
        return ApiResponse.ok(slotService.openSlots(id));
    }

    @GetMapping("/me/profile")
    @PreAuthorize("hasRole('DOCTOR')")
    ApiResponse<DoctorPrivate> me(@AuthenticationPrincipal CurrentUser user) {
        return ApiResponse.ok(doctorService.getOwn(user.id()));
    }

    @PatchMapping("/me/profile")
    @PreAuthorize("hasRole('DOCTOR')")
    ApiResponse<DoctorPrivate> update(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody UpdateDoctorRequest request) {
        return ApiResponse.ok(doctorService.update(user.id(), request));
    }

    @PutMapping("/me/signature")
    @PreAuthorize("hasRole('DOCTOR')")
    ApiResponse<DoctorPrivate> signature(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody SignatureRequest request) {
        return ApiResponse.ok(doctorService.setSignature(user.id(), request.signaturePath()));
    }
}
