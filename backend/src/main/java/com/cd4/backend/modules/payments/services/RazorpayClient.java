package com.cd4.backend.modules.payments.services;

import com.cd4.backend.config.AppProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class RazorpayClient {
    private static final String BASE_URL = "https://api.razorpay.com/v1/";

    private final AppProperties properties;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public record Result(boolean ok, JsonNode body, String error) {}

    public Result createOrder(long amountPaise, String receipt) {
        return call("POST", "orders", Map.of("amount", amountPaise, "currency", "INR", "receipt", receipt, "payment_capture", 1));
    }

    public Result getPayment(String paymentId) {
        return call("GET", "payments/" + paymentId, null);
    }

    public Result capture(String paymentId, long amountPaise, String currency) {
        return call("POST", "payments/" + paymentId + "/capture", Map.of("amount", amountPaise, "currency", currency));
    }

    public Result refund(String paymentId, String reason) {
        return call("POST", "payments/" + paymentId + "/refund", Map.of("notes", Map.of("reason", reason)));
    }

    /** Checks the signature Razorpay gives the app after a payment. Fails closed. */
    public boolean verifyPaymentSignature(String orderId, String paymentId, String signature) {
        String secret = properties.razorpay().keySecret();
        return secret != null && !secret.isBlank() && matches(hmacHex(orderId + "|" + paymentId, secret), signature);
    }

    /** Checks that a webhook really came from Razorpay. Without a configured secret, nothing is trusted. */
    public boolean verifyWebhookSignature(String rawBody, String signature) {
        String secret = properties.razorpay().webhookSecret();
        return secret != null && !secret.isBlank() && signature != null && matches(hmacHex(rawBody, secret), signature);
    }

    public static String hmacHex(String message, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // Constant time, so a forged signature cannot be worked out byte by byte from response times.
    private static boolean matches(String expected, String given) {
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), given.getBytes(StandardCharsets.UTF_8));
    }

    private Result call(String method, String path, Object body) {
        try {
            String auth = Base64.getEncoder().encodeToString((properties.razorpay().keyId() + ":" + properties.razorpay().keySecret()).getBytes(StandardCharsets.UTF_8));
            HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(BASE_URL + path))
                .timeout(Duration.ofSeconds(20))
                .header("Authorization", "Basic " + auth)
                .header("Content-Type", "application/json");
            if ("GET".equals(method)) {
                request.GET();
            } else {
                request.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
            }
            HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            JsonNode json = response.body() == null || response.body().isBlank() ? mapper.createObjectNode() : mapper.readTree(response.body());
            if (response.statusCode() < 300) {
                return new Result(true, json, null);
            }
            return new Result(false, json, json.path("error").path("description").asText("razorpay_error_" + response.statusCode()));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Result(false, null, "interrupted");
        } catch (Exception e) {
            return new Result(false, null, e.getMessage());
        }
    }
}
