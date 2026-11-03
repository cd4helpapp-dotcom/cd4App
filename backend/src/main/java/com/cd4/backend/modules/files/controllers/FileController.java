package com.cd4.backend.modules.files.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.chat.services.ChatService;
import com.cd4.backend.modules.files.services.FileStorageService;
import com.cd4.backend.modules.files.services.FileStorageService.Stored;
import com.cd4.backend.utils.ApiResponse;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Every download goes through an access check. No file has a public link. */
@RestController
@RequiredArgsConstructor
public class FileController {
    private static final String NAME = "{name:[0-9a-fA-F-]{36}\\.(?:jpg|png|webp|pdf)}";

    private final FileStorageService storage;
    private final ChatService chatService;

    /** A person's own files: profile picture and, for doctors, their signature. */
    @PostMapping("/api/v1/files/own")
    ApiResponse<Stored> uploadOwn(@AuthenticationPrincipal CurrentUser user, @RequestParam("file") MultipartFile file) {
        return ApiResponse.ok(storage.store(file, user.id().toString(), FileStorageService.IMAGES));
    }

    @GetMapping("/api/v1/files/own/" + NAME)
    ResponseEntity<byte[]> downloadOwn(@AuthenticationPrincipal CurrentUser user, @PathVariable String name) {
        return send(storage.read(user.id() + "/" + name), name);
    }

    @PostMapping("/api/v1/chat/rooms/{roomId}/attachments")
    ApiResponse<Stored> uploadChat(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID roomId, @RequestParam("file") MultipartFile file) {
        chatService.requireRoom(roomId, user.id());
        return ApiResponse.ok(storage.store(file, "chat/" + roomId, FileStorageService.IMAGES_AND_PDF));
    }

    @GetMapping("/api/v1/chat/rooms/{roomId}/attachments/" + NAME)
    ResponseEntity<byte[]> downloadChat(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID roomId, @PathVariable String name) {
        chatService.requireRoom(roomId, user.id());
        return send(storage.read("chat/" + roomId + "/" + name), name);
    }

    @PostMapping("/api/v1/community/media")
    ApiResponse<Stored> uploadCommunity(@AuthenticationPrincipal CurrentUser user, @RequestParam("file") MultipartFile file) {
        return ApiResponse.ok(storage.store(file, "community/" + user.id(), FileStorageService.IMAGES));
    }

    @GetMapping("/api/v1/community/media/{userId}/" + NAME)
    ResponseEntity<byte[]> downloadCommunity(@PathVariable UUID userId, @PathVariable String name) {
        return send(storage.read("community/" + userId + "/" + name), name);
    }

    static ResponseEntity<byte[]> send(byte[] body, String name) {
        MediaType type = name.endsWith(".pdf") ? MediaType.APPLICATION_PDF : name.endsWith(".png") ? MediaType.IMAGE_PNG
            : name.endsWith(".webp") ? MediaType.parseMediaType("image/webp") : MediaType.IMAGE_JPEG;
        return ResponseEntity.ok()
            .contentType(type)
            .header("X-Content-Type-Options", "nosniff")
            .header(HttpHeaders.CACHE_CONTROL, "private, max-age=300")
            .body(body);
    }
}
