import fs from "fs";

const districts = JSON.parse(
  fs.readFileSync("seeds/data/districts.json", "utf-8")
);

// 🔥 TEMP LOGIC (same code use kar rahe)
const updated = districts.map((d, index) => {
  return {
    ...d,

    // ⚠️ TEMP (replace later with real mapping)
    admin2Code: String(index + 1).padStart(3, "0")
  };
});

fs.writeFileSync(
  "seeds/data/districts_updated.json",
  JSON.stringify(updated, null, 2)
);

console.log("✅ Done");