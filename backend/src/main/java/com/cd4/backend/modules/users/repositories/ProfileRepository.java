package com.cd4.backend.modules.users.repositories;

import com.cd4.backend.modules.users.models.Profile;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface ProfileRepository extends JpaRepository<Profile, UUID> {
    List<Profile> findByIdIn(Collection<UUID> ids);

    @Query("select r.slug from Profile p, Role r where p.id = :id and r.id = p.roleId")
    java.util.Optional<String> findRoleSlug(UUID id);

    @Modifying
    @Query("update Profile p set p.lastSeenAt = :now where p.id = :id")
    int touchLastSeen(UUID id, Instant now);
}
