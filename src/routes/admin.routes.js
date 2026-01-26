import express from 'express';
import { body } from 'express-validator';
import {
  getDashboardStats,
  createBanner,
  getBanners,
  updateBanner,
  broadcastNotification,
  exportData
} from '../controllers/admin.controller.js';
import {
  approveDoctor,
  rejectDoctor,
  approveHospital,
  rejectHospital,
  approveDiagnosticCenter,
  rejectDiagnosticCenter,
  getPendingItems
} from '../controllers/approval.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import upload, { uploadToCloudinaryMiddleware } from '../middlewares/upload.middleware.js';

const router = express.Router();

// All routes require authentication and super_admin role
router.use(authenticate);
router.use(authorize('super_admin'));

// Dashboard
router.get('/dashboard/stats', getDashboardStats);

// Approval endpoints
router.get('/pending', getPendingItems);

// Doctor approval/rejection
router.post('/approve/doctor/:doctorId', [
  body('reason').optional().trim()
], approveDoctor);
router.post('/reject/doctor/:doctorId', [
  body('reason').notEmpty().withMessage('Rejection reason is required')
], rejectDoctor);

// Hospital approval/rejection
router.post('/approve/hospital/:hospitalId', [
  body('reason').optional().trim()
], approveHospital);
router.post('/reject/hospital/:hospitalId', [
  body('reason').notEmpty().withMessage('Rejection reason is required')
], rejectHospital);

// Diagnostic Center approval/rejection
router.post('/approve/diagnostic-center/:centerId', [
  body('reason').optional().trim()
], approveDiagnosticCenter);
router.post('/reject/diagnostic-center/:centerId', [
  body('reason').notEmpty().withMessage('Rejection reason is required')
], rejectDiagnosticCenter);

// Banner management
router.post('/banners', upload.single('banner'), uploadToCloudinaryMiddleware, [
  body('title').notEmpty().withMessage('Title is required')
], createBanner);
router.get('/banners', getBanners);
router.put('/banners/:bannerId', upload.single('banner'), uploadToCloudinaryMiddleware, updateBanner);

// Broadcast notification
router.post('/notifications/broadcast', [
  body('title').notEmpty().withMessage('Title is required'),
  body('message').notEmpty().withMessage('Message is required')
], broadcastNotification);

// Data export
router.get('/export', exportData);

export default router;
