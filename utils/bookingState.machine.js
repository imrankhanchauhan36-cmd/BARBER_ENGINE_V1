//////////////////////////////////////////////////////////////
// ✅ BOOKING STATUS
//////////////////////////////////////////////////////////////

export const BOOKING_STATUS = {
  HOLD:       "HOLD",
  CONFIRMED:  "CONFIRMED",
  CHECKED_IN: "CHECKED_IN",
  ONGOING:    "ONGOING",
  COMPLETED:  "COMPLETED",
  CANCELLED:  "CANCELLED",
  NO_SHOW:    "NO_SHOW",
  EXPIRED:    "EXPIRED",
};

//////////////////////////////////////////////////////////////
// ✅ CENTRAL TRANSITION RULES
//////////////////////////////////////////////////////////////

export const BOOKING_TRANSITIONS = {
  [BOOKING_STATUS.HOLD]: [
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.CANCELLED,
    BOOKING_STATUS.EXPIRED,
  ],
  [BOOKING_STATUS.CONFIRMED]: [
    BOOKING_STATUS.CHECKED_IN,
    BOOKING_STATUS.CANCELLED,
    BOOKING_STATUS.NO_SHOW,
  ],
  [BOOKING_STATUS.CHECKED_IN]: [
    BOOKING_STATUS.ONGOING,
    BOOKING_STATUS.CANCELLED,
  ],
  [BOOKING_STATUS.ONGOING]: [
    BOOKING_STATUS.COMPLETED,
  ],
  [BOOKING_STATUS.COMPLETED]: [],
  [BOOKING_STATUS.CANCELLED]: [],
  [BOOKING_STATUS.NO_SHOW]:   [],
  [BOOKING_STATUS.EXPIRED]:   [],
};

//////////////////////////////////////////////////////////////
// ✅ VALIDATE TRANSITION
//////////////////////////////////////////////////////////////

export const validateBookingTransition = (current, next) => {
  if (!BOOKING_TRANSITIONS[current]) {
    throw new Error(`Invalid current booking state: ${current}`);
  }

  if (current === next) {
    throw new Error(`Booking already in state: ${current}`);
  }

  const allowedTransitions = BOOKING_TRANSITIONS[current];

  if (!allowedTransitions.length) {
    throw new Error(`Booking is already in final state: ${current}`);
  }

  if (!allowedTransitions.includes(next)) {
    throw new Error(`Invalid booking transition: ${current} → ${next}`);
  }

  return true;
};

//////////////////////////////////////////////////////////////
// ✅ CENTRAL STATUS TRANSITION FUNCTION
//
// FIX: Added `session` parameter so mongoose session is passed
// to booking.save() — without this, checkInBooking's session
// was ignored and the status was never persisted to MongoDB.
//
// Also added booking.save() HERE so controllers don't need
// a separate save call after calling this function.
// Controllers that set extra fields (OTP, lockUntil etc.)
// must set them BEFORE calling this function.
//////////////////////////////////////////////////////////////

export const transitionBookingStatus = async ({
  booking,
  nextStatus,
  actor   = null,
  session = null,   // ← mongoose session for atomic writes
}) => {
  //////////////////////////////////////////////////////////
  // VALIDATE TRANSITION
  //////////////////////////////////////////////////////////
  validateBookingTransition(booking.status, nextStatus);

  //////////////////////////////////////////////////////////
  // UPDATE STATUS
  //////////////////////////////////////////////////////////
  booking.status          = nextStatus;
  booking.statusChangedAt = new Date();

  if (actor) {
    booking.statusChangedBy = actor;
  }

  //////////////////////////////////////////////////////////
  // PER-STATE TIMESTAMPS
  //////////////////////////////////////////////////////////
  if (nextStatus === BOOKING_STATUS.CHECKED_IN) {
    booking.checkedInAt = new Date();
  }

  if (nextStatus === BOOKING_STATUS.ONGOING) {
    booking.serviceStartedAt = new Date();
  }

  if (nextStatus === BOOKING_STATUS.COMPLETED) {
    booking.completedAt = new Date();
  }

  if (nextStatus === BOOKING_STATUS.NO_SHOW) {
    booking.noShowMarkedAt = new Date();
  }

  if (nextStatus === BOOKING_STATUS.CANCELLED) {
    booking.cancelledAt = new Date();
  }

  if (nextStatus === BOOKING_STATUS.EXPIRED) {
    booking.expiredAt = new Date();
  }

  //////////////////////////////////////////////////////////
  // PERSIST — with session if provided
  //////////////////////////////////////////////////////////
  if (session) {
    await booking.save({ session });
  } else {
    await booking.save();
  }

  return booking;
};