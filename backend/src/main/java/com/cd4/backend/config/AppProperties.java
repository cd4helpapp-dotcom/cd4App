package com.cd4.backend.config;

import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "cd4")
public record AppProperties(Security security, Booking booking, Razorpay razorpay, Agora agora, Ai ai, Storage storage) {

    public record Security(String jwtSecret, int accessTokenMinutes, int refreshTokenDays, int maxFailedLogins, int lockMinutes, String corsAllowedOrigins) {}

    public record Booking(String timeZone, int slotHoldMinutes, int rebookCooldownDays, int patientChangeCutoffHours, BigDecimal defaultFeeInr, BigDecimal doctorShare) {}

    public record Razorpay(String keyId, String keySecret, String webhookSecret) {
        public boolean isLive() {
            return keyId != null && !keyId.isBlank() && keySecret != null && !keySecret.isBlank();
        }
    }

    public record Agora(String appId, String appCertificate) {}

    public record Ai(String openaiApiKey, String chatModel, String qualityModel, int freeMessagesPerDay, int proMessagesPerDay) {}

    public record Storage(String dir) {}
}
