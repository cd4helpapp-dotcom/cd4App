package com.cd4.backend.middlewares;

import com.cd4.backend.utils.ApiResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Per-address limit on the routes people try to guess passwords on. It lives in this process, which suits one server.
 * Running several servers needs a shared counter, such as Redis.
 */
@Component
@RequiredArgsConstructor
public class RateLimitFilter extends OncePerRequestFilter {
    private static final int AUTH_LIMIT_PER_MINUTE = 20;

    private final ObjectMapper mapper;
    private final Map<String, AtomicInteger> counters = new ConcurrentHashMap<>();

    @Scheduled(fixedRate = 60_000)
    void resetWindow() {
        counters.clear();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/v1/auth/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        int count = counters.computeIfAbsent(request.getRemoteAddr(), key -> new AtomicInteger()).incrementAndGet();
        if (count > AUTH_LIMIT_PER_MINUTE) {
            response.setStatus(429);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            mapper.writeValue(response.getOutputStream(), ApiResponse.error("rate_limited", "Too many attempts. Please wait a minute."));
            return;
        }
        chain.doFilter(request, response);
    }
}
