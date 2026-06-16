//////////////////////////////////////////////////////
// utils/location.utils.js — v2 FINAL ✅
//////////////////////////////////////////////////////

export const cleanLocation = (raw) => {
  if (!raw || raw === "Detecting...") return null;
  return raw
    .replace(/\s*(Division|District|Tehsil|Taluka)\s*/gi, "")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")   // Fix 5: remove double spaces
    .trim() || null;
};