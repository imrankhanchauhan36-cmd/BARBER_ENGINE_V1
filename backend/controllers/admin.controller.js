import Salon from "../models/Salon.js";
import User from "../models/User.js";
import State from "../models/State.js";
import District from "../models/District.js";
import bcrypt from "bcryptjs";

/**
 * =====================================================
 * ✅ LIST SALONS FOR ADMIN (FINAL — ENTERPRISE READY)
 * =====================================================
 */
export const listSalonsForAdmin = async (req, res) => {
  try {
    const admin = req.user;

    //////////////////////////////////////////////////////
    // 🔒 ADMIN VALIDATION
    //////////////////////////////////////////////////////
    if (!admin || !admin.adminLevel) {
      return res.status(403).json({
        success: false,
        message: "Invalid admin",
      });
    }

    //////////////////////////////////////////////////////
    // 🔥 BASE FILTER (ONLY PENDING)
    //////////////////////////////////////////////////////
    const statusFilter = req.query.status || "PENDING";
    let filter = {
      "approval.status": statusFilter,
    };
    
    //////////////////////////////////////////////////////
    // 🔥 ADMIN LEVEL LOGIC
    //////////////////////////////////////////////////////
    if (admin.adminLevel === "STATE") {
      filter["location.territory.stateRef"] = admin.stateRef;
    }

    if (admin.adminLevel === "DISTRICT") {
      filter["assignedAdmin"] = admin._id;
    }

    // INDIA admin → no extra filter (gets all pending)

    //////////////////////////////////////////////////////
    // 🔥 PAGINATION (SAFE)
    //////////////////////////////////////////////////////
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    //////////////////////////////////////////////////////
    // 🔥 FETCH DATA + COUNT (PARALLEL)
    //////////////////////////////////////////////////////
    const [salons, total] = await Promise.all([
      Salon.find(filter)
        .select(
          "_id basicInfo.shopName location approval createdAt assignedAdmin"
        )
        .populate("assignedAdmin", "name phone adminLevel")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Salon.countDocuments(filter),
    ]);

    //////////////////////////////////////////////////////
    // 📤 RESPONSE (ENTERPRISE FORMAT)
    //////////////////////////////////////////////////////
    return res.json({
      success: true,
      total,              // total matching salons
      page,
      limit,
      count: salons.length, // current page count
      data: salons,
    });

  } catch (err) {
    console.error("LIST SALONS ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to load salons",
    });
  }
};

/**
 * =====================================================
 * ✅ APPROVE / REJECT SALON
 * =====================================================
 */
export const updateSalonStatus = async (req, res) => {
  try {
    if (req.user.adminLevel !== "DISTRICT") {
      return res.status(403).json({
        message: "Only DISTRICT admin can approve salons",
      });
    }

    const allowedStatuses = ["APPROVED", "REJECTED"];

    if (!allowedStatuses.includes(req.body.status)) {
      return res.status(400).json({
        message: "Invalid status",
      });
    }

    const status = req.body.status;

    //////////////////////////////////////////////////////
    // 🔥 FETCH SALON FIRST
    //////////////////////////////////////////////////////
    const salon = await Salon.findById(req.params.id);

    if (!salon) {
      return res.status(404).json({ message: "Salon not found" });
    }

    //////////////////////////////////////////////////////
    // 🔐 SECURITY CHECK (VERY IMPORTANT)
    //////////////////////////////////////////////////////
    if (
      !salon.assignedAdmin ||
      salon.assignedAdmin.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        message: "Not allowed to approve this salon",
      });
    }

    //////////////////////////////////////////////////////
    // 🔥 UPDATE STATUS
    //////////////////////////////////////////////////////

    // 🛠️ SAFE INIT (CRITICAL FIX)
    if (!salon.approval) {
      salon.approval = {};
    }
    
    const updatedSalon = await Salon.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
        "approval.status": status,
        "approval.approvedBy":
          status === "APPROVED" ? req.user._id : null,
        "approval.approvedAt":
          status === "APPROVED" ? new Date() : null,
        "approval.rejectionReason":
          status === "REJECTED"
            ? req.body.rejectionReason || "Not specified"
            : null,
      },
    },
    { new: true }
  );

    return res.json({
      message: "Salon status updated",
      salon: updatedSalon,
    });
  } catch (err) {
    console.error("🔥 STATUS ERROR:", err);

    return res.status(500).json({
      message: "Failed to update status",
      error: err.message,
    });
  }
};

/**
 * =====================================================
 * ✅ SET SALON COMMISSION
 * =====================================================
 */
export const setSalonCommission = async (req, res) => {
  try {
    const { commission } = req.body;

    const salon = await Salon.findByIdAndUpdate(
      req.params.id,
      { commission },
      { new: true }
    );

    if (!salon) {
      return res.status(404).json({ message: "Salon not found" });
    }

    return res.json({
      message: "Commission updated",
      salon,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to set commission",
    });
  }
};

/**
 * =====================================================
 * ✅ FORCE CLOSE SALON
 * =====================================================
 */
export const forceCloseSalon = async (req, res) => {
  try {
    const salon = await Salon.findByIdAndUpdate(
      req.params.id,
      {
        isForceClosed: true,
        isShopOpen: false,
      },
      { new: true }
    );

    if (!salon) {
      return res.status(404).json({
        message: "Salon not found",
      });
    }

    return res.json({
      message: "Salon force closed by admin",
      salon,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Failed to force close salon",
    });
  }
};

/**
 * =====================================================
 * ✅ CREATE STATE ADMIN
 * =====================================================
 */
export const createStateAdmin = async (req, res) => {
  try {
    const creator = req.user;
    let { name, phone, email, stateId } = req.body;

    if (creator.adminLevel !== "INDIA") {
      return res.status(403).json({
        message: "Only INDIA admin can create state admin",
      });
    }

    name = name.trim().replace(/\s+/g, " ");
    phone = String(phone.replace(/\D/g, ""));
    email = email?.toLowerCase().trim() || null;

    const state = await State.findById(stateId).lean();
    if (!state) {
      return res.status(404).json({ message: "State not found" });
    }

    const tempPassword = "Admin@12345";
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const admin = await User.create({
      name,
      phone,
      email,
      password: hashedPassword,
      role: "ADMIN",
      adminLevel: "STATE",
      countryRef: creator.countryRef,
      stateRef: stateId,
    });

    return res.status(201).json({
      adminId: admin._id,
      tempPassword,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Duplicate admin" });
    }
    return res.status(500).json({
      success: false,
      message: "Failed",
    });
  }
};

/**
 * =====================================================
 * ✅ CREATE DISTRICT ADMIN
 * =====================================================
 */
export const createDistrictAdmin = async (req, res) => {
  try {
    const creator = req.user;
    let { name, phone, email, stateId, districtId } = req.body;

    if (!["INDIA", "STATE"].includes(creator.adminLevel)) {
      return res.status(403).json({
        message: "Not allowed to create district admin",
      });
    }

    if (
      creator.adminLevel === "STATE" &&
      creator.stateRef.toString() !== stateId
    ) {
      return res.status(403).json({
        message: "Cannot create admin outside your state",
      });
    }

    name = name.trim().replace(/\s+/g, " ");
    phone = String(phone.replace(/\D/g, ""));
    email = email?.toLowerCase().trim() || null;

    const district = await District.findById(districtId).lean();
    if (!district) {
      return res.status(404).json({ message: "District not found" });
    }

    if (district.stateRef.toString() !== stateId) {
      return res.status(400).json({ message: "District mismatch" });
    }

    const tempPassword = "Admin@12345";
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const admin = await User.create({
      name,
      phone,
      email,
      password: hashedPassword,
      role: "ADMIN",
      adminLevel: "DISTRICT",
      countryRef: creator.countryRef,
      stateRef: stateId,
      districtRef: districtId,
    });

    return res.status(201).json({
      adminId: admin._id,
      tempPassword,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Duplicate admin" });
    }
    return res.status(500).json({
      message: "Failed",
    });
  }
};