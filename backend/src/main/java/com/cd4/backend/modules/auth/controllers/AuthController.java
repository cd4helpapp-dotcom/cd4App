package com.cd4.backend.modules.auth.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.auth.dtos.AuthDtos.ChangePasswordRequest;
import com.cd4.backend.modules.auth.dtos.AuthDtos.LoginRequest;
import com.cd4.backend.modules.auth.dtos.AuthDtos.RefreshRequest;
import com.cd4.backend.modules.auth.dtos.AuthDtos.RegisterRequest;
import com.cd4.backend.modules.auth.dtos.AuthDtos.TokenResponse;
import com.cd4.backend.modules.auth.services.AuthService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {
    private final AuthService authService;

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    ApiResponse<TokenResponse> register(@Valid @RequestBody RegisterRequest request) {
        return ApiResponse.ok(authService.register(request));
    }

    @PostMapping("/login")
    ApiResponse<TokenResponse> login(@Valid @RequestBody LoginRequest request) {
        return ApiResponse.ok(authService.login(request));
    }

    @PostMapping("/refresh")
    ApiResponse<TokenResponse> refresh(@Valid @RequestBody RefreshRequest request) {
        return ApiResponse.ok(authService.refresh(request.refreshToken()));
    }

    @PostMapping("/logout")
    ApiResponse<Void> logout(@Valid @RequestBody RefreshRequest request) {
        authService.logout(request.refreshToken());
        return ApiResponse.ok(null);
    }

    @PostMapping("/change-password")
    ApiResponse<Void> changePassword(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody ChangePasswordRequest request) {
        authService.changePassword(user.id(), request);
        return ApiResponse.ok(null);
    }
}
