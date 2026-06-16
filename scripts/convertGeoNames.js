import fs from "fs";

const raw = fs.readFileSync("data/IN.txt", "utf-8");

const lines = raw.split("\n");

const cities = [];

for (const line of lines) {
  const parts = line.split("\t");

  const featureClass = parts[6];
  const featureCode = parts[7];

  // Only cities
  if (featureClass !== "P") continue;

  cities.push({
    name: parts[1],
    lat: parseFloat(parts[4]),
    lng: parseFloat(parts[5]),
    stateCode: parts[10],
    admin2Code: parts[11], // 🔥 MAIN FIELD
    geonameid: parts[0],
  });
}

fs.writeFileSync(
  "data/indiaCitiesFinal.json",
  JSON.stringify(cities, null, 2)
);

console.log("✅ Converted:", cities.length);