import User from '../models/User.model.js';
import Doctor from '../models/Doctor.model.js';
import Chamber from '../models/Chamber.model.js';
import Hospital from '../models/Hospital.model.js';
import Appointment from '../models/Appointment.model.js';
import Prescription from '../models/Prescription.model.js';
import Test from '../models/Test.model.js';
import Order from '../models/Order.model.js';
import Specialization from '../models/Specialization.model.js';
import Schedule from '../models/Schedule.model.js';
import SerialSettings from '../models/SerialSettings.model.js';
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

// Search doctors with multiple search options
export const searchDoctors = async (req, res) => {
  try {
    const { 
      hospitalName,
      doctorName,
      department,
      specialization,
      page = 1,
      limit = 20
    } = req.query;

    let doctorIds = new Set();
    let hospitalIds = [];

    // Step 1: Find hospitals if hospitalName is provided
    if (hospitalName) {
      const hospitals = await Hospital.find({
        name: { $regex: hospitalName, $options: 'i' },
        status: 'approved'
      }).select('_id name departments associatedDoctors');
      
      hospitalIds = hospitals.map(h => h._id);

      if (hospitalIds.length === 0) {
        // No hospitals found, return empty results
        return res.json({
          success: true,
          data: {
            doctors: [],
            total: 0,
            page: parseInt(page),
            limit: parseInt(limit),
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              total: 0,
              pages: 0
            }
          }
        });
      }

      // Get doctors from hospital associations and chambers
      // From associatedDoctors
      hospitals.forEach(hospital => {
        if (hospital.associatedDoctors && hospital.associatedDoctors.length > 0) {
          hospital.associatedDoctors.forEach(assoc => {
            if (assoc.doctor) {
              doctorIds.add(assoc.doctor.toString());
            }
          });
        }
      });

      // From chambers
      const chambers = await Chamber.find({ 
        hospitalId: { $in: hospitalIds },
        isActive: true
      }).select('doctorId');
      
      chambers.forEach(c => {
        if (c.doctorId) {
          doctorIds.add(c.doctorId.toString());
        }
      });
    }

    // Step 2: Filter by department if provided
    if (department) {
      const deptDoctorIds = new Set();
      
      if (hospitalIds.length > 0) {
        // Search within specific hospitals
        const hospitalsWithDept = await Hospital.find({
          _id: { $in: hospitalIds },
          status: 'approved'
        }).populate('associatedDoctors.doctor');

        hospitalsWithDept.forEach(hospital => {
          // Check if hospital has this department
          const hasDept = hospital.departments && hospital.departments.some(dept => 
            dept.toLowerCase().includes(department.toLowerCase())
          );

          if (hasDept) {
            // Add all doctors from this hospital
            if (hospital.associatedDoctors) {
              hospital.associatedDoctors.forEach(assoc => {
                if (assoc.doctor && assoc.doctor._id) {
                  deptDoctorIds.add(assoc.doctor._id.toString());
                }
              });
            }
          } else {
            // Check individual doctor departments
            if (hospital.associatedDoctors) {
              hospital.associatedDoctors.forEach(assoc => {
                if (assoc.department && 
                    assoc.department.toLowerCase().includes(department.toLowerCase()) &&
                    assoc.doctor && assoc.doctor._id) {
                  deptDoctorIds.add(assoc.doctor._id.toString());
                }
              });
            }
          }
        });

        // Also check chambers
        const chambersWithDept = await Chamber.find({
          hospitalId: { $in: hospitalIds },
          isActive: true
        }).populate('doctorId');
        
        chambersWithDept.forEach(c => {
          if (c.doctorId && c.doctorId._id) {
            deptDoctorIds.add(c.doctorId._id.toString());
          }
        });
      } else {
        // Search all hospitals by department
        const hospitalsWithDept = await Hospital.find({
          status: 'approved',
          $or: [
            { departments: { $regex: department, $options: 'i' } },
            { 'associatedDoctors.department': { $regex: department, $options: 'i' } }
          ]
        }).populate('associatedDoctors.doctor');

        hospitalsWithDept.forEach(hospital => {
          const hasDept = hospital.departments && hospital.departments.some(dept => 
            dept.toLowerCase().includes(department.toLowerCase())
          );

          if (hasDept) {
            if (hospital.associatedDoctors) {
              hospital.associatedDoctors.forEach(assoc => {
                if (assoc.doctor && assoc.doctor._id) {
                  deptDoctorIds.add(assoc.doctor._id.toString());
                }
              });
            }
          } else {
            if (hospital.associatedDoctors) {
              hospital.associatedDoctors.forEach(assoc => {
                if (assoc.department && 
                    assoc.department.toLowerCase().includes(department.toLowerCase()) &&
                    assoc.doctor && assoc.doctor._id) {
                  deptDoctorIds.add(assoc.doctor._id.toString());
                }
              });
            }
          }
        });
      }

      // Intersect with existing doctorIds if hospital was specified
      if (doctorIds.size > 0) {
        const intersection = new Set([...doctorIds].filter(id => deptDoctorIds.has(id)));
        doctorIds = intersection;
      } else {
        doctorIds = deptDoctorIds;
      }
    }

    // Step 3: Build doctor query
    const doctorQuery = {
      status: 'approved' // Only show approved doctors
    };

    // Filter by doctor IDs if we have any
    if (doctorIds.size > 0) {
      doctorQuery._id = { $in: Array.from(doctorIds) };
    }

    // Filter by doctor name
    if (doctorName) {
      doctorQuery.name = { $regex: doctorName, $options: 'i' };
    }

    // Filter by specialization
    if (specialization) {
      doctorQuery.specialization = { $in: [specialization] };
    }

    // Step 4: Find doctors matching the query
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const doctors = await Doctor.find(doctorQuery)
      .select('-password') // Exclude password
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Doctor.countDocuments(doctorQuery);

    // Step 5: Enrich doctor data with hospital and chamber information
    const enrichedDoctors = await Promise.all(doctors.map(async (doctor) => {
      // Get hospital associations
      const hospitals = await Hospital.find({
        status: 'approved',
        $or: [
          { 'associatedDoctors.doctor': doctor._id },
          { _id: doctor.hospitalId }
        ]
      }).select('name address departments associatedDoctors logo');

      // Get chambers for this doctor
      const chambers = await Chamber.find({ 
        doctorId: doctor._id,
        isActive: true
      }).populate('hospitalId', 'name address logo');

      // Get department info from hospital associations
      const hospitalInfo = hospitals.map(hospital => {
        const assoc = hospital.associatedDoctors.find(
          ad => ad.doctor && ad.doctor.toString() === doctor._id.toString()
        );
        return {
          hospitalId: hospital._id,
          hospitalName: hospital.name,
          address: hospital.address,
          logo: hospital.logo,
          department: assoc ? assoc.department : null,
          designation: assoc ? assoc.designation : null
        };
      });

      return {
        ...doctor.toObject(),
        hospitals: hospitalInfo,
        chambers: chambers.map(c => ({
          chamberId: c._id,
          name: c.name,
          address: c.address,
          consultationFee: c.consultationFee,
          followUpFee: c.followUpFee,
          hospital: c.hospitalId ? {
            hospitalId: c.hospitalId._id,
            name: c.hospitalId.name,
            address: c.hospitalId.address,
            logo: c.hospitalId.logo
          } : null
        }))
      };
    }));

    res.json({
      success: true,
      data: {
        doctors: enrichedDoctors,
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
    console.error('Search doctors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search doctors',
      error: error.message
    });
  }
};

// Get doctor details with complete information
export const getDoctorDetails = async (req, res) => {
  try {
    const { doctorId } = req.params;

    const doctor = await Doctor.findById(doctorId)
      .select('-password'); // Exclude password

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Only show approved doctors to public
    if (doctor.status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Doctor profile is not available'
      });
    }

    // Get hospital associations with department info
    const hospitals = await Hospital.find({
      status: 'approved',
      $or: [
        { 'associatedDoctors.doctor': doctor._id },
        { _id: doctor.hospitalId }
      ]
    }).select('name address departments associatedDoctors logo contactInfo');

    // Get chambers for this doctor with hospital info
    const chambers = await Chamber.find({ 
      doctorId: doctor._id,
      isActive: true
    }).populate('hospitalId', 'name address logo contactInfo');

    // Get schedules for each chamber
    const schedules = await Schedule.find({
      doctorId: doctor._id,
      isActive: true
    }).populate('chamberId', 'name hospitalId');

    // Build hospital info with department
    const hospitalInfo = hospitals.map(hospital => {
      const assoc = hospital.associatedDoctors.find(
        ad => ad.doctor && ad.doctor.toString() === doctor._id.toString()
      );
      return {
        hospitalId: hospital._id,
        hospitalName: hospital.name,
        address: hospital.address,
        logo: hospital.logo,
        contactInfo: hospital.contactInfo,
        departments: hospital.departments,
        department: assoc ? assoc.department : null,
        designation: assoc ? assoc.designation : null,
        joinedAt: assoc ? assoc.joinedAt : null
      };
    });

    // Build chamber info with fees and schedule
    const chamberInfo = chambers.map(chamber => {
      const chamberSchedules = schedules.filter(
        s => s.chamberId && s.chamberId._id.toString() === chamber._id.toString()
      );
      
      return {
        chamberId: chamber._id,
        name: chamber.name,
        address: chamber.address,
        consultationFee: chamber.consultationFee,
        followUpFee: chamber.followUpFee,
        contactInfo: chamber.contactInfo,
        hospital: chamber.hospitalId ? {
          hospitalId: chamber.hospitalId._id,
          name: chamber.hospitalId.name,
          address: chamber.hospitalId.address,
          logo: chamber.hospitalId.logo,
          contactInfo: chamber.hospitalId.contactInfo
        } : null,
        schedules: chamberSchedules.map(s => ({
          scheduleId: s._id,
          dayOfWeek: s.dayOfWeek,
          timeSlots: s.timeSlots,
          isActive: s.isActive
        }))
      };
    });

    // Build complete doctor response
    const doctorDetails = {
      doctorId: doctor._id,
      name: doctor.name,
      email: doctor.email,
      phone: doctor.phone,
      bio: doctor.bio,
      description: doctor.description,
      profilePhotoUrl: doctor.profilePhotoUrl,
      specialization: doctor.specialization,
      qualifications: doctor.qualifications,
      experienceYears: doctor.experienceYears,
      medicalLicenseNumber: doctor.medicalLicenseNumber,
      consultationFee: doctor.consultationFee,
      followUpFee: doctor.followUpFee,
      reportFee: doctor.reportFee,
      visitingDays: doctor.visitingDays,
      chamber: doctor.chamber,
      emergencyAvailability: doctor.emergencyAvailability,
      socialLinks: doctor.socialLinks,
      rating: doctor.rating,
      holidays: doctor.holidays,
      hospitals: hospitalInfo,
      chambers: chamberInfo,
      createdAt: doctor.createdAt,
      updatedAt: doctor.updatedAt
    };

    res.json({
      success: true,
      data: {
        doctor: doctorDetails
      }
    });
  } catch (error) {
    console.error('Get doctor details error:', error);
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

// Get available serials for a doctor
export const getAvailableSerials = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date is required (format: YYYY-MM-DD)'
      });
    }

    const appointmentDate = moment(date).startOf('day').toDate();
    const dayOfWeek = moment(date).day(); // 0 = Sunday, 6 = Saturday

    // Get doctor
    const doctor = await Doctor.findById(doctorId);
    if (!doctor || doctor.status !== 'approved') {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found or not available'
      });
    }

    // Check if doctor is associated with a hospital
    const hospital = doctor.hospitalId 
      ? await Hospital.findById(doctor.hospitalId)
      : null;

    // Get serial settings
    let serialSettings;
    if (hospital && hospital.status === 'approved') {
      // Hospital-based doctor
      serialSettings = await SerialSettings.findOne({
        doctorId,
        hospitalId: hospital._id,
        isActive: true
      });
    } else {
      // Individual doctor
      serialSettings = await SerialSettings.findOne({
        doctorId,
        hospitalId: null,
        isActive: true
      });
    }

    if (!serialSettings) {
      return res.status(404).json({
        success: false,
        message: 'Serial settings not found for this doctor'
      });
    }

    // Check if serials are available on this day
    if (serialSettings.availableDays && serialSettings.availableDays.length > 0) {
      if (!serialSettings.availableDays.includes(dayOfWeek)) {
        return res.json({
          success: true,
          data: {
            doctor: {
              id: doctor._id,
              name: doctor.name
            },
            date: date,
            availableSerials: [],
            totalSerials: serialSettings.totalSerialsPerDay,
            message: 'No serials available on this day'
          }
        });
      }
    }

    // Get booked serials for this date
    const bookedAppointments = await Appointment.find({
      doctorId,
      appointmentDate: {
        $gte: moment(date).startOf('day').toDate(),
        $lte: moment(date).endOf('day').toDate()
      },
      status: { $in: ['pending', 'accepted'] }
    }).select('timeSlot');

    // Extract booked serial times
    const bookedTimes = bookedAppointments.map(apt => apt.timeSlot?.startTime).filter(Boolean);

    // Generate available serials (only even numbers)
    const totalSerials = serialSettings.totalSerialsPerDay;
    const availableSerials = [];
    
    // Calculate time slot duration
    const [startHour, startMin] = serialSettings.serialTimeRange.startTime.split(':').map(Number);
    const [endHour, endMin] = serialSettings.serialTimeRange.endTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const totalMinutes = endMinutes - startMinutes;
    const slotDuration = Math.floor(totalMinutes / totalSerials);

    for (let i = 1; i <= totalSerials; i++) {
      // Only include even-numbered serials
      if (i % 2 === 0) {
        const slotMinutes = startMinutes + (i - 1) * slotDuration;
        const slotHour = Math.floor(slotMinutes / 60);
        const slotMin = slotMinutes % 60;
        const timeString = `${String(slotHour).padStart(2, '0')}:${String(slotMin).padStart(2, '0')}`;
        
        const endSlotMinutes = slotMinutes + slotDuration;
        const endSlotHour = Math.floor(endSlotMinutes / 60);
        const endSlotMin = endSlotMinutes % 60;
        const endTimeString = `${String(endSlotHour).padStart(2, '0')}:${String(endSlotMin).padStart(2, '0')}`;

        // Check if this time slot is already booked
        const isBooked = bookedTimes.some(bt => bt === timeString);

        if (!isBooked) {
          availableSerials.push({
            serialNumber: i,
            time: timeString,
            endTime: endTimeString,
            available: true
          });
        }
      }
    }

    res.json({
      success: true,
      data: {
        doctor: {
          id: doctor._id,
          name: doctor.name,
          profilePhotoUrl: doctor.profilePhotoUrl,
          specialization: doctor.specialization,
          qualifications: doctor.qualifications
        },
        hospital: hospital ? {
          id: hospital._id,
          name: hospital.name
        } : null,
        date: date,
        availableSerials,
        totalSerials: serialSettings.totalSerialsPerDay,
        appointmentPrice: serialSettings.appointmentPrice,
        timeRange: serialSettings.serialTimeRange,
        bookedCount: bookedAppointments.length,
        availableCount: availableSerials.length
      }
    });
  } catch (error) {
    console.error('Get available serials error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get available serials',
      error: error.message
    });
  }
};

// Book a serial (appointment)
export const bookSerial = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { doctorId, serialNumber, date } = req.body;

    if (!serialNumber || serialNumber % 2 !== 0) {
      return res.status(400).json({
        success: false,
        message: 'Only even-numbered serials can be booked online'
      });
    }

    const appointmentDate = moment(date).startOf('day').toDate();
    const dayOfWeek = moment(date).day();

    // Get doctor
    const doctor = await Doctor.findById(doctorId);
    if (!doctor || doctor.status !== 'approved') {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found or not available'
      });
    }

    // Check if doctor is associated with a hospital
    const hospital = doctor.hospitalId 
      ? await Hospital.findById(doctor.hospitalId).populate('admins', 'email name phone')
      : null;

    // Get serial settings
    let serialSettings;
    if (hospital && hospital.status === 'approved') {
      serialSettings = await SerialSettings.findOne({
        doctorId,
        hospitalId: hospital._id,
        isActive: true
      });
    } else {
      serialSettings = await SerialSettings.findOne({
        doctorId,
        hospitalId: null,
        isActive: true
      });
    }

    if (!serialSettings) {
      return res.status(404).json({
        success: false,
        message: 'Serial settings not found for this doctor'
      });
    }

    // Check if serials are available on this day
    if (serialSettings.availableDays && serialSettings.availableDays.length > 0) {
      if (!serialSettings.availableDays.includes(dayOfWeek)) {
        return res.status(400).json({
          success: false,
          message: 'Serials are not available on this day'
        });
      }
    }

    // Check if serial number is valid
    if (serialNumber < 1 || serialNumber > serialSettings.totalSerialsPerDay) {
      return res.status(400).json({
        success: false,
        message: 'Invalid serial number'
      });
    }

    // Calculate time slot for this serial number
    const [startHour, startMin] = serialSettings.serialTimeRange.startTime.split(':').map(Number);
    const [endHour, endMin] = serialSettings.serialTimeRange.endTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const totalMinutes = endMinutes - startMinutes;
    const slotDuration = Math.floor(totalMinutes / serialSettings.totalSerialsPerDay);
    
    const slotMinutes = startMinutes + (serialNumber - 1) * slotDuration;
    const slotHour = Math.floor(slotMinutes / 60);
    const slotMin = slotMinutes % 60;
    const startTime = `${String(slotHour).padStart(2, '0')}:${String(slotMin).padStart(2, '0')}`;
    
    const endSlotMinutes = slotMinutes + slotDuration;
    const endSlotHour = Math.floor(endSlotMinutes / 60);
    const endSlotMin = endSlotMinutes % 60;
    const endTime = `${String(endSlotHour).padStart(2, '0')}:${String(endSlotMin).padStart(2, '0')}`;

    // Check if this time slot is already booked
    const existingAppointment = await Appointment.findOne({
      doctorId,
      appointmentDate: {
        $gte: moment(date).startOf('day').toDate(),
        $lte: moment(date).endOf('day').toDate()
      },
      'timeSlot.startTime': startTime,
      status: { $in: ['pending', 'accepted'] }
    });

    if (existingAppointment) {
      return res.status(400).json({
        success: false,
        message: 'This serial is already booked'
      });
    }

    // Get or create a chamber for the doctor
    let chamber = await Chamber.findOne({ doctorId, isActive: true });
    if (!chamber) {
      // Create a default chamber if none exists
      chamber = await Chamber.create({
        doctorId,
        hospitalId: hospital ? hospital._id : null,
        name: `${doctor.name}'s Chamber`,
        consultationFee: serialSettings.appointmentPrice,
        followUpFee: serialSettings.appointmentPrice,
        isActive: true
      });
    }

    // Generate appointment number
    const appointmentNumber = `SR-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Create appointment
    const appointment = await Appointment.create({
      patientId: req.user._id,
      doctorId,
      chamberId: chamber._id,
      appointmentDate,
      timeSlot: {
        startTime,
        endTime,
        sessionDuration: slotDuration
      },
      appointmentNumber,
      consultationType: 'new',
      fee: serialSettings.appointmentPrice,
      status: 'pending',
      paymentStatus: 'pending',
      notes: `Serial #${serialNumber}`
    });

    const io = req.app.get('io');

    // Get patient information
    const patient = await User.findById(req.user._id);
    const patientInfo = {
      name: patient.name,
      email: patient.email,
      phone: patient.phone,
      appointmentNumber: appointmentNumber,
      serialNumber: serialNumber,
      date: moment(date).format('YYYY-MM-DD'),
      time: startTime,
      doctorName: doctor.name
    };

    // Send notification to doctor
    if (doctor.userId) {
      await createAndSendNotification(
        io,
        doctor.userId,
        'appointment_created',
        'New Serial Booking',
        `You have a new serial booking (Serial #${serialNumber}) from ${patient.name}`,
        appointment._id,
        'appointment'
      );
    }

    // Send patient information to hospital admin or doctor
    if (hospital && hospital.admins && hospital.admins.length > 0) {
      // Send to all hospital admins
      for (const admin of hospital.admins) {
        if (admin._id) {
          await createAndSendNotification(
            io,
            admin._id,
            'appointment_created',
            'New Serial Booking',
            `New serial booking for Dr. ${doctor.name}: ${patient.name} (${patient.email}, ${patient.phone}) - Serial #${serialNumber}`,
            appointment._id,
            'appointment'
          );
        }
      }
    } else {
      // Send to doctor directly (already sent above, but include patient info)
      if (doctor.userId) {
        await createAndSendNotification(
          io,
          doctor.userId,
          'appointment_created',
          'New Serial Booking - Patient Info',
          `Patient: ${patient.name}, Email: ${patient.email}, Phone: ${patient.phone}, Serial #${serialNumber}`,
          appointment._id,
          'appointment'
        );
      }
    }

    // Send notification to patient
    await createAndSendNotification(
      io,
      req.user._id,
      'appointment_created',
      'Serial Booked Successfully',
      `Your serial #${serialNumber} is booked for ${moment(date).format('MMMM DD, YYYY')} at ${startTime}`,
      appointment._id,
      'appointment'
    );

    res.status(201).json({
      success: true,
      message: 'Serial booked successfully',
      data: {
        appointment: {
          ...appointment.toObject(),
          serialNumber,
          patientInfo
        },
        doctor: {
          id: doctor._id,
          name: doctor.name,
          specialization: doctor.specialization
        },
        hospital: hospital ? {
          id: hospital._id,
          name: hospital.name
        } : null
      }
    });
  } catch (error) {
    console.error('Book serial error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to book serial',
      error: error.message
    });
  }
};


