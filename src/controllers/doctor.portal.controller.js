import Doctor from '../models/Doctor.model.js';
import Chamber from '../models/Chamber.model.js';
import Schedule from '../models/Schedule.model.js';
import Appointment from '../models/Appointment.model.js';
import Prescription from '../models/Prescription.model.js';
import Earning from '../models/Earning.model.js';
import User from '../models/User.model.js';
import { generatePrescriptionPDF } from '../utils/pdfGenerator.util.js';
import { createAndSendNotification } from '../services/notification.service.js';
import { generateSerialListPDF } from '../utils/pdfGenerator.util.js';
import moment from 'moment';
import { validationResult } from 'express-validator';

// Get doctor profile
export const getProfile = async (req, res) => {
  try {
    // Doctors are stored directly in doctors table, use req.user._id (which is doctor._id)
    const doctor = await Doctor.findById(req.user._id);
    
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    res.json({
      success: true,
      data: { doctor }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: error.message
    });
  }
};

// Onboard doctor (register doctor profile) - Legacy endpoint
export const onboardDoctor = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    // Check if doctor already exists
    const existingDoctor = await Doctor.findById(req.user._id);
    if (existingDoctor) {
      return res.status(400).json({
        success: false,
        message: 'Doctor profile already exists'
      });
    }

    const { 
      bmdcNo, 
      specialization, 
      qualifications, 
      experience, 
      bio, 
      consultationFee, 
      followUpFee 
    } = req.body;

    const verificationDocuments = {
      bmdcProof: req.files?.bmdcProof?.[0]?.cloudinaryUrl || req.files?.bmdcProof?.[0]?.path,
      degrees: req.files?.degrees?.map(f => f.cloudinaryUrl || f.path) || [],
      certificates: req.files?.certificates?.map(f => f.cloudinaryUrl || f.path) || []
    };

    const doctor = await Doctor.create({
      userId: req.user._id,
      bmdcNo,
      specialization,
      qualifications,
      experience,
      bio,
      consultationFee,
      followUpFee,
      verificationDocuments,
      status: 'pending_verification'
    });

    res.status(201).json({
      success: true,
      message: 'Doctor profile created. Pending admin verification.',
      data: { doctor }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to onboard doctor',
      error: error.message
    });
  }
};

// Update profile (only allowed after approval)
export const updateProfile = async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.user._id);
    
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    // Only approved doctors can update profile
    if (doctor.status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Profile can only be updated after approval'
      });
    }

    let {
      description,
      bio, // Keep for backward compatibility
      qualifications,
      visitingDays,
      holidays,
      emergencyAvailability,
      socialLinks,
      followUpFee,
      reportFee,
      profilePhotoUrl
    } = req.body;

    // Parse JSON strings if they come as strings
    if (typeof visitingDays === 'string') {
      try {
        visitingDays = JSON.parse(visitingDays);
      } catch (e) {
        visitingDays = [];
      }
    }
    if (typeof holidays === 'string') {
      try {
        holidays = JSON.parse(holidays);
      } catch (e) {
        holidays = [];
      }
    }
    if (typeof emergencyAvailability === 'string') {
      try {
        emergencyAvailability = JSON.parse(emergencyAvailability);
      } catch (e) {
        emergencyAvailability = { available: false, contactNumber: '', notes: '' };
      }
    }
    if (typeof socialLinks === 'string') {
      try {
        socialLinks = JSON.parse(socialLinks);
      } catch (e) {
        socialLinks = {};
      }
    }

    // Handle profile photo upload
    let profilePhoto = profilePhotoUrl;
    if (req.file) {
      profilePhoto = req.file.cloudinaryUrl || req.file.path;
    }

    const updateData = {};
    
    // Description/Bio
    if (description !== undefined) updateData.description = description;
    if (bio !== undefined) updateData.bio = bio; // Backward compatibility
    
    // Qualifications
    if (qualifications !== undefined) updateData.qualifications = qualifications;
    
    // Visiting days and times
    if (visitingDays !== undefined && Array.isArray(visitingDays)) {
      updateData.visitingDays = visitingDays;
    }
    
    // Holidays
    if (holidays !== undefined && Array.isArray(holidays)) {
      updateData.holidays = holidays.map(holiday => ({
        date: new Date(holiday.date),
        reason: holiday.reason || ''
      }));
    }
    
    // Emergency availability
    if (emergencyAvailability !== undefined) {
      updateData.emergencyAvailability = {
        available: emergencyAvailability.available || false,
        contactNumber: emergencyAvailability.contactNumber || '',
        notes: emergencyAvailability.notes || ''
      };
    }
    
    // Social links
    if (socialLinks !== undefined) {
      updateData.socialLinks = {
        facebook: socialLinks.facebook || '',
        twitter: socialLinks.twitter || '',
        linkedin: socialLinks.linkedin || '',
        instagram: socialLinks.instagram || '',
        website: socialLinks.website || ''
      };
    }
    
    // Fees
    if (followUpFee !== undefined) updateData.followUpFee = parseFloat(followUpFee) || 0;
    if (reportFee !== undefined) updateData.reportFee = parseFloat(reportFee) || 0;
    
    // Profile photo
    if (profilePhoto) updateData.profilePhotoUrl = profilePhoto;

    const updatedDoctor = await Doctor.findByIdAndUpdate(
      doctor._id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { doctor: updatedDoctor }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
};

// Create/Update schedule
export const upsertSchedule = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const doctor = await Doctor.findById(req.user._id);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const { chamberId, dayOfWeek, timeSlots, validFrom, validUntil, isActive } = req.body;

    // Check if schedule exists
    const existingSchedule = await Schedule.findOne({
      doctorId: doctor._id,
      chamberId,
      dayOfWeek
    });

    if (existingSchedule) {
      // Update
      existingSchedule.timeSlots = timeSlots;
      if (validFrom) existingSchedule.validFrom = validFrom;
      if (validUntil) existingSchedule.validUntil = validUntil;
      if (isActive !== undefined) existingSchedule.isActive = isActive;
      await existingSchedule.save();

      return res.json({
        success: true,
        message: 'Schedule updated successfully',
        data: { schedule: existingSchedule }
      });
    } else {
      // Create
      const schedule = await Schedule.create({
        doctorId: doctor._id,
        chamberId,
        dayOfWeek,
        timeSlots,
        validFrom: validFrom || new Date(),
        validUntil,
        isActive: isActive !== undefined ? isActive : true
      });

      return res.status(201).json({
        success: true,
        message: 'Schedule created successfully',
        data: { schedule }
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to save schedule',
      error: error.message
    });
  }
};

// Get all schedules
export const getSchedules = async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.user._id);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const schedules = await Schedule.find({ doctorId: doctor._id })
      .populate('chamberId')
      .sort({ dayOfWeek: 1 });

    res.json({
      success: true,
      data: { schedules }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch schedules',
      error: error.message
    });
  }
};

// Get appointments dashboard
export const getAppointments = async (req, res) => {
  try {
    const { filter = 'all', page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const doctor = await Doctor.findById(req.user._id);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const query = { doctorId: doctor._id };
    
    const today = moment().startOf('day').toDate();
    const tomorrow = moment().endOf('day').toDate();

    if (filter === 'today') {
      query.appointmentDate = {
        $gte: today,
        $lte: tomorrow
      };
    } else if (filter === 'upcoming') {
      query.appointmentDate = { $gte: tomorrow };
      query.status = { $in: ['pending', 'accepted'] };
    } else if (filter === 'past') {
      query.appointmentDate = { $lt: today };
    } else if (filter !== 'all') {
      query.status = filter;
    }

    const appointments = await Appointment.find(query)
      .populate('patientId', 'name email phone gender dateOfBirth')
      .populate('chamberId')
      .populate({
        path: 'chamberId',
        populate: { path: 'hospitalId', select: 'facilityName address' }
      })
      .sort({ appointmentDate: 1, 'timeSlot.startTime': 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Appointment.countDocuments(query);

    res.json({
      success: true,
      data: {
        appointments,
        total,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch appointments',
      error: error.message
    });
  }
};

// Update appointment status
export const updateAppointmentStatus = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { status, notes } = req.body;

    const doctor = await Doctor.findById(req.user._id);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      doctorId: doctor._id
    }).populate('patientId');

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    const oldStatus = appointment.status;
    appointment.status = status;
    if (notes) appointment.notes = notes;
    await appointment.save();

    const io = req.app.get('io');
    
    // Send notification
    let notificationType = 'appointment_status_update';
    let notificationTitle = 'Appointment Status Updated';
    let notificationMessage = `Your appointment status has been updated to ${status}`;

    if (status === 'accepted') {
      notificationType = 'appointment_accepted';
      notificationTitle = 'Appointment Accepted';
      notificationMessage = `Your appointment #${appointment.appointmentNumber} has been accepted`;
    } else if (status === 'rejected') {
      notificationType = 'appointment_rejected';
      notificationTitle = 'Appointment Rejected';
      notificationMessage = `Your appointment #${appointment.appointmentNumber} has been rejected`;
    }

    await createAndSendNotification(
      io,
      appointment.patientId._id,
      notificationType,
      notificationTitle,
      notificationMessage,
      appointment._id,
      'appointment'
    );

    res.json({
      success: true,
      message: 'Appointment status updated successfully',
      data: { appointment }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update appointment status',
      error: error.message
    });
  }
};

// Create prescription
export const createPrescription = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { appointmentId, vitals, diagnosis, medicines, tests, advice, followUpDate } = req.body;

    const doctor = await Doctor.findById(req.user._id);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    // Check appointment
    const appointment = await Appointment.findOne({
      _id: appointmentId,
      doctorId: doctor._id,
      status: { $in: ['accepted', 'completed'] }
    }).populate('patientId');

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found or not authorized'
      });
    }

    // Check if prescription already exists
    let prescription = await Prescription.findOne({ appointmentId });
    
    if (prescription) {
      // Update existing
      prescription.vitals = vitals || prescription.vitals;
      prescription.diagnosis = diagnosis || prescription.diagnosis;
      prescription.medicines = medicines || prescription.medicines;
      prescription.tests = tests || prescription.tests;
      prescription.advice = advice || prescription.advice;
      if (followUpDate) prescription.followUpDate = followUpDate;
      await prescription.save();
    } else {
      // Create new
      prescription = await Prescription.create({
        appointmentId,
        patientId: appointment.patientId._id,
        doctorId: doctor._id,
        vitals,
        diagnosis,
        medicines,
        tests,
        advice,
        followUpDate
      });

      // Link to appointment
      appointment.prescription = prescription._id;
      appointment.status = 'completed';
      await appointment.save();
    }

    // Generate PDF
    const pdfResult = await generatePrescriptionPDF(
      prescription,
      appointment,
      appointment.patientId,
      doctor
    );

    prescription.pdfPath = pdfResult.filepath;
    await prescription.save();

    const io = req.app.get('io');
    
    // Notify patient
    await createAndSendNotification(
      io,
      appointment.patientId._id,
      'prescription_ready',
      'Prescription Ready',
      `Your prescription for appointment #${appointment.appointmentNumber} is ready`,
      appointment._id,
      'prescription'
    );

    res.status(201).json({
      success: true,
      message: 'Prescription created successfully',
      data: { prescription, pdfPath: pdfResult.filepath }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create prescription',
      error: error.message
    });
  }
};

// Get patient history
export const getPatientHistory = async (req, res) => {
  try {
    const { patientId } = req.params;

    const doctor = await Doctor.findById(req.user._id);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const appointments = await Appointment.find({
      doctorId: doctor._id,
      patientId,
      status: 'completed'
    })
      .populate('prescription')
      .populate('patientId', 'name email phone gender dateOfBirth')
      .sort({ appointmentDate: -1 });

    res.json({
      success: true,
      data: { appointments }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch patient history',
      error: error.message
    });
  }
};

// Get earnings report
export const getEarnings = async (req, res) => {
  try {
    const { month, year } = req.query;
    
    const doctor = await Doctor.findById(req.user._id);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const query = { doctorId: doctor._id };
    
    if (month && year) {
      query.month = parseInt(month);
      query.year = parseInt(year);
    } else {
      // Current month
      query.month = moment().month() + 1;
      query.year = moment().year();
    }

    const earnings = await Earning.find(query)
      .populate('appointmentId')
      .sort({ createdAt: -1 });

    const totalEarnings = earnings.reduce((sum, e) => sum + e.netAmount, 0);
    const totalPlatformFee = earnings.reduce((sum, e) => sum + e.platformFee, 0);

    res.json({
      success: true,
      data: {
        earnings,
        summary: {
          totalEarnings,
          totalPlatformFee,
          netEarnings: totalEarnings,
          count: earnings.length
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings',
      error: error.message
    });
  }
};

// Generate serial list
export const generateSerialList = async (req, res) => {
  try {
    const { date } = req.query;

    const doctor = await Doctor.findById(req.user._id);
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const appointmentDate = date ? moment(date).startOf('day').toDate() : moment().startOf('day').toDate();
    const endOfDay = moment(appointmentDate).endOf('day').toDate();

    const appointments = await Appointment.find({
      doctorId: doctor._id,
      appointmentDate: {
        $gte: appointmentDate,
        $lte: endOfDay
      },
      status: { $in: ['pending', 'accepted'] }
    })
      .populate('patientId', 'name gender phone')
      .sort({ 'timeSlot.startTime': 1 });

    const pdfResult = await generateSerialListPDF(doctor._id, appointmentDate, appointments);

    res.json({
      success: true,
      message: 'Serial list generated successfully',
      data: { pdfPath: pdfResult.filepath }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to generate serial list',
      error: error.message
    });
  }
};
