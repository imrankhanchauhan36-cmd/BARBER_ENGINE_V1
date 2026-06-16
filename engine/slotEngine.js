// SLOT ENGINE – FINAL (LOCKED)

export function canBookSlot({
  freeWindowStart,
  freeWindowEnd,
  services,     // selected services
  allServices,  // all salon services (for gap check)
}) {
  const totalServiceTime = services.reduce(
    (sum, s) => sum + s.duration + s.buffer,
    0
  );

  const freeMinutes =
    timeToMinutes(freeWindowEnd) - timeToMinutes(freeWindowStart);

  // Perfect fit
  if (totalServiceTime === freeMinutes) {
    return { allowed: true, startShift: 0 };
  }

  // Smart ±5 / ±10 minute adjustment
  const shifts = [-10, -5, 5, 10];

  for (let shift of shifts) {
    const adjustedStart =
      timeToMinutes(freeWindowStart) + shift;
    const adjustedEnd = adjustedStart + totalServiceTime;

    if (adjustedEnd > timeToMinutes(freeWindowEnd)) continue;

    const remainingGap =
      timeToMinutes(freeWindowEnd) - adjustedEnd;

    const gapUsable = allServices.some(
      (s) => s.duration + s.buffer <= remainingGap
    );

    if (gapUsable) {
      return { allowed: true, startShift: shift };
    }
  }

  return { allowed: false };
}

function timeToMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
