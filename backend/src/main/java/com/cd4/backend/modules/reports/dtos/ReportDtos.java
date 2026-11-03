package com.cd4.backend.modules.reports.dtos;

import com.cd4.backend.modules.reports.models.MedicalReport;
import com.cd4.backend.modules.reports.models.MedicalReportChatMessage;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class ReportDtos {
    private ReportDtos() {}

    public record ReportResponse(
        UUID id, String fileName, String mimeType, Long fileSizeBytes, String reportType, String analysisStatus, String aiSummary,
        List<Object> aiKeyPoints, Map<String, Object> aiStructured, String analysisError, Instant analyzedAt, Instant createdAt
    ) {
        public static ReportResponse of(MedicalReport r) {
            return new ReportResponse(r.getId(), r.getFileName(), r.getMimeType(), r.getFileSizeBytes(), r.getReportType(), r.getAnalysisStatus(), r.getAiSummary(),
                r.getAiKeyPoints(), r.getAiStructured(), r.getAnalysisError(), r.getAnalyzedAt(), r.getCreatedAt());
        }
    }

    public record AskRequest(@NotBlank @Size(max = 2000) String question) {}

    public record ChatMessageResponse(UUID id, String role, String content, Instant createdAt) {
        public static ChatMessageResponse of(MedicalReportChatMessage m) {
            return new ChatMessageResponse(m.getId(), m.getRole(), m.getContent(), m.getCreatedAt());
        }
    }
}
