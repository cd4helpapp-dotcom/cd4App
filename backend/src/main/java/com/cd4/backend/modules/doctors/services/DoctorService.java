package com.cd4.backend.modules.doctors.services;

import com.cd4.backend.modules.doctors.dtos.DoctorDtos.DoctorPrivate;
import com.cd4.backend.modules.doctors.dtos.DoctorDtos.DoctorPublic;
import com.cd4.backend.modules.doctors.dtos.DoctorDtos.UpdateDoctorRequest;
import com.cd4.backend.modules.doctors.models.Doctor;
import com.cd4.backend.modules.doctors.repositories.DoctorRepository;
import com.cd4.backend.modules.users.models.Profile;
import com.cd4.backend.modules.users.repositories.ProfileRepository;
import com.cd4.backend.utils.ApiError;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DoctorService {
    private static final int PAGE_SIZE = 20;

    private final DoctorRepository doctors;
    private final ProfileRepository profiles;

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    @Transactional(readOnly = true)
    public List<DoctorPublic> search(String city, String specialization, String name, int page) {
        List<Doctor> found = doctors.searchVerified(blankToNull(city), blankToNull(specialization), blankToNull(name), PageRequest.of(Math.max(page, 0), PAGE_SIZE)).getContent();
        Map<UUID, Profile> byId = profiles.findByIdIn(found.stream().map(Doctor::getId).toList()).stream()
            .collect(Collectors.toMap(Profile::getId, Function.identity()));
        return found.stream().map(d -> toPublic(d, byId.get(d.getId()))).toList();
    }

    @Transactional(readOnly = true)
    public DoctorPublic getPublic(UUID id) {
        Doctor doctor = doctors.findById(id).filter(Doctor::isVerified).orElseThrow(() -> ApiError.notFound("This doctor was not found."));
        return toPublic(doctor, profiles.findById(id).orElseThrow());
    }

    @Transactional(readOnly = true)
    public DoctorPrivate getOwn(UUID id) {
        return toPrivate(requireOwn(id));
    }

    @Transactional
    public DoctorPrivate update(UUID id, UpdateDoctorRequest request) {
        Doctor d = requireOwn(id);
        if (request.city() != null) d.setCity(request.city().trim());
        if (request.specialization() != null) d.setSpecialization(request.specialization().trim());
        if (request.experience() != null) d.setExperience(request.experience().trim());
        if (request.fee() != null) d.setFee(request.fee().trim());
        if (request.bio() != null) d.setBio(request.bio().trim());
        if (request.degree() != null) d.setDegree(request.degree().trim());
        if (request.university() != null) d.setUniversity(request.university().trim());
        if (request.yearOfCompletion() != null) d.setYearOfCompletion(request.yearOfCompletion());
        if (request.registrationCouncil() != null) d.setRegistrationCouncil(request.registrationCouncil().trim());
        if (request.currentHospitalClinic() != null) d.setCurrentHospitalClinic(request.currentHospitalClinic().trim());
        if (request.previousWorkDetails() != null) d.setPreviousWorkDetails(request.previousWorkDetails().trim());
        if (request.areasOfExpertise() != null) d.setAreasOfExpertise(request.areasOfExpertise());
        if (request.languagesSpoken() != null) d.setLanguagesSpoken(request.languagesSpoken());
        if (request.treatmentApproach() != null) d.setTreatmentApproach(request.treatmentApproach().trim());
        if (!d.isProfileCompletionDone() && d.getBio() != null && d.getDegree() != null) {
            d.setProfileCompletionDone(true);
            d.setProfileCompletionDoneAt(Instant.now());
        }
        return toPrivate(d);
    }

    @Transactional
    public DoctorPrivate setSignature(UUID id, String path) {
        Doctor d = requireOwn(id);
        // A doctor can only point at a file in their own folder.
        if (path != null && !path.startsWith(id + "/")) {
            throw ApiError.forbidden("This file does not belong to you.");
        }
        d.setSignaturePath(path);
        return toPrivate(d);
    }

    private Doctor requireOwn(UUID id) {
        return doctors.findById(id).orElseThrow(() -> ApiError.forbidden("This is only for doctor accounts."));
    }

    private static DoctorPublic toPublic(Doctor d, Profile p) {
        return new DoctorPublic(d.getId(), p == null ? "" : p.getFirstName(), p == null ? "" : p.getLastName(), p == null ? null : p.getProfilePicture(),
            d.getCity(), d.getSpecialization(), d.getExperience(), d.getFee(), d.getBio(), d.getRating(), d.getDegree(),
            d.getCurrentHospitalClinic(), d.getAreasOfExpertise(), d.getLanguagesSpoken(), d.getTreatmentApproach());
    }

    private static DoctorPrivate toPrivate(Doctor d) {
        return new DoctorPrivate(d.getId(), d.getCity(), d.getSpecialization(), d.getExperience(), d.getFee(), d.getBio(), d.getRating(),
            d.getRegistrationNumber(), d.getRegistrationCouncil(), d.isVerified(), d.isKycVerified(), d.getSignaturePath(),
            d.getDegree(), d.getUniversity(), d.getYearOfCompletion(), d.getCurrentHospitalClinic(), d.getPreviousWorkDetails(),
            d.getAreasOfExpertise(), d.getLanguagesSpoken(), d.getTreatmentApproach(), d.isProfileCompletionDone());
    }
}
