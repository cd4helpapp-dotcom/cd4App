package com.cd4.backend.modules.content.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.utils.ApiError;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import com.cd4.backend.utils.JdbcRows;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Pages such as the privacy policy and terms, which an admin can edit without an app release. */
@RestController
@RequestMapping("/api/v1/content")
@RequiredArgsConstructor
public class ContentController {
    private final JdbcTemplate jdbc;
    private final JdbcRows rows;

    public record UpdatePage(@NotBlank @Size(max = 160) String title, @NotBlank @Size(max = 100000) String body) {}

    @GetMapping("/{key}")
    ApiResponse<Map<String, Object>> get(@PathVariable String key) {
        List<Map<String, Object>> found = rows.query("SELECT key, title, body, updated_at FROM app_content_pages WHERE key = ?", key);
        if (found.isEmpty()) throw ApiError.notFound("This page was not found.");
        return ApiResponse.ok(found.get(0));
    }

    @PutMapping("/{key}")
    @PreAuthorize("hasRole('ADMIN')")
    ApiResponse<Void> put(@AuthenticationPrincipal CurrentUser user, @PathVariable String key, @Valid @RequestBody UpdatePage request) {
        jdbc.update("""
            INSERT INTO app_content_pages (key, title, body, updated_by) VALUES (?, ?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now()
            """, key, request.title(), request.body(), user.id());
        return ApiResponse.ok(null);
    }
}
