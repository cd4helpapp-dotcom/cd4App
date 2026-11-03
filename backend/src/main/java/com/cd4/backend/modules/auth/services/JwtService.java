package com.cd4.backend.modules.auth.services;

import com.cd4.backend.config.AppProperties;
import com.cd4.backend.middlewares.CurrentUser;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
    private static final String ISSUER = "cd4-backend";

    private final SecretKey key;
    private final Duration accessTokenLife;

    public JwtService(AppProperties properties) {
        byte[] secret = properties.security().jwtSecret().getBytes(StandardCharsets.UTF_8);
        // Refuse to start with a weak secret rather than run with tokens anyone could forge.
        if (secret.length < 32) {
            throw new IllegalStateException("JWT_SECRET must be at least 32 bytes.");
        }
        this.key = Keys.hmacShaKeyFor(secret);
        this.accessTokenLife = Duration.ofMinutes(properties.security().accessTokenMinutes());
    }

    public String createAccessToken(UUID userId, String role) {
        Instant now = Instant.now();
        return Jwts.builder()
            .issuer(ISSUER)
            .subject(userId.toString())
            .claim("role", role)
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plus(accessTokenLife)))
            .signWith(key, Jwts.SIG.HS256)
            .compact();
    }

    public Optional<CurrentUser> parse(String token) {
        try {
            var claims = Jwts.parser().verifyWith(key).requireIssuer(ISSUER).build().parseSignedClaims(token).getPayload();
            return Optional.of(new CurrentUser(UUID.fromString(claims.getSubject()), claims.get("role", String.class)));
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    public long accessTokenSeconds() {
        return accessTokenLife.toSeconds();
    }
}
