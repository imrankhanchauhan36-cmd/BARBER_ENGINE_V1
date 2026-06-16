import User from "../models/User.js";

//////////////////////////////////////////////////////////////
// ⚙️ CONFIG (GLOBAL)
//////////////////////////////////////////////////////////////

const COOLDOWN_MS = 5000; // 🔥 correct


//////////////////////////////////////////////////////////////
// 🎯 AUTO ASSIGN ADMIN (PAN INDIA — LOAD BALANCED + SAFE++)
//////////////////////////////////////////////////////////////

export const assignAdminByDistrict = async ({
  districtRef,
  stateRef,
}) => {
  try {
    //////////////////////////////////////////////////////////
    // 1️⃣ VALIDATION
    //////////////////////////////////////////////////////////
    if (!districtRef || !stateRef) return null;

    //////////////////////////////////////////////////////////
    // 🧠 OPTIONAL COOLDOWN (ANTI-SPAM)
    //////////////////////////////////////////////////////////
    const cooldownTime = new Date(Date.now() - COOLDOWN_MS);

    //////////////////////////////////////////////////////////
    // COMMON UPDATE
    //////////////////////////////////////////////////////////
    const update = {
      $set: { lastAssignedAt: new Date() },
    };

    //////////////////////////////////////////////////////////
    // 2️⃣ DISTRICT ADMIN (ATOMIC LOAD BALANCING)
    //////////////////////////////////////////////////////////
    let admin = await User.findOneAndUpdate(
      {
        role: "ADMIN",
        adminLevel: "DISTRICT",
        districtRef: districtRef,
        isActive: true,
        isDeleted: { $ne: true },
        $or: [
          { lastAssignedAt: { $exists: false } },
          { lastAssignedAt: null },
          { lastAssignedAt: { $lte: cooldownTime } },
        ],
      },
      update,
      {
        sort: { lastAssignedAt: 1, createdAt: 1 },
        new: true,
        projection: { _id: 1 },
      }
    ).lean();

    //////////////////////////////////////////////////////////
    // 3️⃣ FALLBACK → STATE ADMIN
    //////////////////////////////////////////////////////////
    if (!admin) {
      admin = await User.findOneAndUpdate(
        {
          role: "ADMIN",
          adminLevel: "STATE",
          stateRef: stateRef,
          isActive: true,
          isDeleted: { $ne: true },
          $or: [
            { lastAssignedAt: { $exists: false } },
            { lastAssignedAt: null },
            { lastAssignedAt: { $lte: cooldownTime } },
          ],
        },
        update,
        {
          sort: { lastAssignedAt: 1, createdAt: 1 },
          new: true,
          projection: { _id: 1 },
        }
      ).lean();
    }

    //////////////////////////////////////////////////////////
    // 4️⃣ FINAL FALLBACK → ANY ADMIN
    //////////////////////////////////////////////////////////
    if (!admin) {
      admin = await User.findOneAndUpdate(
        {
          role: "ADMIN",
          isActive: true,
          isDeleted: { $ne: true },
          $or: [
            { lastAssignedAt: { $exists: false } },
            { lastAssignedAt: null },
            { lastAssignedAt: { $lte: cooldownTime } },
          ],
        },
        update,
        {
          sort: { lastAssignedAt: 1, createdAt: 1 },
          new: true,
          projection: { _id: 1 },
        }
      ).lean();
    }

    //////////////////////////////////////////////////////////
    // 5️⃣ RETURN
    //////////////////////////////////////////////////////////
    return admin?._id || null;

  } catch (error) {
    console.error("❌ Admin assign error:", error.message);
    return null;
  }
};