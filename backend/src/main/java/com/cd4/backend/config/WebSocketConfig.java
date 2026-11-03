package com.cd4.backend.config;

import com.cd4.backend.middlewares.CurrentUser;
import com.cd4.backend.modules.auth.services.JwtService;
import com.cd4.backend.modules.chat.repositories.ChatRoomRepository;
import java.security.Principal;
import java.util.Arrays;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Lazy;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * Live events over a websocket. The app sends its token in the CONNECT frame, not the URL, so it does not end up in server logs.
 * A person can only subscribe to the rooms they belong to.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    private static final Pattern ROOM_TOPIC = Pattern.compile("^/topic/rooms/([0-9a-fA-F-]{36})$");

    private final JwtService jwtService;
    private final ChatRoomRepository rooms;
    private final AppProperties properties;

    public WebSocketConfig(JwtService jwtService, @Lazy ChatRoomRepository rooms, AppProperties properties) {
        this.jwtService = jwtService;
        this.rooms = rooms;
        this.properties = properties;
    }

    public record SocketUser(CurrentUser user) implements Principal {
        @Override
        public String getName() {
            return user.id().toString();
        }
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        String[] origins = Arrays.stream(properties.security().corsAllowedOrigins().split(",")).map(String::trim).toArray(String[]::new);
        registry.addEndpoint("/ws").setAllowedOrigins(origins);
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (accessor == null || accessor.getCommand() == null) return message;
                if (accessor.getCommand() == StompCommand.CONNECT) {
                    String header = accessor.getFirstNativeHeader("Authorization");
                    String token = header != null && header.startsWith("Bearer ") ? header.substring(7).trim() : "";
                    CurrentUser user = jwtService.parse(token).orElseThrow(() -> new MessagingException("Unauthorized"));
                    accessor.setUser(new SocketUser(user));
                } else if (accessor.getCommand() == StompCommand.SUBSCRIBE) {
                    authorizeSubscription(accessor);
                } else if (accessor.getCommand() == StompCommand.SEND) {
                    // Everything is sent through the REST API, where it is checked and saved.
                    throw new MessagingException("Sending over the socket is not allowed");
                }
                return message;
            }
        });
    }

    void authorizeSubscription(StompHeaderAccessor accessor) {
        if (!(accessor.getUser() instanceof SocketUser socketUser)) {
            throw new MessagingException("Unauthorized");
        }
        String destination = String.valueOf(accessor.getDestination());
        if (destination.startsWith("/user/queue/")) return;
        Matcher matcher = ROOM_TOPIC.matcher(destination);
        boolean allowed = matcher.matches() && rooms.findById(UUID.fromString(matcher.group(1)))
            .map(room -> room.hasParticipant(socketUser.user().id()))
            .orElse(false);
        if (!allowed) {
            throw new MessagingException("You do not have access to this chat");
        }
    }
}
