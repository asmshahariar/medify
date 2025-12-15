import express from 'express';
import { body } from 'express-validator';
import {
  getProfile,
  onboardDoctor,
  updateProfile,
  upsertSchedule,
  getSchedules,
  getAppointments,
  updateAppointmentStatus,
  createPrescription,
  getPatientHistory,
  getEarnings,
  generateSerialList
} from '../controllers/doctor.portal.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import upload, { uploadToCloudinaryMiddleware } from '../middlewares/upload.middleware.js';

const router = express.Router();

// All routes require authentication and doctor role
router.use(authenticate);
router.use(authorize('doctor'));

// Profile routes
router.get('/profile', getProfile);
router.post('/onboard', [
  upload.fields([
    { name: 'bmdcProof', maxCount: 1 },
    { name: 'degrees', maxCount: 10 },
    { name: 'certificates', maxCount: 10 }
  ]),
  uploadToCloudinaryMiddleware,
  body('bmdcNo').notEmpty().withMessage('BMDC number is required'),
  body('specialization').notEmpty().withMessage('Specialization is required'),
  body('consultationFee').isNumeric().withMessage('Consultation fee must be a number')
], onboardDoctor);
router.put('/profile', upload.single('profilePhoto'), uploadToCloudinaryMiddleware, updateProfile);

// Schedule routes
router.post('/schedules', [
  body('chamberId').notEmpty().withMessage('Chamber ID is required'),
  body('dayOfWeek').isInt({ min: 0, max: 6 }).withMessage('Day of week must be 0-6'),
  body('timeSlots').isArray().withMessage('Time slots must be an array')
], upsertSchedule);
router.get('/schedules', getSchedules);

// Appointment routes
router.get('/appointments', getAppointments);
router.put('/appointments/:appointmentId/status', [
  body('status').isIn(['pending', 'accepted', 'rejected', 'completed', 'no_show'])
    .withMessage('Invalid status')
], updateAppointmentStatus);

// Prescription routes
router.post('/prescriptions', [
  body('appointmentId').notEmpty().withMessage('Appointment ID is required'),
  body('medicines').isArray().withMessage('Medicines must be an array')
], createPrescription);

// Patient history
router.get('/patients/:patientId/history', getPatientHistory);

// Earnings
router.get('/earnings', getEarnings);

// Serial list
router.get('/serial-list', generateSerialList);

export default router;

