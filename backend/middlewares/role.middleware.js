export const requireRole = (role) => {
  return (req, res, next) => {
    // ⛔ TEMP BYPASS FOR ONBOARDING
    // (Zomato / Swiggy style)
    next();
  };
};
