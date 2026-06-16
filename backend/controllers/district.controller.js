import mongoose from "mongoose";
import District from "../models/District.js";
import State from "../models/State.js";
import User from "../models/User.js";
import bcrypt from "bcryptjs";

/////////////////////////////////////////////////////////
// ✅ CREATE DISTRICT + AUTO CREATE DISTRICT ADMIN
// Access: INDIA admin, STATE admin
// Transaction safe
/////////////////////////////////////////////////////////
export const createDistrictWithAdmin = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    //------------------------------------------------
    // AUTH CHECK
    //------------------------------------------------
    const creator = await User.findById(req.user.id)
      .select("role adminLevel countryRef stateRef")
      .lean();

    if (!creator) {
      await session.abortTransaction();
      return res.status(401).json({
        success: false,
        message: "Admin not found",
      });
    }

    if (creator.role !== "ADMIN") {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Only ADMIN can create district",
      });
    }

    //------------------------------------------------
    // INPUT
    //------------------------------------------------
    let { districtName, stateId, adminName, phone, email } = req.body;

    if (!districtName || !stateId || !adminName || !phone) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "districtName, stateId, adminName, phone required",
      });
    }

    districtName = districtName.trim().toUpperCase();
    adminName = adminName.trim();
    phone = String(phone).replace(/\D/g, "");
    email = email?.toLowerCase() || null;

    if (phone.length !== 10) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Phone must be 10 digits",
      });
    }

    //------------------------------------------------
    // VALIDATE STATE
    //------------------------------------------------
    const state = await State.findOne({
      _id: stateId,
      countryRef: creator.countryRef,
      isDeleted: false,
      isActive: true,
    }).lean();

    if (!state) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "State not found",
      });
    }

    //------------------------------------------------
    // STATE ADMIN RESTRICTION
    //------------------------------------------------
    if (
      creator.adminLevel === "STATE" &&
      creator.stateRef.toString() !== stateId
    ) {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "STATE admin can only create district in own state",
      });
    }

    //------------------------------------------------
    // DUPLICATE DISTRICT CHECK
    //------------------------------------------------
    const existingDistrict = await District.findOne({
      name: districtName,
      stateRef: stateId,
      isDeleted: false,
    }).lean();

    if (existingDistrict) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: "District already exists",
      });
    }

    //------------------------------------------------
    // DUPLICATE PHONE CHECK
    //------------------------------------------------
    const existingUser = await User.findOne({
      phone,
      isDeleted: false,
    }).lean();

    if (existingUser) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: "Phone already in use",
      });
    }

    //------------------------------------------------
    // CREATE DISTRICT
    //------------------------------------------------
    const [district] = await District.create(
      [
        {
          name: districtName,
          countryRef: creator.countryRef,
          stateRef: stateId,
          isActive: true,
          isDeleted: false,
        },
      ],
      { session }
    );

    //------------------------------------------------
    // CREATE DISTRICT ADMIN
    //------------------------------------------------
    const tempPassword = "Admin@12345";
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const [admin] = await User.create(
      [
        {
          name: adminName,
          phone,
          email,
          password: hashedPassword,
          role: "ADMIN",
          adminLevel: "DISTRICT",
          countryRef: creator.countryRef,
          stateRef: stateId,
          districtRef: district._id,
          isActive: true,
          isDeleted: false,
        },
      ],
      { session }
    );

    //------------------------------------------------
    // COMMIT
    //------------------------------------------------
    await session.commitTransaction();
    session.endSession();

    //------------------------------------------------
    // RESPONSE
    //------------------------------------------------
    return res.status(201).json({
      success: true,
      message: "District and District Admin created",
      data: {
        districtId: district._id,
        districtName: district.name,
        adminId: admin._id,
        adminPhone: admin.phone,
        tempPassword,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("DISTRICT_CREATE_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "District creation failed",
    });
  }
};

/////////////////////////////////////////////////////////
// ✅ GET DISTRICTS
/////////////////////////////////////////////////////////
export const getDistrict = async (req, res) => {
  try {
    const { stateId } = req.query;

    const admin = await User.findById(req.user.id)
      .select("adminLevel countryRef stateRef districtRef")
      .lean();

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
      });
    }

    //------------------------------------------------
    // FILTER
    //------------------------------------------------
    let filter = {
      countryRef: admin.countryRef,
      isDeleted: false,
      isActive: true,
    };

    if (admin.adminLevel === "STATE") {
      filter.stateRef = admin.stateRef;
    }

    if (admin.adminLevel === "DISTRICT") {
      filter._id = admin.districtRef;
    }

    if (admin.adminLevel === "INDIA" && stateId) {
      filter.stateRef = stateId;
    }

    //------------------------------------------------
    // FETCH
    //------------------------------------------------
    const districts = await District.find(filter)
      .select("_id name stateRef")
      .sort({ name: 1 })
      .lean();

    return res.json({
      success: true,
      count: districts.length,
      districts,
    });

  } catch (error) {
    console.error("GET_DISTRICT_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch districts",
    });
  }
};