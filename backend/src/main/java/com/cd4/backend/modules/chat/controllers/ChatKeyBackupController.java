package com.cd4.backend.modules.chat.controllers;

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
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** A person's encrypted chat key, kept so a new phone can read old messages. The server only ever holds it wrapped. */
@RestController
@RequestMapping("/api/v1/chat/key-backup")
@RequiredArgsConstructor
public class ChatKeyBackupController {
    private final JdbcTemplate jdbc;
    private final JdbcRows rows;

    public record SaveBackup(@NotBlank @Size(max = 500) String publicKey, @NotBlank @Size(max = 4000) String wrappedSecretKey, @Size(max = 40) String wrapAlg) {}

    @GetMapping
    ApiResponse<Map<String, Object>> get(@AuthenticationPrincipal CurrentUser user) {
        List<Map<String, Object>> found = rows.query("SELECT public_key, wrapped_secret_key, wrap_alg FROM chat_e2ee_key_backups WHERE user_id = ?", user.id());
        if (found.isEmpty()) throw ApiError.notFound("No key backup was found.");
        return ApiResponse.ok(found.get(0));
    }

    @PutMapping
    ApiResponse<Void> save(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody SaveBackup request) {
        jdbc.update("""
            INSERT INTO chat_e2ee_key_backups (user_id, public_key, wrapped_secret_key, wrap_alg) VALUES (?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET public_key = EXCLUDED.public_key, wrapped_secret_key = EXCLUDED.wrapped_secret_key, wrap_alg = EXCLUDED.wrap_alg, updated_at = now()
            """, user.id(), request.publicKey(), request.wrappedSecretKey(), request.wrapAlg() == null ? "aes-gcm-v1" : request.wrapAlg());
        return ApiResponse.ok(null);
    }
}
