import express from 'express';
import { body } from 'express-validator';
import {
  getProfile,
  updateProfile,
  searchDoctors,
  getDoctorDetails,
  getAvailableSlots,
  bookAppointment,
  getMyAppointments,
  cancelAppointment,
  getMedicalRecords,
  downloadPrescription,
  getDiagnosticTests,
  createOrder,
  getMyOrders,
  getSpecializations,
  getAvailableSerials,
  bookSerial
} from '../controllers/patient.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';

const router = express.Router();

// All routes require authentication and patient role
router.use(authenticate);
router.use(authorize('patient'));

// Profile routes
router.get('/profile', getProfile);
router.put('/profile', [
  body('name').optional().trim().notEmpty(),
  body('dateOfBirth').optional().isISO8601(),
  body('gender').optional().isIn(['male', 'female', 'other'])
], updateProfile);

// Doctor search and details
router.get('/doctors/search', searchDoctors);
router.get('/doctors/:doctorId', getDoctorDetails);
router.get('/doctors/:doctorId/slots', getAvailableSlots);
router.get('/specializations', getSpecializations);

// Serial booking
router.get('/doctors/:doctorId/serials', getAvailableSerials);
router.post('/serials/book', [
  body('doctorId').notEmpty().withMessage('Doctor ID is required'),
  body('serialNumber').isInt({ min: 1 }).withMessage('Valid serial number is required'),
  body('date').isISO8601().withMessage('Valid date is required (YYYY-MM-DD)')
], bookSerial);

// Appointments
router.post('/appointments', [
  body('doctorId').notEmpty().withMessage('Doctor ID is required'),
  body('chamberId').notEmpty().withMessage('Chamber ID is required'),
  body('appointmentDate').isISO8601().withMessage('Valid appointment date is required'),
  body('startTime').notEmpty().withMessage('Start time is required'),
  body('endTime').notEmpty().withMessage('End time is required')
], bookAppointment);
router.get('/appointments', getMyAppointments);
router.put('/appointments/:appointmentId/cancel', cancelAppointment);

// Medical records
router.get('/medical-records', getMedicalRecords);
router.get('/appointments/:appointmentId/prescription', downloadPrescription);

// Diagnostics
router.get('/diagnostics/tests', getDiagnosticTests);
router.post('/diagnostics/orders', [
  body('hospitalId').notEmpty().withMessage('Hospital ID is required'),
  body('tests').isArray({ min: 1 }).withMessage('At least one test is required'),
  body('collectionType').isIn(['walk_in', 'home_collection']).withMessage('Invalid collection type')
], createOrder);
router.get('/diagnostics/orders', getMyOrders);

export default router;

