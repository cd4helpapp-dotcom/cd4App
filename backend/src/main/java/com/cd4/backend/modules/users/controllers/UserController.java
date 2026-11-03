package com.cd4.backend.modules.users.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.users.dtos.UserDtos.ChatKeyRequest;
import com.cd4.backend.modules.users.dtos.UserDtos.MeResponse;
import com.cd4.backend.modules.users.dtos.UserDtos.PresenceResponse;
import com.cd4.backend.modules.users.dtos.UserDtos.PublicProfile;
import com.cd4.backend.modules.users.dtos.UserDtos.PushTokenRequest;
import com.cd4.backend.modules.users.dtos.UserDtos.UpdateMeRequest;
import com.cd4.backend.modules.users.services.AccountDeletionService;
import com.cd4.backend.modules.users.services.UserService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class UserController {
    private final UserService userService;
    private final AccountDeletionService accountDeletion;

    public record DeleteAccountRequest(@NotBlank String password) {}

    @GetMapping("/me")
    ApiResponse<MeResponse> me(@AuthenticationPrincipal CurrentUser user) {
        return ApiResponse.ok(userService.me(user.id()));
    }

    @PatchMapping("/me")
    ApiResponse<MeResponse> update(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody UpdateMeRequest request) {
        return ApiResponse.ok(userService.update(user.id(), request));
    }

    @PutMapping("/me/push-token")
    ApiResponse<Void> pushToken(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody PushTokenRequest request) {
        userService.setPushToken(user.id(), request.pushToken());
        return ApiResponse.ok(null);
    }

    @PutMapping("/me/chat-key")
    ApiResponse<Void> chatKey(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody ChatKeyRequest request) {
        userService.setChatPublicKey(user.id(), request.chatPublicKey());
        return ApiResponse.ok(null);
    }

    @PostMapping("/me/heartbeat")
    ApiResponse<Void> heartbeat(@AuthenticationPrincipal CurrentUser user) {
        userService.heartbeat(user.id());
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/me")
    ApiResponse<Void> deleteAccount(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody DeleteAccountRequest request) {
        accountDeletion.delete(user.id(), request.password());
        return ApiResponse.ok(null);
    }

    @GetMapping("/{id}")
    ApiResponse<PublicProfile> publicProfile(@PathVariable UUID id) {
        return ApiResponse.ok(userService.publicProfile(id));
    }

    @GetMapping("/{id}/presence")
    ApiResponse<PresenceResponse> presence(@PathVariable UUID id) {
        return ApiResponse.ok(userService.presence(id));
    }
}
