-- Notify post authors of new likes
CREATE OR REPLACE FUNCTION public.community_notify_like()
RETURNS TRIGGER AS $$
DECLARE
    v_post_author UUID;
    v_liker_name TEXT;
BEGIN
    SELECT author_id INTO v_post_author FROM public.community_posts WHERE id = NEW.post_id;
    
    IF v_post_author = NEW.user_id THEN
        RETURN NEW;
    END IF;

    SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_liker_name 
    FROM public.profiles WHERE id = NEW.user_id;

    INSERT INTO public.in_app_notifications (
        user_id,
        type,
        title,
        body,
        data
    ) VALUES (
        v_post_author,
        'community_like',
        'New Like',
        trim(v_liker_name) || ' liked your post.',
        jsonb_build_object('postId', NEW.post_id, 'likerId', NEW.user_id)
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_community_notify_like ON public.community_post_likes;
CREATE TRIGGER trg_community_notify_like
AFTER INSERT ON public.community_post_likes
FOR EACH ROW
EXECUTE FUNCTION public.community_notify_like();


-- Notify post authors of new comments
CREATE OR REPLACE FUNCTION public.community_notify_comment()
RETURNS TRIGGER AS $$
DECLARE
    v_post_author UUID;
    v_commenter_name TEXT;
BEGIN
    SELECT author_id INTO v_post_author FROM public.community_posts WHERE id = NEW.post_id;
    
    IF v_post_author = NEW.author_id THEN
        RETURN NEW;
    END IF;

    SELECT first_name || ' ' || COALESCE(last_name, '') INTO v_commenter_name 
    FROM public.profiles WHERE id = NEW.author_id;

    INSERT INTO public.in_app_notifications (
        user_id,
        type,
        title,
        body,
        data
    ) VALUES (
        v_post_author,
        'community_comment',
        'New Comment',
        trim(v_commenter_name) || ' commented on your post.',
        jsonb_build_object('postId', NEW.post_id, 'commentId', NEW.id, 'commenterId', NEW.author_id)
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_community_notify_comment ON public.community_post_comments;
CREATE TRIGGER trg_community_notify_comment
AFTER INSERT ON public.community_post_comments
FOR EACH ROW
WHEN (NEW.status = 'published')
EXECUTE FUNCTION public.community_notify_comment();

DROP TRIGGER IF EXISTS trg_community_notify_comment_update ON public.community_post_comments;
CREATE TRIGGER trg_community_notify_comment_update
AFTER UPDATE OF status ON public.community_post_comments
FOR EACH ROW
WHEN (OLD.status != 'published' AND NEW.status = 'published')
EXECUTE FUNCTION public.community_notify_comment();
