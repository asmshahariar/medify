import express from 'express';
import { body } from 'express-validator';
import {
  registerHospital,
  addDoctorByHospital,
  getHospitalDoctors,
  approveDoctorByHospital
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
  body('licenseDocumentUrl').notEmpty().withMessage('License document URL is required'),
  body('specialization').notEmpty().withMessage('Specialization is required'),
  body('experienceYears').isInt({ min: 0 }).withMessage('Experience years must be a valid number')
], addDoctorByHospital);

// Get hospital doctors
router.get('/:hospitalId/doctors', checkHospitalOwnership, getHospitalDoctors);

// Approve doctor registered under hospital
router.post('/:hospitalId/approve/doctor/:doctorId', checkHospitalOwnership, approveDoctorByHospital);

export default router;