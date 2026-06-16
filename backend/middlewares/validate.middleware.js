//////////////////////////////////////////////////////////////
// 🔥 VALIDATION MIDDLEWARE (FINAL — ENTERPRISE GRADE)
//////////////////////////////////////////////////////////////

export const validate = (schema, property = "body") => {
  return (req, res, next) => {
    try {
      //////////////////////////////////////////////////////////
      // ❗ SAFETY CHECK
      //////////////////////////////////////////////////////////
      if (!schema) {
        return next(new Error("Validation schema missing"));
      }

      //////////////////////////////////////////////////////////
      // 🔍 VALIDATE DATA
      //////////////////////////////////////////////////////////
      const { error, value } = schema.validate(req[property], {
        abortEarly: false, // show all errors
        stripUnknown: true, // remove extra fields
      });

      //////////////////////////////////////////////////////////
      // ❌ HANDLE VALIDATION ERROR
      //////////////////////////////////////////////////////////
      if (error) {
        const formattedErrors = error.details.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));

        return res.status(400).json({
          success: false,
          requestId: req.requestId || null,
          errors: formattedErrors,
        });
      }

      //////////////////////////////////////////////////////////
      // ✅ SANITIZE INPUT (IMPORTANT)
      //////////////////////////////////////////////////////////
      req[property] = value;

      //////////////////////////////////////////////////////////
      // ➡️ NEXT
      //////////////////////////////////////////////////////////
      next();

    } catch (err) {
      //////////////////////////////////////////////////////////
      // ❌ UNEXPECTED ERROR
      //////////////////////////////////////////////////////////
      console.error("Validation middleware error:", err);

      return res.status(500).json({
        success: false,
        requestId: req.requestId || null,
        message: "Validation failed due to server error",
      });
    }
  };
};