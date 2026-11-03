package com.cd4.backend.middlewares;

import com.cd4.backend.constants.Roles;
import java.util.UUID;

/** Who is making this request, taken from a verified token only. */
public record CurrentUser(UUID id, String role) {
    public boolean isAdmin() {
        return Roles.ADMIN.equals(role);
    }

    public boolean isDoctor() {
        return Roles.DOCTOR.equals(role);
    }
}
