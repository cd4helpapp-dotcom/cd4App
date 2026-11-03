package com.cd4.backend.modules.users.repositories;

import com.cd4.backend.modules.users.models.Role;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoleRepository extends JpaRepository<Role, UUID> {
    Optional<Role> findBySlug(String slug);
}
