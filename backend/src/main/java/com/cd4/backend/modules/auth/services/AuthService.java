package com.cd4.backend.modules.auth.services;

import com.cd4.backend.config.AppProperties;
import com.cd4.backend.constants.Roles;
import com.cd4.backend.modules.auth.dtos.AuthDtos.ChangePasswordRequest;
import com.cd4.backend.modules.auth.dtos.AuthDtos.LoginRequest;
import com.cd4.backend.modules.auth.dtos.AuthDtos.RegisterRequest;
import com.cd4.backend.modules.auth.dtos.AuthDtos.TokenResponse;
import com.cd4.backend.modules.auth.models.RefreshToken;
import com.cd4.backend.modules.auth.models.User;
import com.cd4.backend.modules.auth.repositories.RefreshTokenRepository;
import com.cd4.backend.modules.auth.repositories.UserRepository;
import com.cd4.backend.modules.doctors.models.Doctor;
import com.cd4.backend.modules.doctors.repositories.DoctorRepository;
import com.cd4.backend.modules.users.models.Profile;
import com.cd4.backend.modules.users.repositories.ProfileRepository;
import com.cd4.backend.modules.users.repositories.RoleRepository;
import com.cd4.backend.modules.users.services.UserService;
import com.cd4.backend.utils.ApiError;
import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AuthService {
    private static final String BAD_LOGIN = "Incorrect email or password.";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final UserRepository users;
    private final RefreshTokenRepository refreshTokens;
    private final ProfileRepository profiles;
    private final RoleRepository roles;
    private final DoctorRepository doctors;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final UserService userService;
    private final AppProperties properties;

    // Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
    private String dummyHash;

    @PostConstruct
    void prepareDummyHash() {
        dummyHash = passwordEncoder.encode(UUID.randomUUID().toString());
    }

    private static String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    @Transactional
    public TokenResponse register(RegisterRequest request) {
        String email = normalizeEmail(request.email());
        if (users.existsByEmail(email)) {
            throw ApiError.conflict("email_taken", "An account with this email already exists.");
        }
        String roleSlug = request.role() == null ? Roles.PATIENT : request.role();
        boolean isDoctor = Roles.DOCTOR.equals(roleSlug);
        if (isDoctor && (isBlank(request.registrationNumber()) || isBlank(request.specialization()) || isBlank(request.city()))) {
            throw ApiError.badRequest("doctor_details_required", "Doctors must give a registration number, specialization and city.");
        }
        if (isDoctor && doctors.existsByRegistrationNumber(request.registrationNumber().trim())) {
            throw ApiError.conflict("registration_taken", "This registration number is already in use.");
        }

        User user = new User();
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        users.saveAndFlush(user);

        Profile profile = new Profile();
        profile.setId(user.getId());
        profile.setEmail(email);
        profile.setFirstName(request.firstName().trim());
        profile.setLastName(request.lastName().trim());
        profile.setRoleId(roles.findBySlug(roleSlug).orElseThrow().getId());
        profiles.saveAndFlush(profile);

        if (isDoctor) {
            Doctor doctor = new Doctor();
            doctor.setId(user.getId());
            doctor.setRegistrationNumber(request.registrationNumber().trim());
            doctor.setSpecialization(request.specialization().trim());
            doctor.setCity(request.city().trim());
            doctor.setExperience(isBlank(request.experience()) ? "0 Years" : request.experience().trim());
            doctor.setFee(isBlank(request.fee()) ? "500" : request.fee().trim());
            // Not visible to patients until an admin has checked the registration.
            doctor.setVerified(false);
            doctors.save(doctor);
        }
        return issueTokens(user.getId(), roleSlug, UUID.randomUUID());
    }

    /** noRollbackFor: the failed attempt has to be saved even though the login is refused. */
    @Transactional(noRollbackFor = ApiError.class)
    public TokenResponse login(LoginRequest request) {
        User user = users.findByEmail(normalizeEmail(request.email())).orElse(null);
        if (user == null || user.getPasswordHash() == null) {
            passwordEncoder.matches(request.password(), dummyHash);
            throw ApiError.unauthorized(BAD_LOGIN);
        }
        Instant now = Instant.now();
        if (user.getDisabledAt() != null) {
            throw ApiError.forbidden("This account has been disabled.");
        }
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(now)) {
            throw ApiError.tooMany("Too many failed attempts. Please try again in a few minutes.");
        }
        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            int failures = user.getFailedLoginCount() + 1;
            if (failures >= properties.security().maxFailedLogins()) {
                user.setLockedUntil(now.plus(Duration.ofMinutes(properties.security().lockMinutes())));
                failures = 0;
            }
            user.setFailedLoginCount(failures);
            throw ApiError.unauthorized(BAD_LOGIN);
        }
        user.setFailedLoginCount(0);
        user.setLockedUntil(null);
        return issueTokens(user.getId(), userService.roleSlugOf(user.getId()), UUID.randomUUID());
    }

    /**
     * Each refresh token works once. Seeing a used one again means it was stolen or copied,
     * so the whole family is revoked and the person has to log in again.
     */
    @Transactional(noRollbackFor = ApiError.class)
    public TokenResponse refresh(String rawToken) {
        RefreshToken current = refreshTokens.findByTokenHash(hash(rawToken))
            .orElseThrow(() -> ApiError.unauthorized("Please log in again."));
        Instant now = Instant.now();
        if (current.getRevokedAt() != null) {
            refreshTokens.revokeFamily(current.getFamilyId(), now);
            throw ApiError.unauthorized("Please log in again.");
        }
        if (current.getExpiresAt().isBefore(now)) {
            throw ApiError.unauthorized("Please log in again.");
        }
        User user = users.findById(current.getUserId()).orElseThrow(() -> ApiError.unauthorized("Please log in again."));
        if (user.getDisabledAt() != null) {
            refreshTokens.revokeFamily(current.getFamilyId(), now);
            throw ApiError.forbidden("This account has been disabled.");
        }
        current.setRevokedAt(now);
        return issueTokens(user.getId(), userService.roleSlugOf(user.getId()), current.getFamilyId());
    }

    @Transactional
    public void logout(String rawToken) {
        refreshTokens.findByTokenHash(hash(rawToken)).ifPresent(token -> refreshTokens.revokeFamily(token.getFamilyId(), Instant.now()));
    }

    @Transactional
    public void changePassword(UUID userId, ChangePasswordRequest request) {
        User user = users.findById(userId).orElseThrow(() -> ApiError.unauthorized("Please log in again."));
        if (user.getPasswordHash() == null || !passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
            throw ApiError.badRequest("wrong_password", "Your current password is not correct.");
        }
        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        // Other devices must sign in again with the new password.
        refreshTokens.revokeAllForUser(userId, Instant.now());
    }

    /** Hospital and admin accounts never come from public sign-up. */
    @Transactional
    public UUID createStaffAccount(String rawEmail, String password, String firstName, String lastName, String roleSlug) {
        if (!Roles.HOSPITAL.equals(roleSlug) && !Roles.ADMIN.equals(roleSlug)) {
            throw ApiError.badRequest("bad_role", "This role cannot be created here.");
        }
        String email = normalizeEmail(rawEmail);
        if (users.existsByEmail(email)) {
            throw ApiError.conflict("email_taken", "An account with this email already exists.");
        }
        User user = new User();
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(password));
        users.saveAndFlush(user);
        Profile profile = new Profile();
        profile.setId(user.getId());
        profile.setEmail(email);
        profile.setFirstName(firstName.trim());
        profile.setLastName(lastName.trim());
        profile.setRoleId(roles.findBySlug(roleSlug).orElseThrow().getId());
        profiles.save(profile);
        return user.getId();
    }

    @Scheduled(cron = "0 15 3 * * *")
    @Transactional
    public void removeExpiredTokens() {
        refreshTokens.deleteExpired(Instant.now());
    }

    private TokenResponse issueTokens(UUID userId, String roleSlug, UUID familyId) {
        byte[] bytes = new byte[48];
        RANDOM.nextBytes(bytes);
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);

        RefreshToken token = new RefreshToken();
        token.setUserId(userId);
        token.setTokenHash(hash(raw));
        token.setFamilyId(familyId);
        token.setExpiresAt(Instant.now().plus(Duration.ofDays(properties.security().refreshTokenDays())));
        refreshTokens.save(token);

        return new TokenResponse(jwtService.createAccessToken(userId, roleSlug), raw, jwtService.accessTokenSeconds(), userService.me(userId));
    }

    private static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
