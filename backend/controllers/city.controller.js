import City from "../models/City.js";

//////////////////////////////////////////////////////////////
// GET SERVICEABLE CITIES — for the manual "Choose City" picker
// GET /api/v1/cities/serviceable
//
// Only cities with isServiceable: true AND both coordinates set —
// a city missing coordinates would silently break the "browse
// nearby" flow if selected, so it's excluded here rather than sent
// to the frontend with null lat/lng. As new cities go live (admin
// sets isServiceable: true + coordinates), they appear here
// automatically — no frontend code change or app update needed.
//////////////////////////////////////////////////////////////

export const getServiceableCities = async (req, res) => {
  try {
    const cities = await City.find({
      isServiceable: true,
      latitude:  { $ne: null },
      longitude: { $ne: null },
    })
      .select("name state latitude longitude tier")
      // Metro cities (lower tier number, e.g. tier 1) surface first,
      // alphabetical within the same tier — a flat name-sort would
      // otherwise interleave a tier-1 city with tier-3 towns that
      // happen to come first alphabetically.
      .sort({ tier: 1, name: 1 })
      .lean();

    return res.json({
      success: true,
      count: cities.length,
      data: cities,
    });
  } catch (error) {
    console.error("getServiceableCities error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch cities" });
  }
};