package com.cd4.backend.modules.notifications.services;

import com.cd4.backend.modules.notifications.models.InAppNotification;
import com.cd4.backend.modules.notifications.repositories.InAppNotificationRepository;
import com.cd4.backend.modules.users.models.Profile;
import com.cd4.backend.modules.users.repositories.ProfileRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/** Tells someone about something. A failed push must never undo the action that caused it, so nothing here throws. */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationService {
    private static final URI EXPO_PUSH_URL = URI.create("https://exp.host/--/api/v2/push/send");

    private final InAppNotificationRepository notifications;
    private final ProfileRepository profiles;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @Async
    public void notify(UUID userId, String type, String title, String body, Map<String, Object> data) {
        try {
            InAppNotification item = new InAppNotification();
            item.setUserId(userId);
            item.setType(type);
            item.setTitle(title);
            item.setBody(body);
            item.setData(data);
            notifications.save(item);
            sendPush(userId, title, body, data, "default", null);
        } catch (Exception e) {
            log.warn("Notification to {} failed: {}", userId, e.getMessage());
        }
    }

    /** A push only, for things that should not stay in the notification list, such as an incoming call. */
    @Async
    public void pushOnly(UUID userId, String title, String body, Map<String, Object> data, String channelId, Integer ttlSeconds) {
        try {
            sendPush(userId, title, body, data, channelId, ttlSeconds);
        } catch (Exception e) {
            log.warn("Push to {} failed: {}", userId, e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private void sendPush(UUID userId, String title, String body, Map<String, Object> data, String channelId, Integer ttlSeconds) throws Exception {
        Profile profile = profiles.findById(userId).orElse(null);
        if (profile == null || profile.getPushToken() == null) return;
        Object notificationSettings = profile.getSettings() == null ? null : profile.getSettings().get("notifications");
        if (notificationSettings instanceof Map<?, ?> map && Boolean.FALSE.equals(((Map<String, Object>) map).get("push"))) return;

        Map<String, Object> message = new HashMap<>();
        message.put("to", profile.getPushToken());
        message.put("sound", "default");
        message.put("priority", "high");
        message.put("title", title);
        message.put("body", body);
        message.put("channelId", channelId);
        if (data != null) message.put("data", data);
        if (ttlSeconds != null) message.put("ttl", ttlSeconds);

        HttpRequest request = HttpRequest.newBuilder(EXPO_PUSH_URL)
            .timeout(Duration.ofSeconds(10))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(message)))
            .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            log.warn("Expo push answered {}", response.statusCode());
        }
    }
}
