import jwt from "jsonwebtoken";

export const generateAccessToken = (user, salonId = null) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      tokenVersion: user.tokenVersion,
      adminLevel: user.adminLevel || null,
      stateRef: user.stateRef || null,
      cityRef: user.cityRef || null,
      salonId: salonId ? salonId.toString() : null,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: "15m" }
  );
};
