package com.cd4.backend.modules.calls.services;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.TreeMap;
import java.util.zip.Deflater;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Builds an Agora AccessToken2 ("007") for an RTC channel, following Agora's published format. */
public final class AgoraTokenBuilder {
    private static final short SERVICE_RTC = 1;
    private static final short PRIVILEGE_JOIN_CHANNEL = 1;
    private static final short PRIVILEGE_PUBLISH_AUDIO = 2;
    private static final short PRIVILEGE_PUBLISH_VIDEO = 3;
    private static final short PRIVILEGE_PUBLISH_DATA = 4;
    private static final SecureRandom RANDOM = new SecureRandom();

    private AgoraTokenBuilder() {}

    public static String build(String appId, String appCertificate, String channel, long uid, int expireSeconds, long issuedAtSeconds) {
        int salt = RANDOM.nextInt(99_999_999) + 1;
        return build(appId, appCertificate, channel, uid, expireSeconds, issuedAtSeconds, salt);
    }

    static String build(String appId, String appCertificate, String channel, long uid, int expireSeconds, long issuedAtSeconds, int salt) {
        byte[] issue = uint32(issuedAtSeconds);
        byte[] signingKey = hmac(uint32(salt), hmac(issue, appCertificate.getBytes(StandardCharsets.UTF_8)));
        ByteArrayOutputStream info = new ByteArrayOutputStream();
        write(info, string(appId));
        write(info, issue);
        write(info, uint32(expireSeconds));
        write(info, uint32(salt));
        write(info, uint16((short) 1));
        write(info, rtcService(channel, uid, expireSeconds));
        byte[] signingInfo = info.toByteArray();
        byte[] signature = hmac(signingKey, signingInfo);

        ByteArrayOutputStream content = new ByteArrayOutputStream();
        write(content, bytes(signature));
        write(content, signingInfo);
        return "007" + Base64.getEncoder().encodeToString(deflate(content.toByteArray()));
    }

    private static byte[] rtcService(String channel, long uid, int expireSeconds) {
        TreeMap<Short, Integer> privileges = new TreeMap<>();
        privileges.put(PRIVILEGE_JOIN_CHANNEL, expireSeconds);
        privileges.put(PRIVILEGE_PUBLISH_AUDIO, expireSeconds);
        privileges.put(PRIVILEGE_PUBLISH_VIDEO, expireSeconds);
        privileges.put(PRIVILEGE_PUBLISH_DATA, expireSeconds);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write(out, uint16(SERVICE_RTC));
        write(out, uint16((short) privileges.size()));
        privileges.forEach((key, value) -> {
            write(out, uint16(key));
            write(out, uint32(value));
        });
        write(out, string(channel));
        write(out, string(uid == 0 ? "" : Long.toString(uid)));
        return out.toByteArray();
    }

    private static byte[] hmac(byte[] key, byte[] message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(message);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] uint16(short value) {
        return ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(value).array();
    }

    private static byte[] uint32(long value) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt((int) value).array();
    }

    private static byte[] bytes(byte[] value) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write(out, uint16((short) value.length));
        write(out, value);
        return out.toByteArray();
    }

    private static byte[] string(String value) {
        return bytes(value.getBytes(StandardCharsets.UTF_8));
    }

    private static void write(ByteArrayOutputStream out, byte[] value) {
        out.write(value, 0, value.length);
    }

    private static byte[] deflate(byte[] input) {
        Deflater deflater = new Deflater();
        deflater.setInput(input);
        deflater.finish();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[1024];
        while (!deflater.finished()) {
            int count = deflater.deflate(buffer);
            out.write(buffer, 0, count);
        }
        deflater.end();
        return out.toByteArray();
    }
}
