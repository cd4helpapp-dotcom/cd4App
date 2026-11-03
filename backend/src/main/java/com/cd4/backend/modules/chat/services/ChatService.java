package com.cd4.backend.modules.chat.services;

import com.cd4.backend.config.AppProperties;
import com.cd4.backend.constants.AppointmentStatus;
import com.cd4.backend.modules.appointments.models.Appointment;
import com.cd4.backend.modules.appointments.repositories.AppointmentRepository;
import com.cd4.backend.modules.chat.dtos.ChatDtos.MessageResponse;
import com.cd4.backend.modules.chat.dtos.ChatDtos.RoomEvent;
import com.cd4.backend.modules.chat.dtos.ChatDtos.RoomResponse;
import com.cd4.backend.modules.chat.dtos.ChatDtos.SendMessageRequest;
import com.cd4.backend.modules.chat.models.ChatMessage;
import com.cd4.backend.modules.chat.models.ChatRoom;
import com.cd4.backend.modules.chat.repositories.ChatMessageRepository;
import com.cd4.backend.modules.chat.repositories.ChatRoomRepository;
import com.cd4.backend.modules.notifications.services.NotificationService;
import com.cd4.backend.modules.slots.models.Slot;
import com.cd4.backend.modules.slots.repositories.SlotRepository;
import com.cd4.backend.modules.users.models.Profile;
import com.cd4.backend.modules.users.repositories.ProfileRepository;
import com.cd4.backend.utils.ApiError;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
@RequiredArgsConstructor
public class ChatService {
    private static final int CHAT_DAYS_AFTER_VISIT = 30;
    private static final int PAGE_SIZE = 40;
    private static final List<String> COUNTED_STATUSES = List.of(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED);

    private final ChatRoomRepository rooms;
    private final ChatMessageRepository messages;
    private final AppointmentRepository appointments;
    private final SlotRepository slots;
    private final ProfileRepository profiles;
    private final NotificationService notifications;
    private final SimpMessagingTemplate broker;
    private final AppProperties properties;

    public record Window(boolean enabled, String reason) {}

    /** Chat stays open while a visit is ahead and for 30 days after the last one. */
    public Window chatWindow(UUID patientId, UUID doctorId) {
        List<Appointment> rows = appointments.findByPatientIdAndDoctorIdAndStatusIn(patientId, doctorId, COUNTED_STATUSES);
        if (rows.isEmpty()) return new Window(false, "Book an appointment to enable chat.");
        LocalDate today = LocalDate.now(ZoneId.of(properties.booking().timeZone()));
        LocalDate latest = slots.findByIdIn(rows.stream().map(Appointment::getSlotId).toList()).stream()
            .map(Slot::getDate).max(LocalDate::compareTo).orElse(null);
        if (latest == null) return new Window(false, "Book an appointment to enable chat.");
        if (!today.isAfter(latest.plusDays(CHAT_DAYS_AFTER_VISIT))) return new Window(true, null);
        return new Window(false, "Chat window expired. Book a future slot to reopen it.");
    }

    @Transactional(readOnly = true)
    public List<RoomResponse> roomsFor(UUID userId) {
        List<ChatRoom> list = rooms.findForUser(userId);
        Map<UUID, Profile> others = profiles.findByIdIn(list.stream().map(r -> r.otherParty(userId)).toList()).stream()
            .collect(Collectors.toMap(Profile::getId, Function.identity()));
        return list.stream().map(room -> {
            Profile other = others.get(room.otherParty(userId));
            Window window = chatWindow(room.getPatientId(), room.getDoctorId());
            int unread = room.getPatientId().equals(userId) ? room.getUnreadCountPatient() : room.getUnreadCountDoctor();
            return new RoomResponse(room.getId(), room.otherParty(userId), other == null ? "" : other.fullName(), other == null ? null : other.getProfilePicture(),
                other == null ? null : other.getLastSeenAt(), room.getLastMessageText(), room.getLastMessageAt(), unread, window.enabled(), window.reason());
        }).toList();
    }

    public ChatRoom requireRoom(UUID roomId, UUID userId) {
        ChatRoom room = rooms.findById(roomId).orElseThrow(() -> ApiError.notFound("This chat was not found."));
        if (!room.hasParticipant(userId)) {
            throw ApiError.forbidden("You do not have access to this chat.");
        }
        return room;
    }

    @Transactional(readOnly = true)
    public List<MessageResponse> messages(UUID roomId, UUID userId, UUID beforeId) {
        requireRoom(roomId, userId);
        PageRequest page = PageRequest.of(0, PAGE_SIZE);
        List<ChatMessage> found;
        if (beforeId == null) {
            found = messages.findLatest(roomId, page);
        } else {
            ChatMessage before = messages.findById(beforeId).filter(m -> m.getRoomId().equals(roomId))
                .orElseThrow(() -> ApiError.notFound("This message was not found."));
            found = messages.findOlder(roomId, before, page);
        }
        return found.stream().map(MessageResponse::of).toList();
    }

    @Transactional
    public MessageResponse send(UUID roomId, UUID senderId, SendMessageRequest request) {
        // The room row is locked, so two messages sent together keep the unread count correct.
        ChatRoom room = rooms.lockById(roomId).orElseThrow(() -> ApiError.notFound("This chat was not found."));
        if (!room.hasParticipant(senderId)) {
            throw ApiError.forbidden("You do not have access to this chat.");
        }
        Window window = chatWindow(room.getPatientId(), room.getDoctorId());
        if (!window.enabled()) {
            throw ApiError.conflict("chat_closed", window.reason());
        }
        String type = request.type() == null ? "text" : request.type();
        boolean hasText = request.text() != null && !request.text().isBlank();
        boolean hasEncrypted = request.isEncrypted() && request.encryptedPayload() != null;
        boolean hasAttachment = request.attachmentUrl() != null && !request.attachmentUrl().isBlank();
        if (!hasText && !hasEncrypted && !hasAttachment) {
            throw ApiError.badRequest("empty_message", "Please write a message first.");
        }
        if (request.replyToId() != null) {
            messages.findById(request.replyToId()).filter(m -> m.getRoomId().equals(roomId))
                .orElseThrow(() -> ApiError.badRequest("bad_reply", "The message you replied to was not found."));
        }

        ChatMessage message = new ChatMessage();
        message.setRoomId(roomId);
        message.setSenderId(senderId);
        // The server never stores readable text for an encrypted message.
        message.setText(request.isEncrypted() ? "Encrypted message" : hasText ? request.text() : "");
        message.setType(type);
        message.setAttachmentUrl(hasAttachment ? request.attachmentUrl() : null);
        message.setReplyToId(request.replyToId());
        message.setEncrypted(request.isEncrypted());
        message.setEncryptedPayload(request.isEncrypted() ? request.encryptedPayload() : null);
        message.setEncryptionVersion(request.encryptionVersion());
        messages.saveAndFlush(message);

        room.setLastMessageAt(message.getCreatedAt());
        room.setLastMessageText(preview(message));
        if (room.getPatientId().equals(senderId)) {
            room.setUnreadCountDoctor(room.getUnreadCountDoctor() + 1);
        } else {
            room.setUnreadCountPatient(room.getUnreadCountPatient() + 1);
        }

        MessageResponse response = MessageResponse.of(message);
        UUID recipient = room.otherParty(senderId);
        afterCommit(() -> {
            publish(roomId, "message.new", response);
            Profile sender = profiles.findById(senderId).orElse(null);
            Map<String, Object> data = new HashMap<>();
            data.put("type", "chat_message");
            data.put("roomId", roomId.toString());
            notifications.pushOnly(recipient, sender == null ? "New message" : sender.fullName(), pushBody(message), data, "default", null);
        });
        return response;
    }

    /** Only the signed-in person's own side is cleared, and only their counter. */
    @Transactional
    public void markRead(UUID roomId, UUID readerId) {
        ChatRoom room = rooms.lockById(roomId).orElseThrow(() -> ApiError.notFound("This chat was not found."));
        if (!room.hasParticipant(readerId)) {
            throw ApiError.forbidden("You do not have access to this chat.");
        }
        if (room.getPatientId().equals(readerId)) {
            room.setUnreadCountPatient(0);
        } else {
            room.setUnreadCountDoctor(0);
        }
        int changed = messages.markReadBy(roomId, readerId);
        if (changed > 0) {
            afterCommit(() -> publish(roomId, "message.read", Map.of("readerId", readerId.toString())));
        }
    }

    public void typing(UUID roomId, UUID userId) {
        requireRoom(roomId, userId);
        publish(roomId, "typing", Map.of("userId", userId.toString()));
    }

    public void publish(UUID roomId, String type, Object data) {
        broker.convertAndSend("/topic/rooms/" + roomId, new RoomEvent(type, roomId, data));
    }

    // Others must not hear about a message that a rollback could still remove.
    private static void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }

    private static String preview(ChatMessage m) {
        if ("image".equals(m.getType())) return "Photo";
        if ("file".equals(m.getType())) return "File";
        if (m.isEncrypted()) return "Encrypted message";
        return m.getText().length() > 120 ? m.getText().substring(0, 120) : m.getText();
    }

    // Message text never goes through the push provider.
    private static String pushBody(ChatMessage m) {
        if ("image".equals(m.getType())) return "Sent a photo";
        if ("file".equals(m.getType())) return "Sent a file";
        return "New message";
    }
}
