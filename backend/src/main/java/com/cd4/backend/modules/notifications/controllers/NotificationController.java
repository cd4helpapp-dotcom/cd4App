package com.cd4.backend.modules.notifications.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.notifications.models.InAppNotification;
import com.cd4.backend.modules.notifications.repositories.InAppNotificationRepository;
import com.cd4.backend.utils.ApiResponse;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/notifications")
@RequiredArgsConstructor
public class NotificationController {
    private final InAppNotificationRepository notifications;

    @GetMapping
    ApiResponse<List<InAppNotification>> list(@AuthenticationPrincipal CurrentUser user, @RequestParam(defaultValue = "0") int page) {
        return ApiResponse.ok(notifications.findByUserIdOrderByCreatedAtDesc(user.id(), PageRequest.of(Math.max(page, 0), 30)).getContent());
    }

    @GetMapping("/unread-count")
    ApiResponse<Map<String, Long>> unreadCount(@AuthenticationPrincipal CurrentUser user) {
        return ApiResponse.ok(Map.of("count", notifications.countByUserIdAndReadFalse(user.id())));
    }

    @PostMapping("/{id}/read")
    @Transactional
    ApiResponse<Void> read(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        notifications.markRead(id, user.id());
        return ApiResponse.ok(null);
    }

    @PostMapping("/read-all")
    @Transactional
    ApiResponse<Void> readAll(@AuthenticationPrincipal CurrentUser user) {
        notifications.markAllRead(user.id());
        return ApiResponse.ok(null);
    }
}
