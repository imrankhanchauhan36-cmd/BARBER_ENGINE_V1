import mongoose from "mongoose";

import State from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";

export const validateGeoHierarchy = async ({
  stateRef,
  districtRef,
  cityRef,
}) => {
  ///////////////////////////////////////////////////
  // 🔥 REQUIRED CHECK
  ///////////////////////////////////////////////////

  if (
    !stateRef ||
    !districtRef ||
    !cityRef
  ) {
    throw new Error(
      "stateRef, districtRef and cityRef are required"
    );
  }

  ///////////////////////////////////////////////////
  // 🔥 OBJECT ID VALIDATION
  ///////////////////////////////////////////////////

  const ids = [
    stateRef,
    districtRef,
    cityRef,
  ];

  for (const id of ids) {
    if (
      !mongoose.Types.ObjectId.isValid(
        id
      )
    ) {
      throw new Error(
        "Invalid Mongo ObjectId"
      );
    }
  }

  ///////////////////////////////////////////////////
  // 🔥 FETCH DOCUMENTS
  ///////////////////////////////////////////////////

  const [state, district, city] =
    await Promise.all([
      State.findOne({
        _id: stateRef,
        isDeleted: false,
      })
        .select("_id")
        .lean(),

      District.findOne({
        _id: districtRef,
        isDeleted: false,
      })
        .select("_id stateRef")
        .lean(),

      City.findOne({
        _id: cityRef,
        isDeleted: false,
      })
        .select(
          "_id stateRef districtRef"
        )
        .lean(),
    ]);

  ///////////////////////////////////////////////////
  // 🔥 EXISTENCE CHECK
  ///////////////////////////////////////////////////

  if (!state) {
    throw new Error(
      "Invalid stateRef"
    );
  }

  if (!district) {
    throw new Error(
      "Invalid districtRef"
    );
  }

  if (!city) {
    throw new Error(
      "Invalid cityRef"
    );
  }

  ///////////////////////////////////////////////////
  // 🔥 DISTRICT → STATE VALIDATION
  ///////////////////////////////////////////////////

  if (
    !district.stateRef ||
    String(district.stateRef) !==
      String(state._id)
  ) {
    throw new Error(
      "districtRef does not belong to stateRef"
    );
  }

  ///////////////////////////////////////////////////
  // 🔥 CITY → DISTRICT VALIDATION
  ///////////////////////////////////////////////////

  if (
    !city.districtRef ||
    String(city.districtRef) !==
      String(district._id)
  ) {
    throw new Error(
      "cityRef does not belong to districtRef"
    );
  }

  ///////////////////////////////////////////////////
  // 🔥 CITY → STATE VALIDATION
  ///////////////////////////////////////////////////

  if (
    !city.stateRef ||
    String(city.stateRef) !==
      String(state._id)
  ) {
    throw new Error(
      "cityRef does not belong to stateRef"
    );
  }

  ///////////////////////////////////////////////////
  // ✅ SUCCESS
  ///////////////////////////////////////////////////

  return {
    success: true,

    stateId: state._id,

    districtId: district._id,

    cityId: city._id,
  };
};