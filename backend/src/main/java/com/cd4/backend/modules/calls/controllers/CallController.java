package com.cd4.backend.modules.calls.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.calls.dtos.CallDtos.CallResponse;
import com.cd4.backend.modules.calls.dtos.CallDtos.CallTokenResponse;
import com.cd4.backend.modules.calls.dtos.CallDtos.StartCallRequest;
import com.cd4.backend.modules.calls.services.CallService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/calls")
@RequiredArgsConstructor
public class CallController {
    private final CallService callService;

    @PostMapping
    ApiResponse<CallResponse> start(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody StartCallRequest request) {
        return ApiResponse.ok(callService.start(request.roomId(), user.id(), request.type()));
    }

    @PostMapping("/{id}/accept")
    ApiResponse<CallResponse> accept(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        return ApiResponse.ok(callService.accept(id, user.id()));
    }

    @PostMapping("/{id}/decline")
    ApiResponse<CallResponse> decline(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        return ApiResponse.ok(callService.decline(id, user.id()));
    }

    @PostMapping("/{id}/end")
    ApiResponse<CallResponse> end(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        return ApiResponse.ok(callService.end(id, user.id()));
    }

    @GetMapping("/token/{roomId}")
    ApiResponse<CallTokenResponse> token(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID roomId) {
        return ApiResponse.ok(callService.token(roomId, user.id()));
    }
}
