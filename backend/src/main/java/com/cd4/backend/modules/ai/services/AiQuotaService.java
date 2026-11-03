package com.cd4.backend.modules.ai.services;

import com.cd4.backend.config.AppProperties;
import com.cd4.backend.modules.subscriptions.services.SubscriptionService;
import com.cd4.backend.utils.ApiError;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AiQuotaService {
    private final JdbcTemplate jdbc;
    private final SubscriptionService subscriptions;
    private final AppProperties properties;

    /**
     * Counts a message and refuses once the day's limit is reached. One SQL statement does both,
     * so several messages sent together cannot slip past the limit.
     */
    public void consume(UUID userId) {
        int limit = subscriptions.isPro(userId) ? properties.ai().proMessagesPerDay() : properties.ai().freeMessagesPerDay();
        String day = LocalDate.now(ZoneId.of(properties.booking().timeZone())).toString();
        int changed = jdbc.update("""
            INSERT INTO ai_usage_stats (user_id, day_key, message_count) VALUES (?, ?, 1)
            ON CONFLICT (user_id, day_key) DO UPDATE
              SET message_count = ai_usage_stats.message_count + 1, updated_at = now()
              WHERE ai_usage_stats.message_count < ?
            """, userId, day, limit);
        if (changed == 0) {
            throw new ApiError(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS, "ai_daily_limit",
                "You have used your " + limit + " AI messages for today. Please try again tomorrow.");
        }
    }
}
