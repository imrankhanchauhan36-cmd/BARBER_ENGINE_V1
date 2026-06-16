import Salon from "../models/Salon.js";

///////////////////////////////////////////////////////////
// SALON SERVICE — v2 FINAL LOCK ✅
//
// FIXES:
//   FIX 1: managerPhone → manager.phone (duplicate check)
//   FIX 2: shopName/city/address → basicInfo.* + location.*
//   FIX 3: status → approval.status
//   FIX 4: getPendingSalons → approval.status + isDeleted
///////////////////////////////////////////////////////////

export const SalonService = {

  // ONBOARD NEW SALON
  onboardNewSalon: async (salonData) => {
    try {
      // FIX 1: duplicate check via manager.phone
      const existingSalon = await Salon.findOne({
        "manager.phone": salonData.manager?.phone || salonData.managerPhone,
        isDeleted: false,
      });

      if (existingSalon) {
        throw new Error("Salon already registered with this phone number");
      }

      // FIX 2+3: use new model structure
      const newSalon = new Salon({
        ownerId: salonData.ownerId || null, // TEMP user allowed

        basicInfo: {
          shopName:  salonData.basicInfo?.shopName  || salonData.shopName,
          category:  salonData.basicInfo?.category  || salonData.category || "UNISEX",
          tier:      salonData.basicInfo?.tier       || "STANDARD",
        },

        manager: {
          name:  salonData.manager?.name  || salonData.managerName  || null,
          phone: salonData.manager?.phone || salonData.managerPhone || null,
        },

        location: {
          address:   salonData.location?.address   || salonData.address || null,
          geo:       salonData.location?.geo        || null,
          territory: salonData.location?.territory  || {},
        },

        timings:    salonData.timings    || {},

        // FIX 3: approval.status instead of status
        approval:   { status: "PENDING" },
        onboarding: { step: 1 },
        isDeleted:  false,
      });

      const savedSalon = await newSalon.save();

      return {
        success: true,
        message: "Salon submitted successfully. Awaiting approval.",
        data: {
          salonId: savedSalon._id,
          status:  savedSalon.approval?.status, // FIX 3
        },
      };

    } catch (error) {
      console.error("SalonService Error:", error.message);
      throw error;
    }
  },

  // FIX 4: getPendingSalons — use approval.status + isDeleted
  getPendingSalons: async () => {
    return await Salon.find({
      "approval.status": "PENDING",
      isDeleted: false,
    }).sort({ createdAt: -1 });
  },

};