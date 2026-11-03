package com.cd4.backend.modules.community.dtos;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class CommunityDtos {
    private CommunityDtos() {}

    public record Author(UUID id, String name, String picture, boolean isDoctor) {}

    public record PostResponse(
        UUID id, Author author, String body, String imageUrl, List<Object> media, String category, boolean isPinned,
        int likeCount, int commentCount, boolean likedByMe, boolean isMine, Instant createdAt
    ) {}

    public record CommentResponse(UUID id, UUID postId, UUID parentId, Author author, String content, boolean isMine, Instant createdAt) {}

    public record ProfileResponse(Author author, long followers, long following, long posts, boolean followedByMe, boolean blockedByMe) {}

    public record CreatePostRequest(
        @NotNull @Size(min = 8, max = 1800) String body,
        @Size(max = 300) String imageUrl,
        @Size(max = 6) List<@Size(max = 300) String> media,
        @Pattern(regexp = "general|success_stories|challenges|mentor_tips") String category
    ) {}

    public record CreateCommentRequest(@NotNull @Size(min = 2, max = 500) String content, UUID parentId) {}

    public record ReportPostRequest(@Size(max = 40) String reason, @Size(max = 500) String details) {}

    public record MuteRequest(@NotBlank @Size(max = 60) String keyword) {}
}
