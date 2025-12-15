import User from '../models/User.model.js';
import Hospital from '../models/Hospital.model.js';
import Doctor from '../models/Doctor.model.js';
import Approval from '../models/Approval.model.js';
import { validationResult } from 'express-validator';

// Helper function to log approval action
const logApproval = async (actorId, actorRole, targetType, targetId, action, reason, previousStatus, newStatus) => {
  try {
    await Approval.create({
      actorId,
      actorRole,
      targetType,
      targetId,
      action,
      reason,
      previousStatus,
      newStatus,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error logging approval:', error);
  }
};

// Helper function to notify (stub for email integration)
const notifyEmail = async (userEmail, subject, body) => {
  console.log(`[NOTIFICATION] To: ${userEmail}, Subject: ${subject}, Body: ${body}`);
};

/**
 * POST /api/hospitals/register
 * Register a new hospital
 * On creation: status = pending_super_admin
 * Super admin must approve via POST /api/admin/approve/hospital/:hospitalId
 */
export const registerHospital = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      name,
      email,
      phone,
      password,
      address,
      registrationNumber,
      documents
    } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email or phone'
      });
    }

    // Check if registration number already exists
    const existingHospital = await Hospital.findOne({ registrationNumber });
    if (existingHospital) {
      return res.status(400).json({
        success: false,
        message: 'Registration number already exists'
      });
    }

    // Create user with hospital_admin role
    const user = await User.create({
      name,
      email,
      phone,
      password,
      role: 'hospital_admin',
      isActive: false // Inactive until hospital is approved
    });

    // Create hospital record with status: pending_super_admin
    const hospital = await Hospital.create({
      userId: user._id,
      name,
      address,
      registrationNumber,
      documents: Array.isArray(documents) ? documents : [documents],
      status: 'pending_super_admin',
      admins: [user._id] // Add creator as admin
    });

    // Log registration event
    await logApproval(
      user._id,
      'hospital_admin',
      'hospital',
      hospital._id,
      'register',
      null,
      null,
      'pending_super_admin'
    );

    // Send notification (stub)
    await notifyEmail(
      email,
      'Hospital Registration Submitted',
      'Your hospital registration has been submitted and is pending super admin approval.'
    );

    res.status(201).json({
      success: true,
      message: 'Hospital registration successful. Status: pending_super_admin. Awaiting super admin approval.',
      data: {
        hospital: {
          id: hospital._id,
          userId: user._id,
          status: hospital.status,
          registrationNumber: hospital.registrationNumber
        }
      }
    });
  } catch (error) {
    console.error('Hospital registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Hospital registration failed',
      error: error.message
    });
  }
};

/**
 * POST /api/hospitals/:hospitalId/doctors
 * Hospital admin adds doctor directly (auto-approved)
 * If created by approved hospital admin → status: approved immediately
 */
export const addDoctorByHospital = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { hospitalId } = req.params;
    const {
      name,
      email,
      phone,
      password,
      medicalLicenseNumber,
      licenseDocumentUrl,
      specialization,
      qualifications,
      experienceYears,
      chamber,
      profilePhotoUrl
    } = req.body;

    // Verify hospital exists and is approved
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    if (hospital.status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Hospital must be approved before adding doctors'
      });
    }

    // Verify requester is hospital admin
    if (!hospital.admins.includes(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only hospital admins can add doctors'
      });
    }

    // Check if doctor already exists (email or phone)
    const existingDoctorByEmail = await Doctor.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingDoctorByEmail) {
      return res.status(400).json({
        success: false,
        message: 'Doctor already exists with this email or phone'
      });
    }

    // Check if medical license number already exists
    const existingDoctorByLicense = await Doctor.findOne({ medicalLicenseNumber });
    if (existingDoctorByLicense) {
      return res.status(400).json({
        success: false,
        message: 'Medical license number already exists'
      });
    }

    // Also check User table to prevent conflicts
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email or phone already registered as a user'
      });
    }

    // Create doctor record directly in doctors table (NO user record created)
    // Set bmdcNo to medicalLicenseNumber for backward compatibility (prevents null duplicate key error)
    // DO NOT set userId at all - leave it undefined to avoid index conflicts
    const doctorData = {
      name,
      email,
      phone,
      password, // Will be hashed by pre-save hook
      bmdcNo: medicalLicenseNumber, // Set to medicalLicenseNumber to avoid null duplicate key error
      medicalLicenseNumber,
      licenseDocumentUrl,
      specialization: Array.isArray(specialization) ? specialization : [specialization],
      qualifications,
      experienceYears,
      chamber,
      hospitalId,
      profilePhotoUrl,
      status: 'approved' // Auto-approved when added by hospital admin
      // userId is NOT set - leave it undefined (not null) to avoid sparse index conflicts
    };
    
    const doctor = await Doctor.create(doctorData);

    // Add doctor to hospital's associated doctors
    hospital.associatedDoctors.push({
      doctor: doctor._id,
      joinedAt: new Date()
    });
    await hospital.save();

    // Log approval action
    await logApproval(
      req.user._id,
      'hospital_admin',
      'doctor',
      doctor._id,
      'approve',
      'Auto-approved by hospital admin',
      null,
      'approved'
    );

    // Send notification (stub)
    await notifyEmail(
      email,
      'Doctor Account Created',
      'Your doctor account has been created and approved by the hospital admin. You can now login.'
    );

    res.status(201).json({
      success: true,
      message: 'Doctor added and approved successfully',
      data: {
        doctor: {
          id: doctor._id,
          name: doctor.name,
          email: doctor.email,
          status: doctor.status,
          medicalLicenseNumber: doctor.medicalLicenseNumber
        }
      }
    });
  } catch (error) {
    console.error('Add doctor by hospital error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add doctor',
      error: error.message
    });
  }
};

/**
 * GET /api/hospitals/:hospitalId/doctors
 * List doctors for a hospital (hospital admin or super admin)
 */
export const getHospitalDoctors = async (req, res) => {
  try {
    const { hospitalId } = req.params;

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Verify access: hospital admin or super admin
    if (req.user.role !== 'super_admin' && !hospital.admins.includes(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const doctors = await Doctor.find({ hospitalId })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        doctors,
        hospital: {
          id: hospital._id,
          name: hospital.name,
          status: hospital.status
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hospital doctors',
      error: error.message
    });
  }
};

/**
 * POST /api/hospitals/:hospitalId/approve/doctor/:doctorId
 * Hospital admin approves doctor registered under hospital
 */
export const approveDoctorByHospital = async (req, res) => {
  try {
    const { hospitalId, doctorId } = req.params;

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    if (hospital.status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Hospital must be approved to approve doctors'
      });
    }

    // Verify requester is hospital admin
    if (!hospital.admins.includes(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only hospital admins can approve doctors'
      });
    }

    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    if (doctor.hospitalId?.toString() !== hospitalId) {
      return res.status(400).json({
        success: false,
        message: 'Doctor does not belong to this hospital'
      });
    }

    const previousStatus = doctor.status;

    // Only approve if status is pending_hospital or pending_hospital_and_super_admin
    if (!['pending_hospital', 'pending_hospital_and_super_admin'].includes(doctor.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot approve doctor with status: ${doctor.status}`
      });
    }

    // If status was pending_hospital_and_super_admin, check if hospital is now approved
    if (doctor.status === 'pending_hospital_and_super_admin') {
      if (hospital.status !== 'approved') {
        return res.status(400).json({
          success: false,
          message: 'Hospital must be approved by super admin first'
        });
      }
    }

    doctor.status = 'approved';
    await doctor.save();

    // Log approval action
    await logApproval(
      req.user._id,
      'hospital_admin',
      'doctor',
      doctor._id,
      'approve',
      'Approved by hospital admin',
      previousStatus,
      'approved'
    );

    // Send notification (stub)
    await notifyEmail(
      doctor.email,
      'Doctor Approval',
      'Your doctor account has been approved by the hospital admin. You can now login.'
    );

    res.json({
      success: true,
      message: 'Doctor approved successfully',
      data: {
        doctor: {
          id: doctor._id,
          status: doctor.status
        }
      }
    });
  } catch (error) {
    console.error('Approve doctor by hospital error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve doctor',
      error: error.message
    });
  }
};