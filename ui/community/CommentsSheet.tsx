import React from 'react';
import { ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { MessageCircle, Send, ShieldCheck, X } from 'lucide-react-native';
import { Radius, Spacing, Typography } from '../../constants/Design';
import { useAppLanguage } from '../../context/AppLanguageContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import {
  useAddCommunityComment,
  useCommunityComments,
  useDeleteCommunityComment,
  type CommunityComment,
} from '../../hooks/useCommunity';
import { confirmAction } from '../../src/utils/confirm';
import CommunityAvatar from './CommunityAvatar';
import { formatCommunityTime } from './communityFormat';

type Props = {
  postId: string | null;
  visible: boolean;
  viewerId: string | null;
  viewerName: string;
  viewerAvatar?: string | null;
  onClose: () => void;
  onOpenAuthor: (authorId: string) => void;
};

type RowProps = {
  item: CommunityComment;
  parentName?: string;
  isOwn: boolean;
  onReply: (item: CommunityComment) => void;
  onDelete: (item: CommunityComment) => void;
  onOpenAuthor: (authorId: string) => void;
};

const CommentRow = React.memo(function CommentRow({ item, parentName, isOwn, onReply, onDelete, onOpenAuthor }: RowProps) {
  const { theme } = useAppTheme();
  const { t } = useAppLanguage();
  const isReply = Boolean(parentName);
  const isDoctor = item.author.role === 'doctor';

  return (
    <View style={[styles.row, isReply && styles.replyRow, item.isPending && styles.pending]}>
      <TouchableOpacity onPress={() => onOpenAuthor(item.authorId)} accessibilityRole="button" accessibilityLabel={item.author.fullName}>
        <CommunityAvatar name={item.author.fullName} uri={item.author.profilePicture} size={isReply ? 28 : 34} />
      </TouchableOpacity>
      <View style={styles.flex}>
        <View style={[styles.bubble, { backgroundColor: theme.surfaceMuted }]}>
          <View style={styles.nameRow}>
            <Text style={[Typography.label, styles.name, { color: theme.text }]} numberOfLines={1} onPress={() => onOpenAuthor(item.authorId)}>
              {item.author.fullName}
            </Text>
            {isDoctor ? <ShieldCheck size={13} color={theme.primary} /> : null}
          </View>
          {parentName ? (
            <Text style={[Typography.caption, { color: theme.primary }]} numberOfLines={1}>
              {t('community.replyingTo', { name: parentName })}
            </Text>
          ) : null}
          <Text style={[styles.body, { color: theme.text }]}>{item.content}</Text>
        </View>
        <View style={styles.meta}>
          <Text style={[Typography.caption, { color: theme.textTertiary }]}>{formatCommunityTime(item.createdAt, t)}</Text>
          {!item.isPending ? (
            <TouchableOpacity onPress={() => onReply(item)} hitSlop={10} accessibilityRole="button">
              <Text style={[styles.metaAction, { color: theme.textSecondary }]}>{t('community.reply')}</Text>
            </TouchableOpacity>
          ) : null}
          {isOwn && !item.isPending ? (
            <TouchableOpacity onPress={() => onDelete(item)} hitSlop={10} accessibilityRole="button">
              <Text style={[styles.metaAction, { color: theme.danger }]}>{t('community.delete')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
});

// Keeps its own typing state, so writing a comment does not re-render the feed behind it.
export default function CommentsSheet({ postId, visible, viewerId, viewerName, viewerAvatar, onClose, onOpenAuthor }: Props) {
  const { theme } = useAppTheme();
  const { t } = useAppLanguage();
  const insets = useSafeAreaInsets();
  const [text, setText] = React.useState('');
  const [replyTo, setReplyTo] = React.useState<CommunityComment | null>(null);
  const inputRef = React.useRef<TextInputInstance | null>(null);

  const commentsQuery = useCommunityComments(postId, visible, viewerId);
  const addComment = useAddCommunityComment(viewerId);
  const deleteComment = useDeleteCommunityComment(viewerId);
  const comments = commentsQuery.data || [];

  const namesById = React.useMemo(() => new Map(comments.map((item) => [item.id, item.author.fullName])), [comments]);

  React.useEffect(() => {
    if (!visible) return;
    setText('');
    setReplyTo(null);
  }, [postId, visible]);

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  const submit = () => {
    const content = text.trim();
    if (!postId || !content) return;
    const parentId = replyTo?.id;
    const previousReply = replyTo;
    setText('');
    setReplyTo(null);
    addComment.mutate(
      { postId, content, parentId, author: { id: viewerId || '', fullName: viewerName, profilePicture: viewerAvatar || null, role: 'unknown', isVerified: false } },
      {
        onError: (error: any) => {
          // Nothing the person typed is lost.
          setText((current) => current || content);
          setReplyTo(previousReply);
          Toast.show({ type: 'error', text1: t('community.commentFailed'), text2: error?.message || t('community.tryAgain') });
        },
      }
    );
  };

  const handleReply = React.useCallback((item: CommunityComment) => {
    setReplyTo(item);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleDelete = React.useCallback(
    async (item: CommunityComment) => {
      const ok = await confirmAction({
        title: t('community.deleteCommentTitle'),
        confirmText: t('community.delete'),
        cancelText: t('community.cancel'),
        destructive: true,
      });
      if (!ok) return;
      deleteComment.mutate(
        { postId: item.postId, commentId: item.id },
        { onError: (error: any) => Toast.show({ type: 'error', text1: t('community.actionFailed'), text2: error?.message || t('community.tryAgain') }) }
      );
    },
    [deleteComment, t]
  );

  const canSend = text.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('community.cancel')} />
        <View style={[styles.sheet, { backgroundColor: theme.cardBackground }]}>
          <View style={[styles.grabber, { backgroundColor: theme.borderColor }]} />
          <View style={[styles.header, { borderBottomColor: theme.divider }]}>
            <Text style={[Typography.subheading, { color: theme.text }]}>{t('community.comments')}</Text>
            <TouchableOpacity onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('community.cancel')}>
              <X size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            style={styles.flex}
            contentContainerStyle={[styles.list, comments.length === 0 && styles.listEmpty]}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={10}
            windowSize={7}
            renderItem={({ item }) => (
              <CommentRow
                item={item}
                parentName={item.parentId ? namesById.get(item.parentId) : undefined}
                isOwn={item.authorId === viewerId}
                onReply={handleReply}
                onDelete={handleDelete}
                onOpenAuthor={onOpenAuthor}
              />
            )}
            ListEmptyComponent={
              commentsQuery.isLoading ? (
                <ActivityIndicator color={theme.primary} />
              ) : (
                <View style={styles.empty}>
                  <View style={[styles.emptyIcon, { backgroundColor: theme.primarySoft }]}>
                    <MessageCircle size={24} color={theme.primary} />
                  </View>
                  <Text style={[Typography.subheading, { color: theme.text }]}>{t('community.noComments')}</Text>
                  <Text style={[Typography.body, { color: theme.textSecondary, textAlign: 'center' }]}>{t('community.noCommentsHint')}</Text>
                </View>
              )
            }
          />

          {replyTo ? (
            <View style={[styles.replyBar, { backgroundColor: theme.primarySoft }]}>
              <Text style={[Typography.caption, styles.flex, { color: theme.primary }]} numberOfLines={1}>
                {t('community.replyingTo', { name: replyTo.author.fullName })}
              </Text>
              <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('community.cancel')}>
                <X size={14} color={theme.primary} />
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={[styles.composer, { borderTopColor: theme.divider, paddingBottom: Math.max(insets.bottom + 8, 14) }]}>
            <CommunityAvatar name={viewerName} uri={viewerAvatar} size={34} />
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              placeholder={t('community.writeComment')}
              placeholderTextColor={theme.textTertiary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceMuted }]}
              maxLength={500}
              multiline
            />
            <TouchableOpacity
              onPress={submit}
              disabled={!canSend}
              style={[styles.send, { backgroundColor: canSend ? theme.buttonPrimary : theme.surfaceMuted }]}
              accessibilityRole="button"
              accessibilityLabel={t('community.comment')}
            >
              <Send size={16} color={canSend ? '#FFFFFF' : theme.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { height: '80%', borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, overflow: 'hidden' },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  list: { padding: Spacing.lg, gap: Spacing.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  row: { flexDirection: 'row', gap: Spacing.sm },
  replyRow: { marginLeft: 42 },
  pending: { opacity: 0.6 },
  bubble: { borderRadius: Radius.lg, borderTopLeftRadius: 4, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 2, alignSelf: 'flex-start', maxWidth: '100%' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1 },
  body: { fontSize: 14, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: 4, marginLeft: Spacing.xs },
  metaAction: { fontSize: 12, fontWeight: '700' },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xxl },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  input: { flex: 1, minHeight: 38, maxHeight: 100, borderRadius: 19, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 14 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
