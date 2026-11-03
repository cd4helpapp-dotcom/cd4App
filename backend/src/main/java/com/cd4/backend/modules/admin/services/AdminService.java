package com.cd4.backend.modules.admin.services;

import com.cd4.backend.modules.doctors.models.Doctor;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.cd4.backend.modules.doctors.repositories.DoctorRepository;
import com.cd4.backend.modules.notifications.services.NotificationService;
import com.cd4.backend.utils.ApiError;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import com.cd4.backend.utils.JdbcRows;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AdminService {
    private static final Set<String> TICKET_STATUSES = Set.of("open", "in_progress", "resolved", "closed");
    private static final Set<String> REPORT_STATUSES = Set.of("reviewed", "dismissed", "actioned");
    private static final Set<String> HOSPITAL_STATUSES = Set.of("under_review", "contacted", "approved", "rejected", "converted");

    private final DoctorRepository doctors;
    private final NotificationService notifications;
    private final JdbcTemplate jdbc;
    private final JdbcRows rows;
    private final ObjectMapper mapper;

    public List<Doctor> pendingDoctors(int page) {
        return doctors.findByVerifiedFalseOrderByCreatedAtAsc(PageRequest.of(Math.max(page, 0), 50)).getContent();
    }

    @Transactional
    public void verifyDoctor(UUID adminId, UUID doctorId, boolean verified) {
        Doctor doctor = doctors.findById(doctorId).orElseThrow(() -> ApiError.notFound("This doctor was not found."));
        doctor.setVerified(verified);
        doctor.setKycVerified(verified);
        audit("doctor_verification", adminId, Map.of("doctorId", doctorId.toString(), "verified", verified));
        if (verified) {
            notifications.notify(doctorId, "account", "You are verified", "Patients can now find and book you on CD4.", Map.of());
        }
    }

    public List<Map<String, Object>> openCommunityReports() {
        return rows.query("""
            SELECT r.id, r.post_id, r.reason, r.details, r.status, r.created_at, p.body AS post_body, p.author_id
            FROM community_post_reports r JOIN community_posts p ON p.id = r.post_id
            WHERE r.status = 'open' ORDER BY r.created_at LIMIT 100
            """);
    }

    @Transactional
    public void resolveCommunityReport(UUID adminId, UUID reportId, String status, boolean hidePost) {
        if (!REPORT_STATUSES.contains(status)) {
            throw ApiError.badRequest("bad_status", "This status is not allowed.");
        }
        int changed = jdbc.update("UPDATE community_post_reports SET status = ?, updated_at = now() WHERE id = ?", status, reportId);
        if (changed == 0) throw ApiError.notFound("This report was not found.");
        if (hidePost) {
            jdbc.update("UPDATE community_posts SET status = 'hidden', moderation_reason = 'Removed after a report', updated_at = now() WHERE id = (SELECT post_id FROM community_post_reports WHERE id = ?)", reportId);
        }
        audit("community_report_resolved", adminId, Map.of("reportId", reportId.toString(), "status", status, "hidden", hidePost));
    }

    public List<Map<String, Object>> tickets(String status) {
        return rows.query("SELECT * FROM support_tickets WHERE status = ? ORDER BY created_at LIMIT 100", status == null ? "open" : status);
    }

    public void updateTicket(UUID id, String status) {
        if (!TICKET_STATUSES.contains(status)) {
            throw ApiError.badRequest("bad_status", "This status is not allowed.");
        }
        int changed = jdbc.update("UPDATE support_tickets SET status = ?, resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN now() END, updated_at = now() WHERE id = ?", status, status, id);
        if (changed == 0) throw ApiError.notFound("This ticket was not found.");
    }

    public List<Map<String, Object>> hospitalRequests(String status) {
        return rows.query("SELECT * FROM hospital_onboarding_requests WHERE status = ? ORDER BY created_at LIMIT 100", status == null ? "new" : status);
    }

    @Transactional
    public void updateHospitalRequest(UUID adminId, UUID id, String status) {
        if (!HOSPITAL_STATUSES.contains(status)) {
            throw ApiError.badRequest("bad_status", "This status is not allowed.");
        }
        int changed = jdbc.update("""
            UPDATE hospital_onboarding_requests
            SET status = ?, app_account_status = CASE WHEN ? = 'approved' THEN 'active' WHEN ? = 'rejected' THEN 'rejected' ELSE app_account_status END, updated_at = now()
            WHERE id = ?
            """, status, status, status, id);
        if (changed == 0) throw ApiError.notFound("This request was not found.");
        audit("hospital_request_updated", adminId, Map.of("requestId", id.toString(), "status", status));
    }

    /** What CD4 owes each doctor: their share of paid appointments not yet in a payout. */
    public List<Map<String, Object>> payoutSummary() {
        return rows.query("""
            SELECT doctor_id, count(*) AS appointments, sum(doctor_share) AS amount_due
            FROM appointment_payments
            WHERE status = 'paid' AND payout_status = 'pending' AND payout_id IS NULL
            GROUP BY doctor_id ORDER BY amount_due DESC
            """);
    }

    /** Records a payout and ties exactly the settled payments to it, so nothing is paid twice. */
    @Transactional
    public UUID recordPayout(UUID adminId, UUID doctorId, String paymentReference, String notes) {
        BigDecimal due = jdbc.queryForObject("SELECT coalesce(sum(doctor_share), 0) FROM appointment_payments WHERE doctor_id = ? AND status = 'paid' AND payout_status = 'pending' AND payout_id IS NULL",
            BigDecimal.class, doctorId);
        if (due == null || due.signum() <= 0) {
            throw ApiError.conflict("nothing_due", "Nothing is due to this doctor.");
        }
        try {
            UUID payoutId = jdbc.queryForObject("""
                INSERT INTO doctor_payouts (doctor_id, created_by, amount, status, payment_reference, notes, paid_at)
                VALUES (?, ?, ?, 'paid', ?, ?, now()) RETURNING id
                """, UUID.class, doctorId, adminId, due, paymentReference, notes);
            jdbc.update("UPDATE appointment_payments SET payout_id = ?, payout_status = 'paid', updated_at = now() WHERE doctor_id = ? AND status = 'paid' AND payout_status = 'pending' AND payout_id IS NULL", payoutId, doctorId);
            audit("doctor_payout", adminId, Map.of("doctorId", doctorId.toString(), "payoutId", String.valueOf(payoutId), "amount", due.toPlainString()));
            return payoutId;
        } catch (DataIntegrityViolationException e) {
            throw ApiError.conflict("payout_failed", "This payout could not be recorded.");
        }
    }

    public List<Map<String, Object>> auditLogs() {
        return rows.query("SELECT * FROM security_audit_logs ORDER BY created_at DESC LIMIT 200");
    }

    private void audit(String event, UUID adminId, Map<String, Object> context) {
        try {
            String json = mapper.writeValueAsString(context);
            jdbc.update("INSERT INTO security_audit_logs (event_type, user_id, source, context) VALUES (?, ?, 'admin', ?::jsonb)", event, adminId, json);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
