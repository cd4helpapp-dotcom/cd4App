package com.cd4.backend.modules.ai.services;

import com.cd4.backend.config.AppProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/** Thin wrapper over the OpenAI Responses API. Temperature is not set because the GPT-5.6 models reject it. */
@Slf4j
@Component
@RequiredArgsConstructor
public class OpenAiClient {
    private static final URI RESPONSES = URI.create("https://api.openai.com/v1/responses");

    private final AppProperties properties;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public boolean isConfigured() {
        String key = properties.ai().openaiApiKey();
        return key != null && !key.isBlank();
    }

    public record Turn(String role, String text) {}

    /** Plain text from a conversation. Returns null when the call failed, so the caller decides what the person sees. */
    public String chat(String model, String system, List<Turn> turns, int maxTokens, Duration timeout) {
        List<Object> input = new ArrayList<>();
        input.add(Map.of("role", "system", "content", system));
        for (Turn turn : turns) {
            input.add(Map.of("role", turn.role(), "content", turn.text()));
        }
        return call(Map.of("model", model, "reasoning", Map.of("effort", "low"), "max_output_tokens", maxTokens, "input", input), timeout);
    }

    /** Sends a prompt together with a document. PDFs go as files and photos at their original resolution. */
    public String withDocument(String model, String prompt, byte[] document, String mimeType, String fileName, int maxTokens, boolean jsonOnly, Duration timeout) {
        String dataUri = "data:" + mimeType + ";base64," + Base64.getEncoder().encodeToString(document);
        Map<String, Object> attachment = "application/pdf".equals(mimeType)
            ? Map.of("type", "input_file", "filename", fileName, "file_data", dataUri)
            : Map.of("type", "input_image", "image_url", dataUri, "detail", "original");
        Map<String, Object> body = new HashMap<>();
        body.put("model", model);
        body.put("reasoning", Map.of("effort", "low"));
        body.put("max_output_tokens", maxTokens);
        body.put("input", List.of(Map.of("role", "user", "content", List.of(Map.of("type", "input_text", "text", prompt), attachment))));
        if (jsonOnly) body.put("text", Map.of("format", Map.of("type", "json_object")));
        return call(body, timeout);
    }

    private String call(Map<String, Object> body, Duration timeout) {
        if (!isConfigured()) return null;
        try {
            HttpRequest request = HttpRequest.newBuilder(RESPONSES)
                .timeout(timeout)
                .header("Authorization", "Bearer " + properties.ai().openaiApiKey())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 300) {
                log.warn("OpenAI returned {}", response.statusCode());
                return null;
            }
            String text = outputText(mapper.readTree(response.body()));
            return text.isBlank() ? null : text.trim();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } catch (Exception e) {
            log.warn("OpenAI call failed: {}", e.getClass().getSimpleName());
            return null;
        }
    }

    private static String outputText(JsonNode root) {
        StringBuilder out = new StringBuilder();
        for (JsonNode item : root.path("output")) {
            for (JsonNode part : item.path("content")) {
                if ("output_text".equals(part.path("type").asText())) out.append(part.path("text").asText());
            }
        }
        return out.toString();
    }
}
