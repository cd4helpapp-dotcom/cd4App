package com.cd4.backend.modules.support.services;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.cd4.backend.utils.JdbcRows;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class SupportService {
    private final JdbcTemplate jdbc;
    private final JdbcRows rows;

    public void createTicket(UUID userId, String name, String email, String phone, String subject, String message) {
        jdbc.update("INSERT INTO support_tickets (user_id, name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?, ?)",
            userId, name == null ? "" : name, email == null ? "" : email, phone == null ? "" : phone, subject, message);
    }

    public List<Map<String, Object>> own(UUID userId) {
        return rows.query("SELECT id, subject, message, status, created_at, resolved_at FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", userId);
    }
}
