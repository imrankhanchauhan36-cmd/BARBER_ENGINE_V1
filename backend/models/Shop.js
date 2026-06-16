console.log("✅ Shop model loaded");
import mongoose from "mongoose";

const ServiceSchema = new mongoose.Schema({
  name: String,
  price: Number,
  duration: Number,
});

const StallSchema = new mongoose.Schema({
  name: String,
});

const ShopSchema = new mongoose.Schema(
  {
    name: String,
    ownerName: String,
    phone: String,
    address: String,

    services: [ServiceSchema],
    stalls: [StallSchema],

    status: {
      type: String,
      default: "PENDING", // PENDING | APPROVED | REJECTED
    },
  },
  { timestamps: true }
);

export default mongoose.models.Shop ||
  mongoose.model("Shop", ShopSchema);
