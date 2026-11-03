package com.cd4.backend.modules.chat.services;

import com.cd4.backend.modules.chat.models.ChatRoom;
import com.cd4.backend.modules.chat.repositories.ChatRoomRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Kept apart from ChatService so the booking step can create a room without pulling in messaging. */
@Service
@RequiredArgsConstructor
public class ChatRoomService {
    private final ChatRoomRepository rooms;

    @Transactional
    public ChatRoom ensureRoom(UUID patientId, UUID doctorId) {
        return rooms.findByPatientIdAndDoctorId(patientId, doctorId).orElseGet(() -> {
            ChatRoom room = new ChatRoom();
            room.setPatientId(patientId);
            room.setDoctorId(doctorId);
            return rooms.save(room);
        });
    }
}
