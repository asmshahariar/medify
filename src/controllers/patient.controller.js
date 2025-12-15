import User from '../models/User.model.js';
import Doctor from '../models/Doctor.model.js';
import Chamber from '../models/Chamber.model.js';
import Hospital from '../models/Hospital.model.js';
import Appointment from '../models/Appointment.model.js';
import Prescription from '../models/Prescription.model.js';
import Test from '../models/Test.model.js';
import Order from '../models/Order.model.js';
import Specialization from '../models/Specialization.model.js';
import { generateAvailableSlots, lockSlot } from '../utils/slotGenerator.util.js';
import { createAndSendNotification } from '../services/notification.service.js';
import { generatePrescriptionPDF } from '../utils/pdfGenerator.util.js';
import moment from 'moment';
import { validationResult } from 'express-validator';

// Get patient profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: error.message
    });
  }
};

// Update patient profile
export const updateProfile = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { name, dateOfBirth, gender, address } = req.body;
    
    const updateData = {};
    if (name) updateData.name = name;
    if (dateOfBirth) updateData.dateOfBirth = dateOfBirth;
    if (gender) updateData.gender = gender;
    if (address) updateData.address = address;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
};

// Search doctors
export const searchDoctors = async (req, res) => {
  try {
    const { 
      specializationId, 
      city, 
      hospitalId, 
      doctorName,
      latitude,
      longitude,
      page = 1,
      limit = 10
    } = req.query;

    const query = {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    if (specializationId) {
      query.specialization = specializationId;
    }

    if (hospitalId) {
      // Find chambers for this hospital
      const chambers = await Chamber.find({ hospitalId });
      const doctorIds = chambers.map(c => c.doctorId);
      if (doctorIds.length > 0) {
        query._id = { $in: doctorIds };
      } else {
        return res.json({
          success: true,
          data: { doctors: [], total: 0, page, limit }
        });
      }
    }

    if (city) {
      // Find hospitals in city
      const hospitals = await Hospital.find({ 
        'address.city': new RegExp(city, 'i'),
        status: 'active'
      });
      const hospitalIds = hospitals.map(h => h._id);
      
      const chambers = await Chamber.find({ hospitalId: { $in: hospitalIds } });
      const doctorIds = chambers.map(c => c.doctorId);
      
      if (query._id) {
        query._id = { $in: [...(Array.isArray(query._id.$in) ? query._id.$in : [query._id.$in]), ...doctorIds] };
      } else if (doctorIds.length > 0) {
        query._id = { $in: doctorIds };
      }
    }

    if (doctorName) {
      const users = await User.find({ 
        name: new RegExp(doctorName, 'i'),
        role: 'doctor'
      });
      const userIds = users.map(u => u._id);
      const doctors = await Doctor.find({ userId: { $in: userIds } });
      const doctorIds = doctors.map(d => d._id);
      
      if (query._id) {
        query._id = { $in: [...(Array.isArray(query._id.$in) ? query._id.$in : [query._id.$in]), ...doctorIds] };
      } else if (doctorIds.length > 0) {
        query._id = { $in: doctorIds };
      }
    }

    // Status filter
    query.status = 'active';

    const doctors = await Doctor.find(query)
      .populate('userId', 'name email phone profileImage')
      .populate('specialization')
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Doctor.countDocuments(query);

    // Get chambers for each doctor
    const doctorsWithChambers = await Promise.all(doctors.map(async (doctor) => {
      const chambers = await Chamber.find({ doctorId: doctor._id })
        .populate('hospitalId', 'facilityName address');
      
      return {
        ...doctor.toObject(),
        chambers
      };
    }));

    res.json({
      success: true,
      data: {
        doctors: doctorsWithChambers,
        total,
        page: parseInt(page),
        limit: parseInt(limit)
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

// Get doctor details
export const getDoctorDetails = async (req, res) => {
  try {
    const { doctorId } = req.params;

    const doctor = await Doctor.findById(doctorId)
      .populate('userId', 'name email phone profileImage')
      .populate('specialization');

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    const chambers = await Chamber.find({ doctorId })
      .populate('hospitalId', 'facilityName address contactInfo');

    res.json({
      success: true,
      data: {
        doctor: {
          ...doctor.toObject(),
          chambers
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch doctor details',
      error: error.message
    });
  }
};

// Get available slots
export const getAvailableSlots = async (req, res) => {
  try {
    const { doctorId, chamberId, date } = req.query;

    if (!doctorId || !chamberId || !date) {
      return res.status(400).json({
        success: false,
        message: 'Doctor ID, Chamber ID, and Date are required'
      });
    }

    const slots = await generateAvailableSlots(doctorId, chamberId, date);

    res.json({
      success: true,
      data: { slots }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available slots',
      error: error.message
    });
  }
};

// Book appointment
export const bookAppointment = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { doctorId, chamberId, appointmentDate, startTime, endTime, reason, consultationType } = req.body;

    // Check slot availability
    const isAvailable = await lockSlot(doctorId, chamberId, appointmentDate, startTime, endTime);
    
    if (!isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'This slot is no longer available'
      });
    }

    // Get chamber to get fee
    const chamber = await Chamber.findById(chamberId);
    if (!chamber) {
      return res.status(404).json({
        success: false,
        message: 'Chamber not found'
      });
    }

    const fee = consultationType === 'follow_up' ? chamber.followUpFee : chamber.consultationFee;

    // Generate appointment number
    const appointmentNumber = `APT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create appointment
    const appointment = await Appointment.create({
      patientId: req.user._id,
      doctorId,
      chamberId,
      appointmentDate,
      timeSlot: {
        startTime,
        endTime,
        sessionDuration: 15
      },
      appointmentNumber,
      consultationType: consultationType || 'new',
      fee,
      reason,
      status: 'pending'
    });

    const io = req.app.get('io');
    
    // Send notification to doctor
    const doctor = await Doctor.findById(doctorId).populate('userId');
    if (doctor && doctor.userId) {
      await createAndSendNotification(
        io,
        doctor.userId._id,
        'appointment_created',
        'New Appointment Request',
        `You have a new appointment request from ${req.user.name}`,
        appointment._id,
        'appointment'
      );
    }

    // Send notification to patient
    await createAndSendNotification(
      io,
      req.user._id,
      'appointment_created',
      'Appointment Booked',
      `Your appointment is booked. Appointment #${appointmentNumber}`,
      appointment._id,
      'appointment'
    );

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      data: { appointment }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to book appointment',
      error: error.message
    });
  }
};

// Get patient appointments
export const getMyAppointments = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { patientId: req.user._id };
    if (status) {
      query.status = status;
    }

    const appointments = await Appointment.find(query)
      .populate('doctorId')
      .populate({
        path: 'doctorId',
        populate: { path: 'userId', select: 'name profileImage' }
      })
      .populate('chamberId')
      .populate({
        path: 'chamberId',
        populate: { path: 'hospitalId', select: 'facilityName address' }
      })
      .sort({ appointmentDate: -1, createdAt: -1 })
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

// Cancel appointment
export const cancelAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { reason } = req.body;

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      patientId: req.user._id
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    if (['cancelled', 'completed', 'no_show'].includes(appointment.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel this appointment'
      });
    }

    appointment.status = 'cancelled';
    appointment.cancelledBy = 'patient';
    appointment.cancellationReason = reason;
    appointment.cancelledAt = new Date();
    await appointment.save();

    const io = req.app.get('io');
    
    // Notify doctor
    const doctor = await Doctor.findById(appointment.doctorId).populate('userId');
    if (doctor && doctor.userId) {
      await createAndSendNotification(
        io,
        doctor.userId._id,
        'appointment_cancelled',
        'Appointment Cancelled',
        `Appointment #${appointment.appointmentNumber} has been cancelled by patient`,
        appointment._id,
        'appointment'
      );
    }

    res.json({
      success: true,
      message: 'Appointment cancelled successfully',
      data: { appointment }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to cancel appointment',
      error: error.message
    });
  }
};

// Get medical records
export const getMedicalRecords = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const appointments = await Appointment.find({
      patientId: req.user._id,
      status: 'completed'
    })
      .populate('doctorId')
      .populate({
        path: 'doctorId',
        populate: { path: 'userId', select: 'name' }
      })
      .populate('prescription')
      .sort({ appointmentDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Appointment.countDocuments({
      patientId: req.user._id,
      status: 'completed'
    });

    res.json({
      success: true,
      data: {
        records: appointments,
        total,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch medical records',
      error: error.message
    });
  }
};

// Download prescription
export const downloadPrescription = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      patientId: req.user._id,
      status: 'completed'
    }).populate('prescription');

    if (!appointment || !appointment.prescription) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    const prescription = await Prescription.findById(appointment.prescription)
      .populate('patientId')
      .populate({
        path: 'doctorId',
        populate: { path: 'userId', select: 'name' }
      });

    if (!prescription.pdfPath) {
      // Generate PDF if not exists
      const pdfResult = await generatePrescriptionPDF(
        prescription,
        appointment,
        prescription.patientId,
        prescription.doctorId
      );
      
      prescription.pdfPath = pdfResult.filepath;
      await prescription.save();
    }

    res.json({
      success: true,
      data: {
        pdfPath: prescription.pdfPath
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch prescription',
      error: error.message
    });
  }
};

// Get diagnostic tests
export const getDiagnosticTests = async (req, res) => {
  try {
    const { hospitalId, category, search, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { isActive: true };
    if (hospitalId) query.hospitalId = hospitalId;
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { name: new RegExp(search, 'i') },
        { code: new RegExp(search, 'i') }
      ];
    }

    const tests = await Test.find(query)
      .populate('hospitalId', 'facilityName address')
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Test.countDocuments(query);

    res.json({
      success: true,
      data: {
        tests,
        total,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch diagnostic tests',
      error: error.message
    });
  }
};

// Create diagnostic order
export const createOrder = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { hospitalId, tests, collectionType, appointmentDate, appointmentTime, address, discount = 0 } = req.body;

    // Calculate total
    const testDetails = await Test.find({
      _id: { $in: tests.map(t => t.testId) },
      hospitalId
    });

    let totalAmount = 0;
    const orderTests = tests.map(testOrder => {
      const test = testDetails.find(t => t._id.toString() === testOrder.testId.toString());
      if (!test) {
        throw new Error(`Test ${testOrder.testId} not found`);
      }
      const subtotal = test.price * (testOrder.quantity || 1);
      totalAmount += subtotal;
      return {
        testId: test._id,
        testName: test.name,
        price: test.price,
        quantity: testOrder.quantity || 1
      };
    });

    const finalAmount = totalAmount - discount;

    // Generate order number
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const order = await Order.create({
      patientId: req.user._id,
      hospitalId,
      orderNumber,
      tests: orderTests,
      totalAmount,
      discount,
      finalAmount,
      collectionType,
      appointmentDate: collectionType === 'home_collection' ? appointmentDate : undefined,
      appointmentTime: collectionType === 'home_collection' ? appointmentTime : undefined,
      address: collectionType === 'home_collection' ? address : undefined,
      status: 'pending'
    });

    const io = req.app.get('io');
    
    // Notify patient
    await createAndSendNotification(
      io,
      req.user._id,
      'order_created',
      'Order Placed',
      `Your diagnostic order #${orderNumber} has been placed successfully`,
      order._id,
      'order'
    );

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      data: { order }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message
    });
  }
};

// Get patient orders
export const getMyOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { patientId: req.user._id };
    if (status) query.status = status;

    const orders = await Order.find(query)
      .populate('hospitalId', 'facilityName address contactInfo')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      data: {
        orders,
        total,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
};

// Get specializations
export const getSpecializations = async (req, res) => {
  try {
    const specializations = await Specialization.find({ isActive: true })
      .sort({ name: 1 });

    res.json({
      success: true,
      data: { specializations }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch specializations',
      error: error.message
    });
  }
};

