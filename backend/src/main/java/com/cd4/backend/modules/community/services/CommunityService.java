package com.cd4.backend.modules.community.services;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.community.dtos.CommunityDtos.Author;
import com.cd4.backend.modules.community.dtos.CommunityDtos.CommentResponse;
import com.cd4.backend.modules.community.dtos.CommunityDtos.CreateCommentRequest;
import com.cd4.backend.modules.community.dtos.CommunityDtos.CreatePostRequest;
import com.cd4.backend.modules.community.dtos.CommunityDtos.PostResponse;
import com.cd4.backend.modules.community.dtos.CommunityDtos.ProfileResponse;
import com.cd4.backend.modules.community.models.CommunityPost;
import com.cd4.backend.modules.community.models.CommunityPostComment;
import com.cd4.backend.modules.community.repositories.CommunityRepositories;
import com.cd4.backend.modules.doctors.models.Doctor;
import com.cd4.backend.modules.doctors.repositories.DoctorRepository;
import com.cd4.backend.modules.notifications.services.NotificationService;
import com.cd4.backend.modules.users.models.Profile;
import com.cd4.backend.modules.users.repositories.ProfileRepository;
import com.cd4.backend.utils.ApiError;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Likes, follows and blocks are plain SQL: a repeated tap does nothing, and a counter only moves when a row really changed.
 */
@Service
@RequiredArgsConstructor
public class CommunityService {
    private static final int PAGE_SIZE = 20;

    private final CommunityRepositories.Posts posts;
    private final CommunityRepositories.Comments comments;
    private final ProfileRepository profiles;
    private final DoctorRepository doctors;
    private final NotificationService notifications;
    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate named;

    @Transactional(readOnly = true)
    public List<PostResponse> feed(UUID viewerId, String category, UUID authorId, boolean followingOnly, int page) {
        List<CommunityPost> rows = posts.feed(viewerId, blankToNull(category), authorId == null ? null : authorId.toString(), followingOnly, PageRequest.of(Math.max(page, 0), PAGE_SIZE));
        return toResponses(rows, viewerId);
    }

    @Transactional
    public PostResponse create(UUID authorId, CreatePostRequest request) {
        String body = request.body().trim();
        if (body.length() < 8) {
            throw ApiError.badRequest("post_too_short", "Please write a little more.");
        }
        CommunityPost post = new CommunityPost();
        post.setAuthorId(authorId);
        post.setBody(body);
        post.setImageUrl(requireOwnMedia(authorId, request.imageUrl()));
        if (request.media() != null) {
            post.setMedia(new ArrayList<>(request.media().stream().map(url -> requireOwnMedia(authorId, url)).toList()));
        }
        if (request.category() != null) post.setCategory(request.category());
        posts.saveAndFlush(post);
        return toResponses(List.of(post), authorId).get(0);
    }

    @Transactional
    public void delete(CurrentUser user, UUID postId) {
        CommunityPost post = requireVisible(postId);
        if (!post.getAuthorId().equals(user.id()) && !user.isAdmin()) {
            throw ApiError.forbidden("This post is not yours.");
        }
        post.setDeletedAt(Instant.now());
    }

    @Transactional
    public void like(UUID userId, UUID postId) {
        CommunityPost post = requireVisible(postId);
        requireNotBlocked(userId, post.getAuthorId());
        int added = jdbc.update("INSERT INTO community_post_likes (post_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING", postId, userId);
        if (added > 0) {
            jdbc.update("UPDATE community_posts SET like_count = like_count + 1 WHERE id = ?", postId);
            if (!post.getAuthorId().equals(userId)) {
                notifications.notify(post.getAuthorId(), "community_like", "New like", nameOf(userId) + " liked your post.", Map.of("postId", postId.toString()));
            }
        }
    }

    @Transactional
    public void unlike(UUID userId, UUID postId) {
        int removed = jdbc.update("DELETE FROM community_post_likes WHERE post_id = ? AND user_id = ?", postId, userId);
        if (removed > 0) {
            jdbc.update("UPDATE community_posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?", postId);
        }
    }

    @Transactional(readOnly = true)
    public List<CommentResponse> comments(UUID viewerId, UUID postId, int page) {
        requireVisible(postId);
        List<CommunityPostComment> rows = comments.findVisible(postId, PageRequest.of(Math.max(page, 0), 50));
        Map<UUID, Author> authors = authors(rows.stream().map(CommunityPostComment::getAuthorId).collect(Collectors.toSet()));
        return rows.stream().map(c -> toResponse(c, authors.get(c.getAuthorId()), viewerId)).toList();
    }

    @Transactional
    public CommentResponse comment(UUID userId, UUID postId, CreateCommentRequest request) {
        CommunityPost post = requireVisible(postId);
        requireNotBlocked(userId, post.getAuthorId());
        String content = request.content().trim();
        if (content.length() < 2) {
            throw ApiError.badRequest("comment_too_short", "Please write a little more.");
        }
        if (request.parentId() != null) {
            comments.findById(request.parentId()).filter(parent -> parent.getPostId().equals(postId))
                .orElseThrow(() -> ApiError.badRequest("bad_parent", "The comment you replied to was not found."));
        }
        CommunityPostComment comment = new CommunityPostComment();
        comment.setPostId(postId);
        comment.setAuthorId(userId);
        comment.setParentId(request.parentId());
        comment.setContent(content);
        comments.saveAndFlush(comment);
        jdbc.update("UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = ?", postId);
        if (!post.getAuthorId().equals(userId)) {
            notifications.notify(post.getAuthorId(), "community_comment", "New comment", nameOf(userId) + " commented on your post.", Map.of("postId", postId.toString()));
        }
        return toResponse(comment, authors(List.of(userId)).get(userId), userId);
    }

    @Transactional
    public void deleteComment(CurrentUser user, UUID commentId) {
        CommunityPostComment comment = comments.findById(commentId).filter(c -> c.getDeletedAt() == null)
            .orElseThrow(() -> ApiError.notFound("This comment was not found."));
        boolean ownsPost = posts.findById(comment.getPostId()).map(p -> p.getAuthorId().equals(user.id())).orElse(false);
        if (!comment.getAuthorId().equals(user.id()) && !ownsPost && !user.isAdmin()) {
            throw ApiError.forbidden("This comment is not yours.");
        }
        comment.setDeletedAt(Instant.now());
        jdbc.update("UPDATE community_posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = ?", comment.getPostId());
    }

    @Transactional
    public void report(UUID userId, UUID postId, String reason, String details) {
        requireVisible(postId);
        jdbc.update("INSERT INTO community_post_reports (post_id, reporter_id, reason, details) VALUES (?, ?, ?, ?) ON CONFLICT (post_id, reporter_id) DO NOTHING",
            postId, userId, reason == null || reason.isBlank() ? "other" : reason.trim(), details);
    }

    @Transactional
    public void follow(UUID userId, UUID targetId) {
        if (userId.equals(targetId)) {
            throw ApiError.badRequest("self_follow", "You cannot follow yourself.");
        }
        profiles.findById(targetId).orElseThrow(() -> ApiError.notFound("This account was not found."));
        requireNotBlocked(userId, targetId);
        int added = jdbc.update("INSERT INTO community_follows (follower_id, following_id) VALUES (?, ?) ON CONFLICT DO NOTHING", userId, targetId);
        if (added > 0) {
            notifications.notify(targetId, "community_follow", "New follower", nameOf(userId) + " started following you.", Map.of("userId", userId.toString()));
        }
    }

    @Transactional
    public void unfollow(UUID userId, UUID targetId) {
        jdbc.update("DELETE FROM community_follows WHERE follower_id = ? AND following_id = ?", userId, targetId);
    }

    /** Blocking ends follows in both directions. */
    @Transactional
    public void block(UUID userId, UUID targetId) {
        if (userId.equals(targetId)) {
            throw ApiError.badRequest("self_block", "You cannot block yourself.");
        }
        jdbc.update("INSERT INTO community_user_blocks (blocker_id, blocked_user_id) VALUES (?, ?) ON CONFLICT DO NOTHING", userId, targetId);
        jdbc.update("DELETE FROM community_follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)", userId, targetId, targetId, userId);
    }

    @Transactional
    public void unblock(UUID userId, UUID targetId) {
        jdbc.update("DELETE FROM community_user_blocks WHERE blocker_id = ? AND blocked_user_id = ?", userId, targetId);
    }

    public List<String> mutedKeywords(UUID userId) {
        return jdbc.queryForList("SELECT keyword FROM community_muted_keywords WHERE user_id = ? ORDER BY keyword", String.class, userId);
    }

    public void mute(UUID userId, String keyword) {
        jdbc.update("INSERT INTO community_muted_keywords (user_id, keyword) VALUES (?, ?) ON CONFLICT DO NOTHING", userId, keyword.trim().toLowerCase(Locale.ROOT));
    }

    public void unmute(UUID userId, String keyword) {
        jdbc.update("DELETE FROM community_muted_keywords WHERE user_id = ? AND keyword = ?", userId, keyword.trim().toLowerCase(Locale.ROOT));
    }

    @Transactional(readOnly = true)
    public ProfileResponse profile(UUID viewerId, UUID targetId) {
        profiles.findById(targetId).orElseThrow(() -> ApiError.notFound("This account was not found."));
        if (blockedBy(targetId, viewerId)) {
            throw ApiError.notFound("This account was not found.");
        }
        long followers = count("SELECT count(*) FROM community_follows WHERE following_id = ?", targetId);
        long following = count("SELECT count(*) FROM community_follows WHERE follower_id = ?", targetId);
        long postCount = count("SELECT count(*) FROM community_posts WHERE author_id = ? AND status = 'published' AND deleted_at IS NULL", targetId);
        boolean followed = Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM community_follows WHERE follower_id = ? AND following_id = ?)", Boolean.class, viewerId, targetId));
        return new ProfileResponse(authors(List.of(targetId)).get(targetId), followers, following, postCount, followed, blockedBy(viewerId, targetId));
    }

    private long count(String sql, UUID id) {
        Long value = jdbc.queryForObject(sql, Long.class, id);
        return value == null ? 0 : value;
    }

    private boolean blockedBy(UUID blocker, UUID blocked) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM community_user_blocks WHERE blocker_id = ? AND blocked_user_id = ?)", Boolean.class, blocker, blocked));
    }

    private void requireNotBlocked(UUID a, UUID b) {
        if (blockedBy(a, b) || blockedBy(b, a)) {
            throw ApiError.forbidden("You cannot interact with this account.");
        }
    }

    // Only a file this person uploaded can go on their post.
    private static String requireOwnMedia(UUID authorId, String url) {
        if (url == null || url.isBlank()) return null;
        if (!url.startsWith("/api/v1/community/media/" + authorId + "/")) {
            throw ApiError.badRequest("bad_media", "This image cannot be used.");
        }
        return url;
    }

    private CommunityPost requireVisible(UUID postId) {
        return posts.findById(postId).filter(p -> p.getDeletedAt() == null && "published".equals(p.getStatus()))
            .orElseThrow(() -> ApiError.notFound("This post was not found."));
    }

    private String nameOf(UUID userId) {
        return profiles.findById(userId).map(Profile::fullName).orElse("Someone");
    }

    private List<PostResponse> toResponses(List<CommunityPost> rows, UUID viewerId) {
        if (rows.isEmpty()) return List.of();
        Map<UUID, Author> authors = authors(rows.stream().map(CommunityPost::getAuthorId).collect(Collectors.toSet()));
        Set<UUID> liked = new HashSet<>(named.queryForList(
            "SELECT post_id FROM community_post_likes WHERE user_id = :userId AND post_id IN (:ids)",
            new MapSqlParameterSource().addValue("userId", viewerId).addValue("ids", rows.stream().map(CommunityPost::getId).toList()),
            UUID.class));
        return rows.stream().map(p -> new PostResponse(p.getId(), authors.get(p.getAuthorId()), p.getBody(), p.getImageUrl(), p.getMedia(), p.getCategory(), p.isPinned(),
            p.getLikeCount(), p.getCommentCount(), liked.contains(p.getId()), p.getAuthorId().equals(viewerId), p.getCreatedAt())).toList();
    }

    private static CommentResponse toResponse(CommunityPostComment c, Author author, UUID viewerId) {
        return new CommentResponse(c.getId(), c.getPostId(), c.getParentId(), author, c.getContent(), c.getAuthorId().equals(viewerId), c.getCreatedAt());
    }

    private Map<UUID, Author> authors(Collection<UUID> ids) {
        Set<UUID> doctorIds = doctors.findByIdIn(ids).stream().map(Doctor::getId).collect(Collectors.toSet());
        return profiles.findByIdIn(ids).stream()
            .map(p -> new Author(p.getId(), p.fullName(), p.getProfilePicture(), doctorIds.contains(p.getId())))
            .collect(Collectors.toMap(Author::id, Function.identity()));
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
