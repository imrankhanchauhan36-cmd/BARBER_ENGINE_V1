// backend/middlewares/onboardingBypass.middleware.js

export const onboardingBypass = (req, res, next) => {
  // Only block AFTER onboarding routes
  if (
    req.originalUrl.startsWith("/api/salons/check-status") ||
    req.originalUrl.startsWith("/api/salons/onboard")
  ) {
    return next(); // ✅ allow
  }

  // If user is temp → block protected resources
  if (req.user?.isTemp === true) {
    return res.status(403).json({
      success: false,
      message: "Complete onboarding to access this resource.",
    });
  }

  return next(); // ✅ real users allowed
};
