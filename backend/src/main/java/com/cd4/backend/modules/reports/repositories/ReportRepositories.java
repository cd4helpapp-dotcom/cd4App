package com.cd4.backend.modules.reports.repositories;

import com.cd4.backend.modules.reports.models.MedicalReport;
import com.cd4.backend.modules.reports.models.MedicalReportChatMessage;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

public final class ReportRepositories {
    private ReportRepositories() {}

    public interface Reports extends JpaRepository<MedicalReport, UUID> {
        List<MedicalReport> findByPatientIdAndDeletedAtIsNullOrderByCreatedAtDesc(UUID patientId, Pageable pageable);

        // Taking a report for analysis is one statement, so two requests can never both start the same analysis.
        @Transactional
        @Modifying
        @Query("update MedicalReport r set r.analysisStatus = 'processing', r.analysisError = null, r.updatedAt = :now where r.id = :id and r.analysisStatus in ('pending', 'failed')")
        int claimForAnalysis(UUID id, Instant now);

        // A server restart in the middle of an analysis must not leave a report stuck forever.
        @Transactional
        @Modifying
        @Query("update MedicalReport r set r.analysisStatus = 'failed', r.analysisError = 'timed_out', r.updatedAt = :now where r.analysisStatus = 'processing' and r.updatedAt < :before")
        int failStuck(Instant before, Instant now);
    }

    public interface Messages extends JpaRepository<MedicalReportChatMessage, UUID> {
        @Query("select m from MedicalReportChatMessage m where m.reportId = :reportId order by m.createdAt desc, m.id desc")
        List<MedicalReportChatMessage> findLatest(UUID reportId, Pageable pageable);
    }
}
