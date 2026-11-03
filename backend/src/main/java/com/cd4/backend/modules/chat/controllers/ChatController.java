package com.cd4.backend.modules.chat.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.chat.dtos.ChatDtos.MessageResponse;
import com.cd4.backend.modules.chat.dtos.ChatDtos.RoomResponse;
import com.cd4.backend.modules.chat.dtos.ChatDtos.SendMessageRequest;
import com.cd4.backend.modules.chat.services.ChatService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/chat/rooms")
@RequiredArgsConstructor
public class ChatController {
    private final ChatService chatService;

    @GetMapping
    ApiResponse<List<RoomResponse>> rooms(@AuthenticationPrincipal CurrentUser user) {
        return ApiResponse.ok(chatService.roomsFor(user.id()));
    }

    @GetMapping("/{roomId}/messages")
    ApiResponse<List<MessageResponse>> messages(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID roomId, @RequestParam(required = false) UUID before) {
        return ApiResponse.ok(chatService.messages(roomId, user.id(), before));
    }

    @PostMapping("/{roomId}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    ApiResponse<MessageResponse> send(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID roomId, @Valid @RequestBody SendMessageRequest request) {
        return ApiResponse.ok(chatService.send(roomId, user.id(), request));
    }

    @PostMapping("/{roomId}/read")
    ApiResponse<Void> read(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID roomId) {
        chatService.markRead(roomId, user.id());
        return ApiResponse.ok(null);
    }

    @PostMapping("/{roomId}/typing")
    ApiResponse<Void> typing(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID roomId) {
        chatService.typing(roomId, user.id());
        return ApiResponse.ok(null);
    }
}
