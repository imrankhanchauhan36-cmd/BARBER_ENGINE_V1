//////////////////////////////////////////////////////
// BLOCKED ADMIN ROLES
//////////////////////////////////////////////////////

const BLOCKED_ROLES = [
  "ADMIN",
  "SUPER_ADMIN",
  "DISTRICT_ADMIN",
];

//////////////////////////////////////////////////////
// BLOCK ADMIN ACCESS TO USER APIs
//////////////////////////////////////////////////////

export const blockAdmin = (
  req,
  res,
  next
) => {
  try {

    ////////////////////////////////////////////////////
    // BLOCK ADMIN-TYPE ROLES
    ////////////////////////////////////////////////////

    if (
      BLOCKED_ROLES.includes(
        req.user?.role
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This API is not accessible for admin accounts",
      });
    }

    ////////////////////////////////////////////////////
    // ALLOW USER / OWNER
    ////////////////////////////////////////////////////

    next();

  } catch (error) {

    console.error(
      "blockAdmin middleware error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Authorization error",
    });

  }
};