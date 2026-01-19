import User from '../models/User.model.js';
import Hospital from '../models/Hospital.model.js';
import Doctor from '../models/Doctor.model.js';
import Approval from '../models/Approval.model.js';
import Appointment from '../models/Appointment.model.js';
import Chamber from '../models/Chamber.model.js';
import HospitalSchedule from '../models/HospitalSchedule.model.js';
import HomeService from '../models/HomeService.model.js';
import HomeServiceRequest from '../models/HomeServiceRequest.model.js';
import SerialSettings from '../models/SerialSettings.model.js';
import { createAndSendNotification } from '../services/notification.service.js';
import { validationResult } from 'express-validator';
import moment from 'moment';

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
      licenseDocumentUrl: licenseDocumentUrl || '', // Optional - can be uploaded later
      specialization: Array.isArray(specialization) ? specialization : [specialization],
      qualifications: qualifications || '',
      experienceYears,
      chamber: chamber || null,
      hospitalId,
      profilePhotoUrl: profilePhotoUrl || '',
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

/**
 * GET /api/hospitals/:hospitalId/profile
 * Get hospital profile (hospital admin only)
 */
export const getHospitalProfile = async (req, res) => {
  try {
    const { hospitalId } = req.params;
    const hospital = await Hospital.findById(hospitalId)
      .populate('userId', 'name email phone')
      .populate('admins', 'name email phone')
      .populate('associatedDoctors.doctor', 'name email specialization status');

    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    res.json({
      success: true,
      data: { hospital }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hospital profile',
      error: error.message
    });
  }
};

/**
 * PUT /api/hospitals/:hospitalId/profile
 * Update hospital profile
 * - When approved: Can update non-critical fields (logo, departments, contactInfo, facilities, services)
 * - When approved: Critical fields (name, address, registrationNumber) are read-only
 * - When not approved: Can update all fields
 */
export const updateHospitalProfile = async (req, res) => {
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
    const hospital = await Hospital.findById(hospitalId);

    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Define critical fields that cannot be changed when approved
    const criticalFields = ['name', 'address', 'registrationNumber'];
    
    // If hospital is approved, only allow non-critical fields to be updated
    if (hospital.status === 'approved') {
      // Check if user is trying to update critical fields
      const attemptingCriticalUpdate = criticalFields.some(field => req.body[field] !== undefined);
      
      if (attemptingCriticalUpdate) {
        return res.status(403).json({
          success: false,
          message: 'Critical fields (name, address, registrationNumber) are read-only when verification status is Active (approved). You can only update: logo, departments, contactInfo, facilities, services.'
        });
      }
      
      // Allow updates to non-critical fields only
      const allowedFieldsWhenApproved = ['contactInfo', 'departments', 'logo', 'facilities', 'services'];
      allowedFieldsWhenApproved.forEach(field => {
        if (req.body[field] !== undefined) {
          hospital[field] = req.body[field];
        }
      });
    } else {
      // When not approved, allow all fields to be updated
      const allowedFields = ['name', 'address', 'contactInfo', 'departments', 'logo', 'facilities', 'services'];
      allowedFields.forEach(field => {
        if (req.body[field] !== undefined) {
          hospital[field] = req.body[field];
        }
      });
    }

    await hospital.save();

    res.json({
      success: true,
      message: 'Hospital profile updated successfully',
      data: { hospital }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update hospital profile',
      error: error.message
    });
  }
};

/**
 * GET /api/hospitals/:hospitalId/doctors/search
 * Search verified doctors (status = approved) to link to hospital
 */
export const searchVerifiedDoctors = async (req, res) => {
  try {
    const { hospitalId } = req.params;
    const { search, specialization, page = 1, limit = 20 } = req.query;

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Build query for verified doctors only
    const query = {
      status: 'approved' // Only verified/active doctors
    };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { medicalLicenseNumber: { $regex: search, $options: 'i' } }
      ];
    }

    if (specialization) {
      query.specialization = { $in: [specialization] };
    }

    // Exclude doctors already linked to this hospital
    const linkedDoctorIds = hospital.associatedDoctors.map(ad => ad.doctor.toString());
    if (linkedDoctorIds.length > 0) {
      query._id = { $nin: linkedDoctorIds };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const doctors = await Doctor.find(query)
      .select('name email phone specialization medicalLicenseNumber status')
      .limit(parseInt(limit))
      .skip(skip)
      .sort({ createdAt: -1 });

    const total = await Doctor.countDocuments(query);

    res.json({
      success: true,
      data: {
        doctors,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to search doctors',
      error: error.message
    });
  }
};

/**
 * POST /api/hospitals/:hospitalId/doctors/link
 * Link existing verified doctor to hospital
 */
export const linkDoctorToHospital = async (req, res) => {
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
    const { doctorId, designation, department } = req.body;

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
        message: 'Hospital must be approved to link doctors'
      });
    }

    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    if (doctor.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Only verified (approved) doctors can be linked to hospitals'
      });
    }

    // Check if doctor is already linked to this hospital
    const alreadyLinked = hospital.associatedDoctors.some(
      ad => ad.doctor.toString() === doctorId
    );

    if (alreadyLinked) {
      return res.status(409).json({
        success: false,
        message: 'Doctor is already linked to this hospital'
      });
    }

    // Add doctor to hospital's associated doctors
    hospital.associatedDoctors.push({
      doctor: doctorId,
      designation: designation || '',
      department: department || '',
      joinedAt: new Date()
    });

    // Update doctor's hospitalId if not set
    if (!doctor.hospitalId || doctor.hospitalId.toString() !== hospitalId) {
      doctor.hospitalId = hospitalId;
      await doctor.save();
    }

    await hospital.save();

    res.json({
      success: true,
      message: 'Doctor linked to hospital successfully',
      data: {
        doctor: {
          id: doctor._id,
          name: doctor.name,
          email: doctor.email
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to link doctor to hospital',
      error: error.message
    });
  }
};

/**
 * DELETE /api/hospitals/:hospitalId/doctors/:doctorId
 * Remove doctor from hospital
 */
export const removeDoctorFromHospital = async (req, res) => {
  try {
    const { hospitalId, doctorId } = req.params;

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Remove doctor from associated doctors
    hospital.associatedDoctors = hospital.associatedDoctors.filter(
      ad => ad.doctor.toString() !== doctorId
    );

    await hospital.save();

    res.json({
      success: true,
      message: 'Doctor removed from hospital successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to remove doctor from hospital',
      error: error.message
    });
  }
};

/**
 * GET /api/hospitals/:hospitalId/appointments
 * View appointments booked under hospital (read-only)
 */
export const getHospitalAppointments = async (req, res) => {
  try {
    const { hospitalId } = req.params;
    const { date, doctorId, status, page = 1, limit = 20 } = req.query;

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Get all chambers for this hospital
    const chambers = await Chamber.find({ hospitalId }).select('_id');
    const chamberIds = chambers.map(c => c._id);

    if (chamberIds.length === 0) {
      return res.json({
        success: true,
        data: {
          appointments: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
            pages: 0
          }
        }
      });
    }

    // Build query
    const query = { chamberId: { $in: chamberIds } };

    if (date) {
      const startDate = moment(date).startOf('day').toDate();
      const endDate = moment(date).endOf('day').toDate();
      query.appointmentDate = { $gte: startDate, $lte: endDate };
    }

    if (doctorId) {
      query.doctorId = doctorId;
    }

    if (status) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const appointments = await Appointment.find(query)
      .populate('patientId', 'name email phone')
      .populate('doctorId', 'name email specialization')
      .populate('chamberId', 'name address')
      .sort({ appointmentDate: -1, createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Appointment.countDocuments(query);

    res.json({
      success: true,
      data: {
        appointments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hospital appointments',
      error: error.message
    });
  }
};

/**
 * GET /api/hospitals/:hospitalId/dashboard
 * Get hospital dashboard metrics
 */
export const getHospitalDashboard = async (req, res) => {
  try {
    const { hospitalId } = req.params;

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Get all chambers for this hospital
    const chambers = await Chamber.find({ hospitalId }).select('_id');
    const chamberIds = chambers.map(c => c._id);

    const today = moment().startOf('day').toDate();
    const tomorrow = moment().endOf('day').toDate();

    // Total doctors linked
    const totalDoctors = hospital.associatedDoctors.length;

    // Today's appointments
    const todayAppointments = await Appointment.countDocuments({
      chamberId: { $in: chamberIds },
      appointmentDate: { $gte: today, $lte: tomorrow }
    });

    // Upcoming appointments (future appointments with pending/accepted status)
    const upcomingAppointments = await Appointment.countDocuments({
      chamberId: { $in: chamberIds },
      appointmentDate: { $gte: tomorrow },
      status: { $in: ['pending', 'accepted'] }
    });

    res.json({
      success: true,
      data: {
        metrics: {
          totalDoctorsLinked: totalDoctors,
          todayAppointments: todayAppointments,
          upcomingAppointments: upcomingAppointments
        },
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
      message: 'Failed to fetch hospital dashboard',
      error: error.message
    });
  }
};

/**
 * POST /api/hospitals/:hospitalId/home-services
 * Create a new home service for the hospital
 */
export const createHomeService = async (req, res) => {
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
    const { serviceType, price, note, availableTime, offDays } = req.body;

    // Verify hospital exists
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Validate availableTime format
    if (availableTime) {
      const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
      if (availableTime.startTime && !timeRegex.test(availableTime.startTime)) {
        return res.status(400).json({
          success: false,
          message: 'Start time must be in HH:mm format (e.g., 09:00)'
        });
      }
      if (availableTime.endTime && !timeRegex.test(availableTime.endTime)) {
        return res.status(400).json({
          success: false,
          message: 'End time must be in HH:mm format (e.g., 17:00)'
        });
      }

      // Validate that endTime is after startTime
      if (availableTime.startTime && availableTime.endTime) {
        const [startHour, startMin] = availableTime.startTime.split(':').map(Number);
        const [endHour, endMin] = availableTime.endTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        
        if (endMinutes <= startMinutes) {
          return res.status(400).json({
            success: false,
            message: 'End time must be after start time'
          });
        }
      }
    }

    // Validate offDays
    if (offDays && Array.isArray(offDays)) {
      const invalidDays = offDays.filter(day => day < 0 || day > 6 || !Number.isInteger(day));
      if (invalidDays.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Off days must be integers between 0 (Sunday) and 6 (Saturday)'
        });
      }
    }

    // Create home service
    const homeService = await HomeService.create({
      hospitalId,
      serviceType: serviceType.trim(),
      price,
      note: note ? note.trim() : '',
      availableTime: availableTime || { startTime: '09:00', endTime: '17:00' },
      offDays: offDays || [],
      isActive: true
    });

    res.status(201).json({
      success: true,
      message: 'Home service created successfully',
      data: { homeService }
    });
  } catch (error) {
    console.error('Create home service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create home service',
      error: error.message
    });
  }
};

/**
 * GET /api/hospitals/:hospitalId/home-services
 * Get all home services for a hospital
 */
export const getHomeServices = async (req, res) => {
  try {
    const { hospitalId } = req.params;
    const { isActive } = req.query;

    // Verify hospital exists
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Build query
    const query = { hospitalId };
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const homeServices = await HomeService.find(query)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        homeServices,
        count: homeServices.length
      }
    });
  } catch (error) {
    console.error('Get home services error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch home services',
      error: error.message
    });
  }
};

/**
 * GET /api/hospitals/:hospitalId/home-services/:serviceId
 * Get a specific home service
 */
export const getHomeService = async (req, res) => {
  try {
    const { hospitalId, serviceId } = req.params;

    // Verify hospital exists
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    const homeService = await HomeService.findOne({
      _id: serviceId,
      hospitalId
    });

    if (!homeService) {
      return res.status(404).json({
        success: false,
        message: 'Home service not found'
      });
    }

    res.json({
      success: true,
      data: { homeService }
    });
  } catch (error) {
    console.error('Get home service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch home service',
      error: error.message
    });
  }
};

/**
 * PUT /api/hospitals/:hospitalId/home-services/:serviceId
 * Update a home service
 */
export const updateHomeService = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { hospitalId, serviceId } = req.params;
    const { serviceType, price, note, availableTime, offDays, isActive } = req.body;

    // Verify hospital exists
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    const homeService = await HomeService.findOne({
      _id: serviceId,
      hospitalId
    });

    if (!homeService) {
      return res.status(404).json({
        success: false,
        message: 'Home service not found'
      });
    }

    // Validate availableTime if provided
    if (availableTime) {
      const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
      if (availableTime.startTime && !timeRegex.test(availableTime.startTime)) {
        return res.status(400).json({
          success: false,
          message: 'Start time must be in HH:mm format (e.g., 09:00)'
        });
      }
      if (availableTime.endTime && !timeRegex.test(availableTime.endTime)) {
        return res.status(400).json({
          success: false,
          message: 'End time must be in HH:mm format (e.g., 17:00)'
        });
      }

      // Validate that endTime is after startTime
      const startTime = availableTime.startTime || homeService.availableTime.startTime;
      const endTime = availableTime.endTime || homeService.availableTime.endTime;
      
      if (startTime && endTime) {
        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        
        if (endMinutes <= startMinutes) {
          return res.status(400).json({
            success: false,
            message: 'End time must be after start time'
          });
        }
      }
    }

    // Validate offDays if provided
    if (offDays !== undefined && Array.isArray(offDays)) {
      const invalidDays = offDays.filter(day => day < 0 || day > 6 || !Number.isInteger(day));
      if (invalidDays.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Off days must be integers between 0 (Sunday) and 6 (Saturday)'
        });
      }
    }

    // Update fields
    if (serviceType !== undefined) {
      homeService.serviceType = serviceType.trim();
    }
    if (price !== undefined) {
      homeService.price = price;
    }
    if (note !== undefined) {
      homeService.note = note.trim();
    }
    if (availableTime !== undefined) {
      homeService.availableTime = {
        startTime: availableTime.startTime || homeService.availableTime.startTime,
        endTime: availableTime.endTime || homeService.availableTime.endTime
      };
    }
    if (offDays !== undefined) {
      homeService.offDays = offDays;
    }
    if (isActive !== undefined) {
      homeService.isActive = isActive;
    }

    await homeService.save();

    res.json({
      success: true,
      message: 'Home service updated successfully',
      data: { homeService }
    });
  } catch (error) {
    console.error('Update home service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update home service',
      error: error.message
    });
  }
};

/**
 * DELETE /api/hospitals/:hospitalId/home-services/:serviceId
 * Delete a home service
 */
export const deleteHomeService = async (req, res) => {
  try {
    const { hospitalId, serviceId } = req.params;

    // Verify hospital exists
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    const homeService = await HomeService.findOneAndDelete({
      _id: serviceId,
      hospitalId
    });

    if (!homeService) {
      return res.status(404).json({
        success: false,
        message: 'Home service not found'
      });
    }

    res.json({
      success: true,
      message: 'Home service deleted successfully'
    });
  } catch (error) {
    console.error('Delete home service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete home service',
      error: error.message
    });
  }
};

/**
 * POST /api/hospitals/:hospitalId/doctors/:doctorId/serial-settings
 * Create or update serial settings for a hospital doctor
 */
export const createOrUpdateSerialSettings = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { hospitalId, doctorId } = req.params;
    const { totalSerialsPerDay, serialTimeRange, appointmentPrice, availableDays, isActive } = req.body;

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
        message: 'Hospital must be approved to manage serial settings'
      });
    }

    // Verify doctor exists and is associated with hospital
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
        message: 'Doctor is not associated with this hospital'
      });
    }

    // Validate time range
    if (serialTimeRange) {
      const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
      if (serialTimeRange.startTime && !timeRegex.test(serialTimeRange.startTime)) {
        return res.status(400).json({
          success: false,
          message: 'Start time must be in HH:mm format'
        });
      }
      if (serialTimeRange.endTime && !timeRegex.test(serialTimeRange.endTime)) {
        return res.status(400).json({
          success: false,
          message: 'End time must be in HH:mm format'
        });
      }

      if (serialTimeRange.startTime && serialTimeRange.endTime) {
        const [startHour, startMin] = serialTimeRange.startTime.split(':').map(Number);
        const [endHour, endMin] = serialTimeRange.endTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        
        if (endMinutes <= startMinutes) {
          return res.status(400).json({
            success: false,
            message: 'End time must be after start time'
          });
        }
      }
    }

    // Find or create serial settings
    let serialSettings = await SerialSettings.findOne({
      doctorId,
      hospitalId
    });

    if (serialSettings) {
      // Update existing settings
      if (totalSerialsPerDay !== undefined) serialSettings.totalSerialsPerDay = totalSerialsPerDay;
      if (serialTimeRange !== undefined) serialSettings.serialTimeRange = serialTimeRange;
      if (appointmentPrice !== undefined) serialSettings.appointmentPrice = appointmentPrice;
      if (availableDays !== undefined) serialSettings.availableDays = availableDays;
      if (isActive !== undefined) serialSettings.isActive = isActive;
      
      await serialSettings.save();
    } else {
      // Create new settings
      serialSettings = await SerialSettings.create({
        hospitalId,
        doctorId,
        totalSerialsPerDay: totalSerialsPerDay || 20,
        serialTimeRange: serialTimeRange || { startTime: '09:00', endTime: '17:00' },
        appointmentPrice: appointmentPrice || 0,
        availableDays: availableDays || [],
        isActive: isActive !== undefined ? isActive : true
      });
    }

    res.json({
      success: true,
      message: 'Serial settings saved successfully',
      data: { serialSettings }
    });
  } catch (error) {
    console.error('Create/update serial settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save serial settings',
      error: error.message
    });
  }
};

/**
 * GET /api/hospitals/:hospitalId/doctors/:doctorId/serial-settings
 * Get serial settings for a hospital doctor
 */
export const getSerialSettings = async (req, res) => {
  try {
    const { hospitalId, doctorId } = req.params;

    const serialSettings = await SerialSettings.findOne({
      doctorId,
      hospitalId
    }).populate('doctorId', 'name email').populate('hospitalId', 'name');

    if (!serialSettings) {
      return res.status(404).json({
        success: false,
        message: 'Serial settings not found'
      });
    }

    res.json({
      success: true,
      data: { serialSettings }
    });
  } catch (error) {
    console.error('Get serial settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch serial settings',
      error: error.message
    });
  }
};

/**
 * GET /api/hospitals/:hospitalId/doctors/:doctorId/serial-stats
 * Get serial statistics for a hospital doctor
 */
export const getSerialStats = async (req, res) => {
  try {
    const { hospitalId, doctorId } = req.params;
    const { date } = req.query;

    const serialSettings = await SerialSettings.findOne({
      doctorId,
      hospitalId
    });

    if (!serialSettings) {
      return res.status(404).json({
        success: false,
        message: 'Serial settings not found'
      });
    }

    // Build date range query
    let dateQuery = {};
    if (date) {
      const startDate = moment(date).startOf('day').toDate();
      const endDate = moment(date).endOf('day').toDate();
      dateQuery = {
        appointmentDate: {
          $gte: startDate,
          $lte: endDate
        }
      };
    } else {
      // Get stats for today
      const startDate = moment().startOf('day').toDate();
      const endDate = moment().endOf('day').toDate();
      dateQuery = {
        appointmentDate: {
          $gte: startDate,
          $lte: endDate
        }
      };
    }

    // Get booked serials
    const bookedAppointments = await Appointment.find({
      doctorId,
      ...dateQuery,
      status: { $in: ['pending', 'accepted'] }
    }).populate('patientId', 'name email phone');

    const totalBooked = bookedAppointments.length;
    const availableSerials = serialSettings.totalSerialsPerDay;
    const evenNumberedSerials = Math.floor(availableSerials / 2);
    const bookedEvenSerials = bookedAppointments.filter(apt => {
      // Extract serial number from notes or calculate from time
      const notes = apt.notes || '';
      const serialMatch = notes.match(/Serial #(\d+)/);
      if (serialMatch) {
        const serialNum = parseInt(serialMatch[1]);
        return serialNum % 2 === 0;
      }
      return false;
    }).length;

    res.json({
      success: true,
      data: {
        serialSettings: {
          totalSerialsPerDay: serialSettings.totalSerialsPerDay,
          evenNumberedSerialsAvailable: evenNumberedSerials,
          appointmentPrice: serialSettings.appointmentPrice,
          timeRange: serialSettings.serialTimeRange,
          isActive: serialSettings.isActive
        },
        statistics: {
          date: date || moment().format('YYYY-MM-DD'),
          totalBooked: totalBooked,
          bookedEvenSerials: bookedEvenSerials,
          availableEvenSerials: evenNumberedSerials - bookedEvenSerials,
          bookedPatients: bookedAppointments.map(apt => ({
            appointmentNumber: apt.appointmentNumber,
            patient: {
              name: apt.patientId.name,
              email: apt.patientId.email,
              phone: apt.patientId.phone
            },
            time: apt.timeSlot?.startTime,
            serialNumber: apt.notes ? apt.notes.match(/Serial #(\d+)/)?.[1] : null
          }))
        }
      }
    });
  } catch (error) {
    console.error('Get serial stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch serial statistics',
      error: error.message
    });
  }
};

/**
 * GET /api/hospitals/:hospitalId/home-service-requests
 * Get all home service requests for a hospital
 */
export const getHomeServiceRequests = async (req, res) => {
  try {
    const { hospitalId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Verify hospital exists
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Build query
    const query = { hospitalId };
    if (status) {
      query.status = status;
    }

    const requests = await HomeServiceRequest.find(query)
      .populate('patientId', 'name email phone')
      .populate('homeServiceId', 'serviceType price note')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await HomeServiceRequest.countDocuments(query);

    res.json({
      success: true,
      data: {
        requests,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get home service requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch home service requests',
      error: error.message
    });
  }
};

/**
 * GET /api/hospitals/:hospitalId/home-service-requests/:requestId
 * Get a specific home service request
 */
export const getHomeServiceRequest = async (req, res) => {
  try {
    const { hospitalId, requestId } = req.params;

    const request = await HomeServiceRequest.findOne({
      _id: requestId,
      hospitalId
    })
      .populate('patientId', 'name email phone')
      .populate('homeServiceId', 'serviceType price note availableTime')
      .populate('acceptedBy', 'name email')
      .populate('rejectedBy', 'name email');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Home service request not found'
      });
    }

    res.json({
      success: true,
      data: { request }
    });
  } catch (error) {
    console.error('Get home service request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch home service request',
      error: error.message
    });
  }
};

/**
 * PUT /api/hospitals/:hospitalId/home-service-requests/:requestId/accept
 * Accept a home service request
 */
export const acceptHomeServiceRequest = async (req, res) => {
  try {
    const { hospitalId, requestId } = req.params;
    const { notes } = req.body;

    // Verify hospital exists
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    const request = await HomeServiceRequest.findOne({
      _id: requestId,
      hospitalId
    }).populate('patientId', 'name email phone');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Home service request not found'
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Request cannot be accepted. Current status: ${request.status}`
      });
    }

    // Update request status
    request.status = 'accepted';
    request.acceptedAt = new Date();
    request.acceptedBy = req.user._id;
    if (notes) {
      request.notes = notes;
    }
    await request.save();

    const io = req.app.get('io');

    // Send notification to patient
    await createAndSendNotification(
      io,
      request.patientId._id,
      'order_status_update',
      'Home Service Request Accepted',
      `Your home service request #${request.requestNumber} has been accepted by ${hospital.name}`,
      request._id,
      'order'
    );

    res.json({
      success: true,
      message: 'Home service request accepted successfully',
      data: { request }
    });
  } catch (error) {
    console.error('Accept home service request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept home service request',
      error: error.message
    });
  }
};

/**
 * PUT /api/hospitals/:hospitalId/home-service-requests/:requestId/reject
 * Reject a home service request
 */
export const rejectHomeServiceRequest = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { hospitalId, requestId } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason || rejectionReason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    // Verify hospital exists
    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    const request = await HomeServiceRequest.findOne({
      _id: requestId,
      hospitalId
    }).populate('patientId', 'name email phone');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Home service request not found'
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Request cannot be rejected. Current status: ${request.status}`
      });
    }

    // Update request status
    request.status = 'rejected';
    request.rejectedAt = new Date();
    request.rejectedBy = req.user._id;
    request.rejectionReason = rejectionReason.trim();
    await request.save();

    const io = req.app.get('io');

    // Send notification to patient
    await createAndSendNotification(
      io,
      request.patientId._id,
      'order_status_update',
      'Home Service Request Rejected',
      `Your home service request #${request.requestNumber} has been rejected. Reason: ${rejectionReason}`,
      request._id,
      'order'
    );

    res.json({
      success: true,
      message: 'Home service request rejected successfully',
      data: { request }
    });
  } catch (error) {
    console.error('Reject home service request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject home service request',
      error: error.message
    });
  }
};