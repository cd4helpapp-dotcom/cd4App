package com.cd4.backend.utils;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/** An error whose message is written for the person using the app. */
@Getter
public class ApiError extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ApiError(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public static ApiError badRequest(String code, String message) {
        return new ApiError(HttpStatus.BAD_REQUEST, code, message);
    }

    public static ApiError notFound(String message) {
        return new ApiError(HttpStatus.NOT_FOUND, "not_found", message);
    }

    public static ApiError forbidden(String message) {
        return new ApiError(HttpStatus.FORBIDDEN, "forbidden", message);
    }

    public static ApiError unauthorized(String message) {
        return new ApiError(HttpStatus.UNAUTHORIZED, "unauthorized", message);
    }

    public static ApiError conflict(String code, String message) {
        return new ApiError(HttpStatus.CONFLICT, code, message);
    }

    public static ApiError tooMany(String message) {
        return new ApiError(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", message);
    }
}
