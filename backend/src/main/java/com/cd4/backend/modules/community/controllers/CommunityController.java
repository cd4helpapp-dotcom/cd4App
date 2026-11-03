package com.cd4.backend.modules.community.controllers;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.community.dtos.CommunityDtos.CommentResponse;
import com.cd4.backend.modules.community.dtos.CommunityDtos.CreateCommentRequest;
import com.cd4.backend.modules.community.dtos.CommunityDtos.CreatePostRequest;
import com.cd4.backend.modules.community.dtos.CommunityDtos.MuteRequest;
import com.cd4.backend.modules.community.dtos.CommunityDtos.PostResponse;
import com.cd4.backend.modules.community.dtos.CommunityDtos.ProfileResponse;
import com.cd4.backend.modules.community.dtos.CommunityDtos.ReportPostRequest;
import com.cd4.backend.modules.community.services.CommunityService;
import com.cd4.backend.utils.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/community")
@RequiredArgsConstructor
public class CommunityController {
    private final CommunityService community;

    @GetMapping("/posts")
    ApiResponse<List<PostResponse>> feed(
        @AuthenticationPrincipal CurrentUser user,
        @RequestParam(required = false) String category,
        @RequestParam(required = false) UUID authorId,
        @RequestParam(defaultValue = "false") boolean following,
        @RequestParam(defaultValue = "0") int page
    ) {
        return ApiResponse.ok(community.feed(user.id(), category, authorId, following, page));
    }

    @PostMapping("/posts")
    ApiResponse<PostResponse> create(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody CreatePostRequest request) {
        return ApiResponse.ok(community.create(user.id(), request));
    }

    @DeleteMapping("/posts/{id}")
    ApiResponse<Void> delete(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        community.delete(user, id);
        return ApiResponse.ok(null);
    }

    @PutMapping("/posts/{id}/like")
    ApiResponse<Void> like(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        community.like(user.id(), id);
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/posts/{id}/like")
    ApiResponse<Void> unlike(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        community.unlike(user.id(), id);
        return ApiResponse.ok(null);
    }

    @GetMapping("/posts/{id}/comments")
    ApiResponse<List<CommentResponse>> comments(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id, @RequestParam(defaultValue = "0") int page) {
        return ApiResponse.ok(community.comments(user.id(), id, page));
    }

    @PostMapping("/posts/{id}/comments")
    ApiResponse<CommentResponse> comment(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id, @Valid @RequestBody CreateCommentRequest request) {
        return ApiResponse.ok(community.comment(user.id(), id, request));
    }

    @DeleteMapping("/comments/{id}")
    ApiResponse<Void> deleteComment(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        community.deleteComment(user, id);
        return ApiResponse.ok(null);
    }

    @PostMapping("/posts/{id}/report")
    ApiResponse<Void> report(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id, @Valid @RequestBody ReportPostRequest request) {
        community.report(user.id(), id, request.reason(), request.details());
        return ApiResponse.ok(null);
    }

    @GetMapping("/users/{id}")
    ApiResponse<ProfileResponse> profile(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        return ApiResponse.ok(community.profile(user.id(), id));
    }

    @PutMapping("/users/{id}/follow")
    ApiResponse<Void> follow(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        community.follow(user.id(), id);
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/users/{id}/follow")
    ApiResponse<Void> unfollow(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        community.unfollow(user.id(), id);
        return ApiResponse.ok(null);
    }

    @PutMapping("/users/{id}/block")
    ApiResponse<Void> block(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        community.block(user.id(), id);
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/users/{id}/block")
    ApiResponse<Void> unblock(@AuthenticationPrincipal CurrentUser user, @PathVariable UUID id) {
        community.unblock(user.id(), id);
        return ApiResponse.ok(null);
    }

    @GetMapping("/muted-keywords")
    ApiResponse<List<String>> muted(@AuthenticationPrincipal CurrentUser user) {
        return ApiResponse.ok(community.mutedKeywords(user.id()));
    }

    @PostMapping("/muted-keywords")
    ApiResponse<Void> mute(@AuthenticationPrincipal CurrentUser user, @Valid @RequestBody MuteRequest request) {
        community.mute(user.id(), request.keyword());
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/muted-keywords/{keyword}")
    ApiResponse<Void> unmute(@AuthenticationPrincipal CurrentUser user, @PathVariable String keyword) {
        community.unmute(user.id(), keyword);
        return ApiResponse.ok(null);
    }
}
