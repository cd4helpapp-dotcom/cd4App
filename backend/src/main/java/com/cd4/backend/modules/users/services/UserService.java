package com.cd4.backend.modules.users.services;

import com.cd4.backend.modules.users.dtos.UserDtos.MeResponse;
import com.cd4.backend.modules.users.dtos.UserDtos.PresenceResponse;
import com.cd4.backend.modules.users.dtos.UserDtos.PublicProfile;
import com.cd4.backend.modules.users.dtos.UserDtos.UpdateMeRequest;
import com.cd4.backend.modules.users.models.Profile;
import com.cd4.backend.modules.users.repositories.ProfileRepository;
import com.cd4.backend.utils.ApiError;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserService {
    private static final Duration ONLINE_WINDOW = Duration.ofSeconds(100);

    private final ProfileRepository profiles;

    public String roleSlugOf(UUID userId) {
        return profiles.findRoleSlug(userId).orElseThrow(() -> ApiError.unauthorized("Please log in again."));
    }

    public Profile require(UUID id) {
        return profiles.findById(id).orElseThrow(() -> ApiError.notFound("This account was not found."));
    }

    @Transactional(readOnly = true)
    public MeResponse me(UUID id) {
        Profile p = require(id);
        return new MeResponse(p.getId(), p.getEmail(), p.getFirstName(), p.getLastName(), roleSlugOf(id), p.getPhoneNumber(),
            p.getAge(), p.getGender(), p.getAddress(), p.getWeight(), p.getBloodPressure(), p.getPulse(),
            p.getProfilePicture(), p.isProfileSetupCompleted(), p.isVerified(), p.getSettings(), p.getChatPublicKey());
    }

    @Transactional
    public MeResponse update(UUID id, UpdateMeRequest request) {
        Profile p = require(id);
        if (request.firstName() != null) p.setFirstName(request.firstName().trim());
        if (request.lastName() != null) p.setLastName(request.lastName().trim());
        if (request.phoneNumber() != null) p.setPhoneNumber(request.phoneNumber().isBlank() ? null : request.phoneNumber().trim());
        if (request.age() != null) p.setAge(request.age());
        if (request.gender() != null) p.setGender(request.gender());
        if (request.address() != null) p.setAddress(request.address().trim());
        if (request.weight() != null) p.setWeight(request.weight());
        if (request.bloodPressure() != null) p.setBloodPressure(request.bloodPressure().trim());
        if (request.pulse() != null) p.setPulse(request.pulse());
        if (request.profilePicture() != null) p.setProfilePicture(request.profilePicture());
        if (request.profileSetupCompleted() != null) p.setProfileSetupCompleted(request.profileSetupCompleted());
        if (request.settings() != null) p.setSettings(request.settings());
        return me(id);
    }

    @Transactional
    public void setPushToken(UUID id, String token) {
        require(id).setPushToken(token == null || token.isBlank() ? null : token.trim());
    }

    @Transactional
    public void setChatPublicKey(UUID id, String key) {
        require(id).setChatPublicKey(key);
    }

    @Transactional
    public void heartbeat(UUID id) {
        profiles.touchLastSeen(id, Instant.now());
    }

    public PublicProfile publicProfile(UUID id) {
        Profile p = require(id);
        return new PublicProfile(p.getId(), p.getFirstName(), p.getLastName(), p.getProfilePicture(), roleSlugOf(id), p.isVerified());
    }

    public Map<UUID, PublicProfile> publicProfiles(Collection<UUID> ids) {
        List<Profile> found = profiles.findByIdIn(ids);
        return found.stream()
            .map(p -> new PublicProfile(p.getId(), p.getFirstName(), p.getLastName(), p.getProfilePicture(), roleSlugOf(p.getId()), p.isVerified()))
            .collect(Collectors.toMap(PublicProfile::id, Function.identity()));
    }

    public PresenceResponse presence(UUID id) {
        Instant seen = require(id).getLastSeenAt();
        return new PresenceResponse(seen != null && Duration.between(seen, Instant.now()).compareTo(ONLINE_WINDOW) < 0, seen);
    }
}
