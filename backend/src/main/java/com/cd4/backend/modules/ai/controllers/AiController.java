package com.cd4.backend.modules.ai.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.ai.dtos.AiDtos.ConversationResponse;
import com.cd4.backend.modules.ai.dtos.AiDtos.CreateConversationRequest;
import com.cd4.backend.modules.ai.dtos.AiDtos.MessageResponse;
import com.cd4.backend.modules.ai.dtos.AiDtos.ReplyResponse;
import com.cd4.backend.modules.ai.dtos.AiDtos.SendRequest;
import com.cd4.backend.modules.ai.services.AiChatService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/ai/conversations")
@RequiredArgsConstructor
public class AiController {
    private final AiChatService aiChat;

    @GetMapping
    ApiResponse<List<ConversationResponse>> list(@AuthenticationPrincipal CurrentUser user, @RequestParam(defaultValue = "0") int page) {
        return ApiResponse.ok(aiChat.list(user.id(), page));
    }

    @PostMapping
    ApiResponse<ConversationResponse> create(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody CreateConversationRequest request) {
        return ApiResponse.ok(aiChat.create(user.id(), request.concern()));
    }

    @GetMapping("/{id}/messages")
    ApiResponse<List<MessageResponse>> messages(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        return ApiResponse.ok(aiChat.messages(user.id(), id));
    }

    @PostMapping("/{id}/messages")
    ApiResponse<ReplyResponse> send(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id, @Valid @RequestBody SendRequest request) {
        return ApiResponse.ok(aiChat.send(user.id(), id, request.text()));
    }

    @DeleteMapping("/{id}")
    ApiResponse<Void> delete(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        aiChat.delete(user.id(), id);
        return ApiResponse.ok(null);
    }
}
