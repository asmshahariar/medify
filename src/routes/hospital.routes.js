import express from 'express';
import { body } from 'express-validator';
import {
  registerHospital,
  addDoctorByHospital,
  getHospitalDoctors,
  approveDoctorByHospital,
  getHospitalProfile,
  updateHospitalProfile,
  searchVerifiedDoctors,
  linkDoctorToHospital,
  removeDoctorFromHospital,
  getHospitalAppointments,
  getHospitalDashboard,
  createHomeService,
  getHomeServices,
  getHomeService,
  updateHomeService,
  deleteHomeService
} from '../controllers/hospital.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { checkHospitalOwnership } from '../middlewares/hospitalOwnership.middleware.js';

const router = express.Router();

// Hospital registration (public - no auth required)
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Hospital name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .matches(/^\+?[1-9]\d{1,14}$/).withMessage('Valid phone number is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('address').notEmpty().withMessage('Address is required'),
  body('registrationNumber').notEmpty().withMessage('Registration number is required'),
  body('documents').notEmpty().withMessage('Documents are required')
], registerHospital);

// Hospital admin routes (require authentication and hospital admin role)
router.use(authenticate);
router.use(authorize('hospital_admin', 'super_admin'));

// Add doctor directly (auto-approved)
router.post('/:hospitalId/doctors', checkHospitalOwnership, [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .matches(/^\+?[1-9]\d{1,14}$/).withMessage('Valid phone number is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('medicalLicenseNumber').notEmpty().withMessage('Medical license number is required'),
  body('licenseDocumentUrl').optional().isString().withMessage('License document URL must be a string'),
  body('specialization').notEmpty().withMessage('Specialization is required'),
  body('experienceYears').isInt({ min: 0 }).withMessage('Experience years must be a valid number')
], addDoctorByHospital);

// Get hospital doctors
router.get('/:hospitalId/doctors', checkHospitalOwnership, getHospitalDoctors);

// Approve doctor registered under hospital
router.post('/:hospitalId/approve/doctor/:doctorId', checkHospitalOwnership, approveDoctorByHospital);

// Hospital Profile Management
router.get('/:hospitalId/profile', checkHospitalOwnership, getHospitalProfile);
router.put('/:hospitalId/profile', checkHospitalOwnership, [
  body('name').optional().trim().notEmpty(),
  body('address').optional().trim().notEmpty(),
  body('contactInfo').optional().isObject(),
  body('departments').optional().isArray(),
  body('logo').optional().isString(),
  body('facilities').optional().isArray(),
  body('services').optional().isArray()
], updateHospitalProfile);

// Search and Link Verified Doctors
router.get('/:hospitalId/doctors/search', checkHospitalOwnership, searchVerifiedDoctors);
router.post('/:hospitalId/doctors/link', checkHospitalOwnership, [
  body('doctorId').isMongoId().withMessage('Valid doctor ID is required'),
  body('designation').optional().trim(),
  body('department').optional().trim()
], linkDoctorToHospital);
router.delete('/:hospitalId/doctors/:doctorId', checkHospitalOwnership, removeDoctorFromHospital);

// Hospital Appointments (Read-only)
router.get('/:hospitalId/appointments', checkHospitalOwnership, getHospitalAppointments);

// Hospital Dashboard
router.get('/:hospitalId/dashboard', checkHospitalOwnership, getHospitalDashboard);

// Home Services Management
router.post('/:hospitalId/home-services', checkHospitalOwnership, [
  body('serviceType').trim().notEmpty().withMessage('Service type is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('note').optional().trim(),
  body('availableTime.startTime').optional().matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Start time must be in HH:mm format'),
  body('availableTime.endTime').optional().matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).withMessage('End time must be in HH:mm format'),
  body('offDays').optional().isArray().withMessage('Off days must be an array'),
  body('offDays.*').optional().isInt({ min: 0, max: 6 }).withMessage('Each off day must be between 0 (Sunday) and 6 (Saturday)')
], createHomeService);

router.get('/:hospitalId/home-services', checkHospitalOwnership, getHomeServices);
router.get('/:hospitalId/home-services/:serviceId', checkHospitalOwnership, getHomeService);

router.put('/:hospitalId/home-services/:serviceId', checkHospitalOwnership, [
  body('serviceType').optional().trim().notEmpty(),
  body('price').optional().isFloat({ min: 0 }),
  body('note').optional().trim(),
  body('availableTime.startTime').optional().matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Start time must be in HH:mm format'),
  body('availableTime.endTime').optional().matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/).withMessage('End time must be in HH:mm format'),
  body('offDays').optional().isArray().withMessage('Off days must be an array'),
  body('offDays.*').optional().isInt({ min: 0, max: 6 }).withMessage('Each off day must be between 0 (Sunday) and 6 (Saturday)'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
], updateHomeService);

router.delete('/:hospitalId/home-services/:serviceId', checkHospitalOwnership, deleteHomeService);

export default router;