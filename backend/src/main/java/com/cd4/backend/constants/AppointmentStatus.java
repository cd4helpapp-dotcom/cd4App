package com.cd4.backend.constants;

import java.util.List;

public final class AppointmentStatus {
    public static final String PENDING = "pending";
    public static final String CONFIRMED = "confirmed";
    public static final String COMPLETED = "completed";
    public static final String CANCELLED = "cancelled";

    public static final List<String> ACTIVE = List.of(PENDING, CONFIRMED);
    public static final List<String> COUNTS_FOR_COOLDOWN = List.of(PENDING, CONFIRMED, COMPLETED);

    private AppointmentStatus() {}
}
