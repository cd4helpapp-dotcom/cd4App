package com.cd4.backend.modules.community.repositories;

import com.cd4.backend.modules.community.models.CommunityPost;
import com.cd4.backend.modules.community.models.CommunityPostComment;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public final class CommunityRepositories {
    private CommunityRepositories() {}

    public interface Posts extends JpaRepository<CommunityPost, UUID> {
        // Hides anyone blocked in either direction and anything containing the viewer's muted words.
        @Query(nativeQuery = true, value = """
            SELECT p.* FROM community_posts p
            WHERE p.status = 'published' AND p.deleted_at IS NULL
              AND (CAST(:category AS text) IS NULL OR p.category = CAST(:category AS text))
              AND (CAST(:authorId AS text) IS NULL OR p.author_id = CAST(CAST(:authorId AS text) AS uuid))
              AND (:followingOnly = false OR EXISTS (SELECT 1 FROM community_follows f WHERE f.follower_id = :viewerId AND f.following_id = p.author_id))
              AND NOT EXISTS (SELECT 1 FROM community_user_blocks b
                              WHERE (b.blocker_id = :viewerId AND b.blocked_user_id = p.author_id)
                                 OR (b.blocker_id = p.author_id AND b.blocked_user_id = :viewerId))
              AND NOT EXISTS (SELECT 1 FROM community_muted_keywords k
                              WHERE k.user_id = :viewerId AND position(k.keyword IN lower(p.body)) > 0)
            ORDER BY p.is_pinned DESC, p.created_at DESC
            """)
        List<CommunityPost> feed(UUID viewerId, String category, String authorId, boolean followingOnly, Pageable pageable);
    }

    public interface Comments extends JpaRepository<CommunityPostComment, UUID> {
        @Query("select c from CommunityPostComment c where c.postId = :postId and c.status = 'published' and c.deletedAt is null order by c.createdAt asc, c.id asc")
        List<CommunityPostComment> findVisible(UUID postId, Pageable pageable);
    }
}
