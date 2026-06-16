//////////////////////////////////////////////////////
// GENERATE TIME SLOTS
//////////////////////////////////////////////////////

export const generateSlots = ({
  startHour = 9,

  endHour = 21,

  interval = 15,
}) => {

  const slots = [];

  for (
    let minutes =
      startHour * 60;

    minutes <
      endHour * 60;

    minutes += interval
  ) {

    const hour =
      Math.floor(
        minutes / 60
      );

    const min =
      minutes % 60;

    const formatted =
      `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

    slots.push({
      id: formatted,
      time: formatted,

      available: true,
    });
  }

  return slots;
};

//////////////////////////////////////////////////////
// FORMAT TIME
//////////////////////////////////////////////////////

export const formatTime12Hour =
  (time24) => {

    const [
      hour,
      minute,
    ] = time24.split(":");

    const h = Number(hour);

    const suffix =
      h >= 12 ? "PM" : "AM";

    const formattedHour =
      h % 12 || 12;

    return `${formattedHour}:${minute} ${suffix}`;
};

//////////////////////////////////////////////////////
// MARK BOOKED SLOTS
//////////////////////////////////////////////////////

export const markBookedSlots = ({
  slots = [],

  bookedSlots = [],
}) => {

  return slots.map(slot => {

    const isBooked =
      bookedSlots.includes(
        slot.time
      );

    return {
      ...slot,

      available:
        !isBooked,
    };
  });
};

//////////////////////////////////////////////////////
// FILTER AVAILABLE SLOTS
//////////////////////////////////////////////////////

export const getAvailableSlots =
  (slots = []) => {

    return slots.filter(
      slot => slot.available
    );
};

//////////////////////////////////////////////////////
// CALCULATE SERVICE END TIME
//////////////////////////////////////////////////////

export const calculateEndTime = ({
  startTime,

  duration,
}) => {

  const [
    hour,
    minute,
  ] = startTime.split(":");

  const totalMinutes =
    Number(hour) * 60 +
    Number(minute) +
    duration;

  const endHour =
    Math.floor(
      totalMinutes / 60
    );

  const endMinute =
    totalMinutes % 60;

  return `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
};

//////////////////////////////////////////////////////
// CHECK SLOT RANGE AVAILABLE
//////////////////////////////////////////////////////

export const isSlotRangeAvailable = ({
  slots = [],

  startTime,

  duration,

  interval = 15,
}) => {

  const neededSlots =
    duration / interval;

  const startIndex =
    slots.findIndex(
      slot =>
        slot.time === startTime
    );

  if (startIndex === -1) {
    return false;
  }

  for (
    let i = 0;
    i < neededSlots;
    i++
  ) {

    const slot =
      slots[startIndex + i];

    if (
      !slot ||
      !slot.available
    ) {
      return false;
    }
  }

  return true;
};

//////////////////////////////////////////////////////
// FIND NEAREST AVAILABLE SLOT
//////////////////////////////////////////////////////

export const findNearestAvailableSlot = ({
  slots = [],

  targetTime,

  duration,

  interval = 15,

  maxAdjustment = 10,
}) => {

  const adjustments = [
    -10,
    -5,
    0,
    5,
    10,
  ];

  const [
    hour,
    minute,
  ] = targetTime.split(":");

  const targetMinutes =
    Number(hour) * 60 +
    Number(minute);

  for (
    const adjustment
    of adjustments
  ) {

    if (
      Math.abs(adjustment)
      > maxAdjustment
    ) {
      continue;
    }

    const adjustedMinutes =
      targetMinutes +
      adjustment;

    const adjustedHour =
      Math.floor(
        adjustedMinutes / 60
      );

    const adjustedMinute =
      adjustedMinutes % 60;

    const adjustedTime =
      `${String(adjustedHour).padStart(2, "0")}:${String(adjustedMinute).padStart(2, "0")}`;

    const available =
      isSlotRangeAvailable({
        slots,
        startTime:
          adjustedTime,
        duration,
        interval,
      });

    if (available) {

      return {
        found: true,

        adjustedTime,

        adjustment,
      };
    }
  }

  return {
    found: false,
  };
};