package com.cd4.backend.modules.subscriptions.repositories;

import com.cd4.backend.modules.subscriptions.models.SubscriptionPayment;
import com.cd4.backend.modules.subscriptions.models.UserSubscription;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public final class SubscriptionRepositories {
    private SubscriptionRepositories() {}

    public interface Subscriptions extends JpaRepository<UserSubscription, UUID> {
        @Query("""
            select s from UserSubscription s
            where s.userId = :userId and s.planCode = 'pro' and s.status in ('active', 'trialing', 'grace') and s.expiresAt > :now
            order by s.expiresAt desc
            """)
        List<UserSubscription> findCurrent(UUID userId, Instant now);

        @Query("select s from UserSubscription s where s.userId = :userId and s.status in ('active', 'trialing', 'grace', 'pending')")
        List<UserSubscription> findOpen(UUID userId);
    }

    public interface Payments extends JpaRepository<SubscriptionPayment, UUID> {
        @Lock(LockModeType.PESSIMISTIC_WRITE)
        @Query("select p from SubscriptionPayment p where p.orderId = :orderId")
        Optional<SubscriptionPayment> lockByOrderId(String orderId);
    }
}
