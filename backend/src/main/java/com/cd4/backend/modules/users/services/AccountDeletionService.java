package com.cd4.backend.modules.users.services;

import com.cd4.backend.modules.auth.models.User;
import com.cd4.backend.modules.auth.repositories.UserRepository;
import com.cd4.backend.modules.files.services.FileStorageService;
import com.cd4.backend.utils.ApiError;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
@RequiredArgsConstructor
public class AccountDeletionService {
    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final FileStorageService storage;
    private final JdbcTemplate jdbc;

    /**
     * Database links remove the person's records. Their files are removed only after that has been saved,
     * so a failure never leaves an account pointing at files that are gone.
     */
    @Transactional
    public void delete(UUID userId, String password) {
        User user = users.findById(userId).orElseThrow(() -> ApiError.unauthorized("Please log in again."));
        if (user.getPasswordHash() == null || !passwordEncoder.matches(password, user.getPasswordHash())) {
            throw ApiError.badRequest("wrong_password", "Your password is not correct.");
        }
        Boolean hasUpcoming = jdbc.queryForObject("""
            SELECT EXISTS (SELECT 1 FROM appointments a JOIN slots s ON s.id = a.slot_id
                           WHERE (a.patient_id = ? OR a.doctor_id = ?) AND a.status IN ('pending', 'confirmed') AND s.date >= CURRENT_DATE)
            """, Boolean.class, userId, userId);
        // Deleting would silently remove a booking another person paid for or is relying on.
        if (Boolean.TRUE.equals(hasUpcoming)) {
            throw ApiError.conflict("active_appointments", "Please cancel your upcoming appointments before deleting your account.");
        }
        List<UUID> rooms = jdbc.queryForList("SELECT id FROM chat_rooms WHERE patient_id = ? OR doctor_id = ?", UUID.class, userId, userId);
        jdbc.update("DELETE FROM support_tickets WHERE user_id = ?", userId);
        users.delete(user);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                storage.deleteFolder(userId.toString());
                storage.deleteFolder("reports/" + userId);
                storage.deleteFolder("community/" + userId);
                rooms.forEach(room -> storage.deleteFolder("chat/" + room));
            }
        });
    }
}
