//////////////////////////////////////////////////////
// BUILD BOOKING PAYLOAD
//////////////////////////////////////////////////////

const buildBookingPayload = ({
  salon,

  barber,

  services = [],

  slotTime,

  bookingDate,

  adjustment = 0,
}) => {

  //////////////////////////////////////////////////////
  // TOTAL DURATION
  //////////////////////////////////////////////////////

  const totalDuration =
    services.reduce(

      (sum, service) =>
        sum +
        (
          service.duration || 0
        ),

      0
    );

  //////////////////////////////////////////////////////
  // TOTAL PRICE
  //////////////////////////////////////////////////////

  const totalPrice =
    services.reduce(

      (sum, service) =>
        sum +
        (
          service.price || 0
        ),

      0
    );

  //////////////////////////////////////////////////////
  // PAYLOAD
  //////////////////////////////////////////////////////

  return {

    salonId:
      salon?._id,

    barberId:
      barber?._id,

    services:
      services.map(
        service => ({
          serviceId:
            service._id,

          name:
            service.name,

          duration:
            service.duration,

          price:
            service.price,
        })
      ),

    bookingDate,

    slotTime,

    totalDuration,

    totalPrice,

    adjustment,

    createdAt:
      new Date()
        .toISOString(),
  };
};

export default buildBookingPayload;