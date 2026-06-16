import State from "../models/State.js";
import User from "../models/User.js";
import bcrypt from "bcryptjs";

/**
 * =========================================================
 * ✅ CREATE STATE + AUTO CREATE STATE ADMIN
 * Restricted: INDIA admin only
 * =========================================================
 */
export const createStateWithAdmin = async (req, res) => {
  let state = null;

  try {
    //------------------------------------------------
    // 🔐 AUTH & IDENTITY CHECK
    //------------------------------------------------
    const creator = await User.findById(req.user.id);

    if (!creator) {
      return res.status(401).json({
        success: false,
        message: "Requesting admin account not found",
      });
    }

    // ⭐ YOUR REQUESTED LOGGING
    console.log("-----------------------------------------");
    console.log("LOGGED ADMIN LEVEL:", creator.adminLevel);
    console.log("COUNTRY REF (ID):", creator.countryRef);
    console.log("-----------------------------------------");

    if (!creator.countryRef) {
      return res.status(400).json({
        success: false,
        message: "Admin countryRef missing. National level configuration required.",
      });
    }

    // Tiered Access Validation
    if (creator.role !== "ADMIN" || creator.adminLevel !== "INDIA") {
      return res.status(403).json({
        success: false,
        message: "Access Denied: Requires National (INDIA) level privileges",
      });
    }

    //------------------------------------------------
    // 📥 INPUT & NORMALIZATION
    //------------------------------------------------
    let { stateName, adminName, phone, email } = req.body;

    if (!stateName || !adminName || !phone) {
      return res.status(400).json({
        success: false,
        message: "Required fields: stateName, adminName, and phone",
      });
    }

    // Normalizing for consistency
    stateName = stateName.trim().toUpperCase();
    adminName = adminName.trim().replace(/\s+/g, " ");
    phone = String(phone).replace(/\D/g, ""); 
    email = email?.toLowerCase().trim() || null;

    if (phone.length !== 10) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone: 10 digits required",
      });
    }

    //------------------------------------------------
    // 🛡️ DUPLICATE PREVENTION
    //------------------------------------------------
    const existingState = await State.findOne({
      name: stateName,
      countryRef: creator.countryRef,
      isDeleted: false,
    });

    if (existingState) {
      return res.status(409).json({
        success: false,
        message: `Region '${stateName}' is already registered in this country`,
      });
    }

    const existingAdmin = await User.findOne({
      phone,
      isDeleted: false,
    });

    if (existingAdmin) {
      return res.status(409).json({
        success: false,
        message: "Phone identity already linked to another administrative account",
      });
    }

    //------------------------------------------------
    // 🏗️ ATOMIC CREATION: STATE
    //------------------------------------------------
    state = await State.create({
      name: stateName,
      countryRef: creator.countryRef,
      isActive: true,
      isDeleted: false,
    });

    //------------------------------------------------
    // 🔑 SECURITY: TEMP CREDENTIALS
    //------------------------------------------------
    const tempPassword = "Admin@12345";
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    //------------------------------------------------
    // 🏗️ ATOMIC CREATION: STATE ADMIN
    //------------------------------------------------
    const admin = await User.create({
      name: adminName,
      phone,
      email,
      password: hashedPassword,
      role: "ADMIN",
      adminLevel: "STATE",
      countryRef: creator.countryRef,
      stateRef: state._id,
      isActive: true,
      isDeleted: false,
    });

    //------------------------------------------------
    // 🎉 SUCCESS RESPONSE
    //------------------------------------------------
    return res.status(201).json({
      success: true,
      message: "State successfully provisioned with administrative oversight",
      data: {
        stateId: state._id,
        stateName: state.name,
        stateAdminId: admin._id,
        adminPhone: admin.phone,
        tempPassword,
      },
    });

  } catch (error) {
    console.error("CRITICAL_CREATION_ERROR:", error);

    // Rollback logic
    if (state && state._id) {
      await State.findByIdAndUpdate(state._id, {
        isDeleted: true,
        isActive: false,
      });
      console.warn("ROLLBACK EXECUTED: State soft-deleted due to admin creation failure.");
    }

    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * =========================================================
 * ✅ GET ALL STATES (ADMIN DROPDOWN)
 * Tiered Access: INDIA / STATE / CITY ADMIN
 * =========================================================
 */
export const getStates = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id)
      .select("countryRef adminLevel")
      .lean();

    if (!admin || !admin.countryRef) {
      return res.status(400).json({
        success: false,
        message: "Admin country configuration missing.",
      });
    }

    // ⭐ YOUR REQUESTED LOGGING
    console.log("-----------------------------------------");
    console.log("FETCHING STATES FOR LEVEL:", admin.adminLevel);
    console.log("SCOPE COUNTRY ID:", admin.countryRef);
    console.log("-----------------------------------------");

    const states = await State.find({
      countryRef: admin.countryRef,
      isDeleted: false,
      isActive: true,
    })
      .sort({ name: 1 })
      .select("_id name")
      .lean();

    return res.json({
      success: true,
      count: states.length,
      states,
    });

  } catch (error) {
    console.error("GET_STATES_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch states" });
  }
};