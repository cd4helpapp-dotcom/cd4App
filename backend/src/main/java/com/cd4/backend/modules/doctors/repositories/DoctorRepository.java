package com.cd4.backend.modules.doctors.repositories;

import com.cd4.backend.modules.doctors.models.Doctor;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface DoctorRepository extends JpaRepository<Doctor, UUID> {
    boolean existsByRegistrationNumber(String registrationNumber);

    List<Doctor> findByIdIn(Collection<UUID> ids);

    Page<Doctor> findByVerifiedFalseOrderByCreatedAtAsc(Pageable pageable);

    @Query("""
        select d from Doctor d, Profile p
        where p.id = d.id and d.verified = true
          and (:city is null or lower(d.city) like lower(concat('%', cast(:city as string), '%')))
          and (:specialization is null or lower(d.specialization) like lower(concat('%', cast(:specialization as string), '%')))
          and (:name is null or lower(concat(p.firstName, ' ', p.lastName)) like lower(concat('%', cast(:name as string), '%')))
        order by d.rating desc nulls last, d.createdAt desc
        """)
    Page<Doctor> searchVerified(String city, String specialization, String name, Pageable pageable);
}
