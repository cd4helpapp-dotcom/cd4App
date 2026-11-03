package com.cd4.backend.middlewares;

import com.cd4.backend.utils.ApiError;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.ConstraintViolationException;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiError.class)
    ResponseEntity<ApiResponse<Void>> handleApiError(ApiError error) {
        return ResponseEntity.status(error.getStatus()).body(ApiResponse.error(error.getCode(), error.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException error) {
        String message = error.getBindingResult().getFieldErrors().stream()
            .map(field -> field.getField() + ": " + field.getDefaultMessage())
            .collect(Collectors.joining(", "));
        return ResponseEntity.badRequest().body(ApiResponse.error("validation_failed", message));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ApiResponse<Void>> handleConstraint(ConstraintViolationException error) {
        return ResponseEntity.badRequest().body(ApiResponse.error("validation_failed", error.getMessage()));
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<ApiResponse<Void>> handleBadInput(Exception error) {
        return ResponseEntity.badRequest().body(ApiResponse.error("bad_request", "The request is not valid."));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ApiResponse<Void>> handleTooLarge(MaxUploadSizeExceededException error) {
        return ResponseEntity.status(413).body(ApiResponse.error("file_too_large", "This file is too large."));
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiResponse<Void>> handleDenied(AccessDeniedException error) {
        return ResponseEntity.status(403).body(ApiResponse.error("forbidden", "You do not have access to this."));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiResponse<Void>> handleConflict(DataIntegrityViolationException error) {
        log.warn("Data conflict: {}", error.getMostSpecificCause().getMessage());
        return ResponseEntity.status(409).body(ApiResponse.error("conflict", "This conflicts with existing data."));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiResponse<Void>> handleNotFound(NoResourceFoundException error) {
        return ResponseEntity.status(404).body(ApiResponse.error("not_found", "Not found."));
    }

    // Details stay in the log. A patient should never see a stack trace or a database message.
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception error) {
        log.error("Unhandled error", error);
        return ResponseEntity.status(500).body(ApiResponse.error("server_error", "Something went wrong. Please try again."));
    }
}
