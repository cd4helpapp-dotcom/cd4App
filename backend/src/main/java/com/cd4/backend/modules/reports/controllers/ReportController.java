package com.cd4.backend.modules.reports.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.reports.dtos.ReportDtos.AskRequest;
import com.cd4.backend.modules.reports.dtos.ReportDtos.ChatMessageResponse;
import com.cd4.backend.modules.reports.dtos.ReportDtos.ReportResponse;
import com.cd4.backend.modules.reports.services.ReportService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/reports")
@RequiredArgsConstructor
public class ReportController {
    private final ReportService reportService;

    @PostMapping
    ApiResponse<ReportResponse> upload(@AuthenticationPrincipal CurrentUser user, @RequestParam("file") MultipartFile file) {
        return ApiResponse.ok(reportService.upload(user.id(), file));
    }

    @GetMapping
    ApiResponse<List<ReportResponse>> list(@AuthenticationPrincipal CurrentUser user, @RequestParam(defaultValue = "0") int page) {
        return ApiResponse.ok(reportService.list(user.id(), page));
    }

    @GetMapping("/{id}")
    ApiResponse<ReportResponse> get(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        return ApiResponse.ok(reportService.get(user.id(), id));
    }

    @GetMapping("/{id}/file")
    ResponseEntity<byte[]> file(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        String path = reportService.fileName(user.id(), id);
        MediaType type = path.endsWith(".pdf") ? MediaType.APPLICATION_PDF : path.endsWith(".png") ? MediaType.IMAGE_PNG
            : path.endsWith(".webp") ? MediaType.parseMediaType("image/webp") : MediaType.IMAGE_JPEG;
        return ResponseEntity.ok().contentType(type)
            .header("X-Content-Type-Options", "nosniff")
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .body(reportService.file(user.id(), id));
    }

    @PostMapping("/{id}/retry")
    ApiResponse<ReportResponse> retry(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        return ApiResponse.ok(reportService.retry(user.id(), id));
    }

    @DeleteMapping("/{id}")
    ApiResponse<Void> delete(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        reportService.delete(user.id(), id);
        return ApiResponse.ok(null);
    }

    @GetMapping("/{id}/messages")
    ApiResponse<List<ChatMessageResponse>> messages(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        return ApiResponse.ok(reportService.messages(user.id(), id));
    }

    @PostMapping("/{id}/messages")
    ApiResponse<ChatMessageResponse> ask(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id, @Valid @RequestBody AskRequest request) {
        return ApiResponse.ok(reportService.ask(user.id(), id, request.question()));
    }
}
