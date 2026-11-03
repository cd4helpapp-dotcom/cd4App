package com.cd4.backend.modules.hospitals.services;

import com.cd4.backend.modules.hospitals.dtos.HospitalDtos.OnboardingRequest;
import com.cd4.backend.utils.ApiError;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.cd4.backend.utils.JdbcRows;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** A hospital admin only ever sees their own doctors and patients: every query starts from their own id. */
@Service
@RequiredArgsConstructor
public class HospitalService {
    private final JdbcTemplate jdbc;
    private final JdbcRows rows;

    public void submitOnboarding(UUID adminUserId, OnboardingRequest r, String loginEmail) {
        Boolean open = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM hospital_onboarding_requests WHERE hospital_admin_user_id = ? AND status <> 'rejected')", Boolean.class, adminUserId);
        if (Boolean.TRUE.equals(open)) {
            throw ApiError.conflict("already_submitted", "Your hospital has already applied.");
        }
        jdbc.update("""
            INSERT INTO hospital_onboarding_requests (registered_name, display_name, facility_type, registration_number, registering_authority, full_address, city, state, pin_code, authorized_person_name, designation, mobile_number, official_email, hospital_admin_user_id, hospital_login_email)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, r.registeredName(), r.displayName(), r.facilityType(), r.registrationNumber(), r.registeringAuthority(), r.fullAddress(), r.city(), r.state(), r.pinCode(),
            r.authorizedPersonName(), r.designation(), r.mobileNumber(), r.officialEmail(), adminUserId, loginEmail);
    }

    public List<Map<String, Object>> onboardingStatus(UUID adminUserId) {
        return rows.query("SELECT id, status, app_account_status, registered_name, created_at FROM hospital_onboarding_requests WHERE hospital_admin_user_id = ? ORDER BY created_at DESC", adminUserId);
    }

    public List<Map<String, Object>> doctors(UUID adminUserId) {
        return rows.query("""
            SELECT h.doctor_id, h.department, h.status, p.first_name, p.last_name, d.specialization
            FROM hospital_doctors h JOIN profiles p ON p.id = h.doctor_id JOIN doctors d ON d.id = h.doctor_id
            WHERE h.hospital_admin_user_id = ? ORDER BY p.first_name
            """, adminUserId);
    }

    public void addDoctor(UUID adminUserId, UUID doctorId, String department) {
        requireApproved(adminUserId);
        try {
            jdbc.update("INSERT INTO hospital_doctors (hospital_admin_user_id, doctor_id, department, added_by) VALUES (?, ?, ?, ?) ON CONFLICT (hospital_admin_user_id, doctor_id) DO NOTHING",
                adminUserId, doctorId, department, adminUserId);
        } catch (DataIntegrityViolationException e) {
            throw ApiError.notFound("This doctor was not found.");
        }
    }

    public void removeDoctor(UUID adminUserId, UUID doctorId) {
        jdbc.update("DELETE FROM hospital_doctors WHERE hospital_admin_user_id = ? AND doctor_id = ?", adminUserId, doctorId);
    }

    public List<Map<String, Object>> patients(UUID adminUserId) {
        return rows.query("""
            SELECT h.patient_id, h.doctor_id, h.status, h.notes, p.first_name, p.last_name
            FROM hospital_patients h JOIN profiles p ON p.id = h.patient_id
            WHERE h.hospital_admin_user_id = ? ORDER BY p.first_name LIMIT 200
            """, adminUserId);
    }

    private void requireApproved(UUID adminUserId) {
        Boolean approved = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM hospital_onboarding_requests WHERE hospital_admin_user_id = ? AND status IN ('approved', 'converted'))", Boolean.class, adminUserId);
        if (!Boolean.TRUE.equals(approved)) {
            throw ApiError.forbidden("Your hospital has not been approved yet.");
        }
    }
}
