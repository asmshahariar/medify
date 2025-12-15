import User from '../models/User.model.js';
import Doctor from '../models/Doctor.model.js';
import Hospital from '../models/Hospital.model.js';
import Appointment from '../models/Appointment.model.js';
import Order from '../models/Order.model.js';
import Banner from '../models/Banner.model.js';
import Notification from '../models/Notification.model.js';
import { createAndSendNotification } from '../services/notification.service.js';
import { validationResult } from 'express-validator';
import moment from 'moment';
import createCsvWriter from 'csv-writer';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dashboard analytics
export const getDashboardStats = async (req, res) => {
  try {
    const today = moment().startOf('day').toDate();
    const thisMonth = moment().startOf('month').toDate();
    const thisYear = moment().startOf('year').toDate();

    // User stats
    const totalUsers = await User.countDocuments();
    const totalPatients = await User.countDocuments({ role: 'patient' });
    const totalDoctors = await Doctor.countDocuments({ status: 'approved' });
    const totalHospitals = await Hospital.countDocuments({ status: 'approved' });
    const pendingDoctors = await Doctor.countDocuments({ 
      status: { $in: ['pending_super_admin', 'pending_hospital_and_super_admin'] } 
    });
    const pendingHospitals = await Hospital.countDocuments({ status: 'pending_super_admin' });

    // Appointment stats
    const totalAppointments = await Appointment.countDocuments();
    const todayAppointments = await Appointment.countDocuments({
      appointmentDate: { $gte: today }
    });
    const monthlyAppointments = await Appointment.countDocuments({
      createdAt: { $gte: thisMonth }
    });

    // Order stats
    const totalOrders = await Order.countDocuments();
    const monthlyOrders = await Order.countDocuments({
      createdAt: { $gte: thisMonth }
    });

    // Revenue (if applicable)
    const monthlyRevenue = await Appointment.aggregate([
      {
        $match: {
          createdAt: { $gte: thisMonth },
          paymentStatus: 'paid'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$fee' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          patients: totalPatients,
          doctors: totalDoctors,
          hospitals: totalHospitals,
          pendingDoctors,
          pendingHospitals
        },
        appointments: {
          total: totalAppointments,
          today: todayAppointments,
          thisMonth: monthlyAppointments
        },
        orders: {
          total: totalOrders,
          thisMonth: monthlyOrders
        },
        revenue: {
          thisMonth: monthlyRevenue[0]?.total || 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message
    });
  }
};

// Doctor verification
export const getPendingDoctors = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const doctors = await Doctor.find({ status: 'pending_verification' })
      .populate('userId', 'name email phone')
      .populate('specialization')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Doctor.countDocuments({ status: 'pending_verification' });

    res.json({
      success: true,
      data: {
        doctors,
        total,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending doctors',
      error: error.message
    });
  }
};

export const verifyDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { action, rejectionReason } = req.body;

    const doctor = await Doctor.findById(doctorId).populate('userId');
    
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    if (action === 'approve') {
      doctor.status = 'active';
      doctor.verifiedAt = new Date();
      doctor.verifiedBy = req.user._id;
      doctor.rejectionReason = undefined;
      
      const io = req.app.get('io');
      
      if (doctor.userId) {
        await createAndSendNotification(
          io,
          doctor.userId._id,
          'verification_approved',
          'Account Verified',
          'Your doctor account has been verified and activated',
          doctor._id,
          'user'
        );
      }
    } else if (action === 'reject') {
      doctor.status = 'rejected';
      doctor.rejectionReason = rejectionReason || 'Verification failed';
      doctor.verifiedBy = req.user._id;
      
      const io = req.app.get('io');
      
      if (doctor.userId) {
        await createAndSendNotification(
          io,
          doctor.userId._id,
          'verification_rejected',
          'Verification Rejected',
          `Your verification was rejected: ${doctor.rejectionReason}`,
          doctor._id,
          'user'
        );
      }
    }

    await doctor.save();

    res.json({
      success: true,
      message: `Doctor ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      data: { doctor }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to verify doctor',
      error: error.message
    });
  }
};

// Hospital verification
export const getPendingHospitals = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const hospitals = await Hospital.find({ status: 'pending_verification' })
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Hospital.countDocuments({ status: 'pending_verification' });

    res.json({
      success: true,
      data: {
        hospitals,
        total,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending hospitals',
      error: error.message
    });
  }
};

export const verifyHospital = async (req, res) => {
  try {
    const { hospitalId } = req.params;
    const { action, rejectionReason } = req.body;

    const hospital = await Hospital.findById(hospitalId).populate('userId');
    
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    if (action === 'approve') {
      hospital.status = 'active';
      hospital.verifiedAt = new Date();
      hospital.verifiedBy = req.user._id;
      hospital.rejectionReason = undefined;
      
      const io = req.app.get('io');
      
      if (hospital.userId) {
        await createAndSendNotification(
          io,
          hospital.userId._id,
          'verification_approved',
          'Account Verified',
          'Your hospital account has been verified and activated',
          hospital._id,
          'user'
        );
      }
    } else if (action === 'reject') {
      hospital.status = 'rejected';
      hospital.rejectionReason = rejectionReason || 'Verification failed';
      hospital.verifiedBy = req.user._id;
      
      const io = req.app.get('io');
      
      if (hospital.userId) {
        await createAndSendNotification(
          io,
          hospital.userId._id,
          'verification_rejected',
          'Verification Rejected',
          `Your verification was rejected: ${hospital.rejectionReason}`,
          hospital._id,
          'user'
        );
      }
    }

    await hospital.save();

    res.json({
      success: true,
      message: `Hospital ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      data: { hospital }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to verify hospital',
      error: error.message
    });
  }
};

// Banner management
export const createBanner = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Banner image is required'
      });
    }

    const { title, link, order, startDate, endDate } = req.body;

    const banner = await Banner.create({
      title,
      image: req.file.cloudinaryUrl || req.file.path,
      link,
      order: order || 0,
      startDate: startDate || new Date(),
      endDate,
      createdBy: req.user._id
    });

    res.status(201).json({
      success: true,
      message: 'Banner created successfully',
      data: { banner }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create banner',
      error: error.message
    });
  }
};

export const getBanners = async (req, res) => {
  try {
    const { isActive } = req.query;

    const query = {};
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const banners = await Banner.find(query)
      .populate('createdBy', 'name')
      .sort({ order: 1, createdAt: -1 });

    res.json({
      success: true,
      data: { banners }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch banners',
      error: error.message
    });
  }
};

export const updateBanner = async (req, res) => {
  try {
    const { bannerId } = req.params;
    const updateData = req.body;

    if (req.file) {
      updateData.image = req.file.cloudinaryUrl || req.file.path;
    }

    const banner = await Banner.findByIdAndUpdate(
      bannerId,
      updateData,
      { new: true }
    );

    res.json({
      success: true,
      message: 'Banner updated successfully',
      data: { banner }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update banner',
      error: error.message
    });
  }
};

// Broadcast notification
export const broadcastNotification = async (req, res) => {
  try {
    const { title, message, targetRoles, targetUsers } = req.body;

    const query = {};
    if (targetRoles && targetRoles.length > 0) {
      query.role = { $in: targetRoles };
    }
    if (targetUsers && targetUsers.length > 0) {
      query._id = { $in: targetUsers };
    }

    const users = await User.find(query);
    const io = req.app.get('io');

    const notifications = await Promise.all(
      users.map(user => 
        createAndSendNotification(
          io,
          user._id,
          'broadcast',
          title,
          message,
          null,
          'none'
        )
      )
    );

    res.json({
      success: true,
      message: `Notification broadcasted to ${users.length} users`,
      data: { count: users.length }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to broadcast notification',
      error: error.message
    });
  }
};

// Data export
export const exportData = async (req, res) => {
  try {
    const { type, format, startDate, endDate } = req.query;

    let data = [];
    let filename = '';

    const start = startDate ? moment(startDate).startOf('day').toDate() : moment().subtract(30, 'days').toDate();
    const end = endDate ? moment(endDate).endOf('day').toDate() : new Date();

    if (type === 'appointments') {
      const appointments = await Appointment.find({
        createdAt: { $gte: start, $lte: end }
      })
        .populate('patientId', 'name email phone')
        .populate('doctorId')
        .populate({
          path: 'doctorId',
          populate: { path: 'userId', select: 'name' }
        })
        .sort({ createdAt: -1 });

      data = appointments.map(apt => ({
        'Appointment Number': apt.appointmentNumber,
        'Patient Name': apt.patientId?.name || 'N/A',
        'Patient Email': apt.patientId?.email || 'N/A',
        'Doctor Name': apt.doctorId?.userId?.name || 'N/A',
        'Date': moment(apt.appointmentDate).format('YYYY-MM-DD'),
        'Time': `${apt.timeSlot.startTime} - ${apt.timeSlot.endTime}`,
        'Status': apt.status,
        'Fee': apt.fee,
        'Payment Status': apt.paymentStatus,
        'Created At': moment(apt.createdAt).format('YYYY-MM-DD HH:mm:ss')
      }));

      filename = `appointments_${moment().format('YYYY-MM-DD')}`;
    } else if (type === 'orders') {
      const orders = await Order.find({
        createdAt: { $gte: start, $lte: end }
      })
        .populate('patientId', 'name email phone')
        .populate('hospitalId', 'facilityName')
        .sort({ createdAt: -1 });

      data = orders.map(order => ({
        'Order Number': order.orderNumber,
        'Patient Name': order.patientId?.name || 'N/A',
        'Hospital': order.hospitalId?.facilityName || 'N/A',
        'Collection Type': order.collectionType,
        'Total Amount': order.totalAmount,
        'Final Amount': order.finalAmount,
        'Status': order.status,
        'Created At': moment(order.createdAt).format('YYYY-MM-DD HH:mm:ss')
      }));

      filename = `orders_${moment().format('YYYY-MM-DD')}`;
    } else if (type === 'users') {
      const users = await User.find({
        createdAt: { $gte: start, $lte: end }
      }).sort({ createdAt: -1 });

      data = users.map(user => ({
        'Name': user.name,
        'Email': user.email,
        'Phone': user.phone,
        'Role': user.role,
        'Status': user.isActive ? 'Active' : 'Inactive',
        'Verified': user.isVerified ? 'Yes' : 'No',
        'Created At': moment(user.createdAt).format('YYYY-MM-DD HH:mm:ss')
      }));

      filename = `users_${moment().format('YYYY-MM-DD')}`;
    }

    if (format === 'csv') {
      const outputDir = path.join(__dirname, '../../exports');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const filepath = path.join(outputDir, `${filename}.csv`);
      
      const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: filepath,
        header: Object.keys(data[0] || {}).map(key => ({ id: key, title: key }))
      });

      await csvWriter.writeRecords(data);

      res.download(filepath);
    } else if (format === 'xlsx') {
      const outputDir = path.join(__dirname, '../../exports');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

      const filepath = path.join(outputDir, `${filename}.xlsx`);
      XLSX.writeFile(workbook, filepath);

      res.download(filepath);
    } else {
      res.json({
        success: true,
        data
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to export data',
      error: error.message
    });
  }
};
