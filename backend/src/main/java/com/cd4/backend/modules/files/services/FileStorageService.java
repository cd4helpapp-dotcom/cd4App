package com.cd4.backend.modules.files.services;

import com.cd4.backend.config.AppProperties;
import com.cd4.backend.utils.ApiError;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/** Files on disk, behind one small class, so moving to object storage later only touches this file. */
@Service
@RequiredArgsConstructor
public class FileStorageService {
    public static final Set<String> IMAGES = Set.of("image/jpeg", "image/png", "image/webp");
    public static final Set<String> IMAGES_AND_PDF = Set.of("image/jpeg", "image/png", "image/webp", "application/pdf");

    private final AppProperties properties;

    public record Stored(String path, String mimeType, long sizeBytes, String originalName) {}

    /** The type comes from the file's own first bytes. The name and type the client sends can say anything. */
    public Stored store(MultipartFile file, String folder, Set<String> allowed) {
        if (file == null || file.isEmpty()) {
            throw ApiError.badRequest("empty_file", "Please choose a file.");
        }
        try {
            String mime = detectType(file);
            if (mime == null || !allowed.contains(mime)) {
                throw ApiError.badRequest("unsupported_file", "This file type is not supported.");
            }
            String relative = folder + "/" + UUID.randomUUID() + extensionFor(mime);
            Path target = resolve(relative);
            Files.createDirectories(target.getParent());
            try (InputStream in = file.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
            String name = file.getOriginalFilename() == null ? "file" : Path.of(file.getOriginalFilename().replace('\\', '/')).getFileName().toString();
            return new Stored(relative, mime, file.getSize(), name);
        } catch (IOException e) {
            throw new IllegalStateException("Could not save the file", e);
        }
    }

    public byte[] read(String relative) {
        try {
            return Files.readAllBytes(resolve(relative));
        } catch (IOException e) {
            throw ApiError.notFound("This file was not found.");
        }
    }

    public void delete(String relative) {
        try {
            Files.deleteIfExists(resolve(relative));
        } catch (IOException ignored) {
            // A leftover file is cleaned up with the folder when the account is deleted.
        }
    }

    public void deleteFolder(String relative) {
        Path folder = resolve(relative);
        if (!Files.exists(folder)) return;
        try (Stream<Path> walk = Files.walk(folder)) {
            walk.sorted(Comparator.reverseOrder()).forEach(path -> path.toFile().delete());
        } catch (IOException e) {
            throw new IllegalStateException("Could not delete the folder", e);
        }
    }

    // Refuses any path that would land outside the storage folder, such as one containing "../".
    private Path resolve(String relative) {
        Path base = Path.of(properties.storage().dir()).toAbsolutePath().normalize();
        Path target = base.resolve(relative).normalize();
        if (!target.startsWith(base) || target.equals(base)) {
            throw ApiError.badRequest("bad_path", "This file path is not allowed.");
        }
        return target;
    }

    private static String detectType(MultipartFile file) throws IOException {
        byte[] head = new byte[12];
        try (InputStream in = file.getInputStream()) {
            int read = in.readNBytes(head, 0, head.length);
            if (read < 4) return null;
        }
        if (head[0] == (byte) 0xFF && head[1] == (byte) 0xD8 && head[2] == (byte) 0xFF) return "image/jpeg";
        if (head[0] == (byte) 0x89 && head[1] == 'P' && head[2] == 'N' && head[3] == 'G') return "image/png";
        if (head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F' && new String(Arrays.copyOfRange(head, 8, 12)).equals("WEBP")) return "image/webp";
        if (head[0] == '%' && head[1] == 'P' && head[2] == 'D' && head[3] == 'F') return "application/pdf";
        return null;
    }

    private static String extensionFor(String mime) {
        return switch (mime) {
            case "image/jpeg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/webp" -> ".webp";
            default -> ".pdf";
        };
    }
}
