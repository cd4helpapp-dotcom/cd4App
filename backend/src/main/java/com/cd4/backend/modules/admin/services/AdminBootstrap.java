package com.cd4.backend.modules.admin.services;

import com.cd4.backend.constants.Roles;
import com.cd4.backend.modules.auth.services.AuthService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Creates the first admin from environment values, once. After that, remove the values. */
@Slf4j
@Component
@RequiredArgsConstructor
public class AdminBootstrap implements ApplicationRunner {
    private final AuthService auth;
    private final JdbcTemplate jdbc;

    @Value("${BOOTSTRAP_ADMIN_EMAIL:}")
    private String email;

    @Value("${BOOTSTRAP_ADMIN_PASSWORD:}")
    private String password;

    @Override
    public void run(ApplicationArguments args) {
        if (email.isBlank() || password.length() < 12) return;
        Boolean exists = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM profiles p JOIN roles r ON r.id = p.role_id WHERE r.slug = 'admin')", Boolean.class);
        if (Boolean.TRUE.equals(exists)) return;
        auth.createStaffAccount(email, password, "CD4", "Admin", Roles.ADMIN);
        log.info("Created the first admin account");
    }
}
