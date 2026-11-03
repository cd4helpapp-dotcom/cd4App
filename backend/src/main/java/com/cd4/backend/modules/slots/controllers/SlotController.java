package com.cd4.backend.modules.slots.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.slots.dtos.SlotDtos.CreateSlotRequest;
import com.cd4.backend.modules.slots.dtos.SlotDtos.SlotResponse;
import com.cd4.backend.modules.slots.services.SlotService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/slots")
@PreAuthorize("hasRole('DOCTOR')")
@RequiredArgsConstructor
public class SlotController {
    private final SlotService slotService;

    @GetMapping("/mine")
    ApiResponse<List<SlotResponse>> mine(@AuthenticationPrincipal CurrentUser user) {
        return ApiResponse.ok(slotService.ownSlots(user.id()));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    ApiResponse<SlotResponse> create(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody CreateSlotRequest request) {
        return ApiResponse.ok(slotService.create(user.id(), request));
    }

    @DeleteMapping("/{id}")
    ApiResponse<Void> delete(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        slotService.delete(user.id(), id);
        return ApiResponse.ok(null);
    }
}
