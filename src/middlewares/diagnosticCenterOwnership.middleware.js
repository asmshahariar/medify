import DiagnosticCenter from '../models/DiagnosticCenter.model.js';

/**
 * Middleware to check if the authenticated user is an admin of the diagnostic center
 * Must be used after authenticate and authorize middleware
 */
export const checkDiagnosticCenterOwnership = async (req, res, next) => {
  try {
    const { centerId } = req.params;

    // Super admin can access any diagnostic center
    if (req.user.role === 'super_admin') {
      return next();
    }

    // Check if diagnostic center exists
    const diagnosticCenter = await DiagnosticCenter.findById(centerId);
    if (!diagnosticCenter) {
      return res.status(404).json({
        success: false,
        message: 'Diagnostic center not found'
      });
    }

    // Check if user is a diagnostic center admin
    if (req.user.role !== 'diagnostic_center_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Diagnostic center admin role required.'
      });
    }

    // Check if user is an admin of this diagnostic center
    if (!diagnosticCenter.admins.includes(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are not an admin of this diagnostic center.'
      });
    }

    // Attach diagnostic center to request for use in controllers
    req.diagnosticCenter = diagnosticCenter;
    next();
  } catch (error) {
    console.error('Diagnostic center ownership check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify diagnostic center ownership',
      error: error.message
    });
  }
};

