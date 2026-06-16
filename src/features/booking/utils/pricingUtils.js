//////////////////////////////////////////////////////
// CALCULATE SUBTOTAL
//////////////////////////////////////////////////////

export const calculateSubtotal =
  (services = []) => {

    return services.reduce(

      (sum, service) =>
        sum +
        (
          service.price || 0
        ),

      0
    );
};

//////////////////////////////////////////////////////
// CALCULATE GST
//////////////////////////////////////////////////////

export const calculateGST = (
  amount,

  gstPercent = 18
) => {

  return (
    amount *
    gstPercent
  ) / 100;
};

//////////////////////////////////////////////////////
// PLATFORM FEE
//////////////////////////////////////////////////////

export const calculatePlatformFee =
  (
    amount
  ) => {

    ////////////////////////////////////////////////////
    // FUTURE LOGIC POSSIBLE
    ////////////////////////////////////////////////////

    if (amount < 500) {
      return 20;
    }

    return 0;
};

//////////////////////////////////////////////////////
// APPLY DISCOUNT
//////////////////////////////////////////////////////

export const applyDiscount = (
  amount,

  discount = 0
) => {

  return Math.max(
    amount - discount,
    0
  );
};

//////////////////////////////////////////////////////
// FINAL PRICE BREAKDOWN
//////////////////////////////////////////////////////

export const calculateFinalPricing =
  ({
    services = [],

    discount = 0,

    gstPercent = 18,
  }) => {

    const subtotal =
      calculateSubtotal(
        services
      );

    const discountedAmount =
      applyDiscount(
        subtotal,
        discount
      );

    const gst =
      calculateGST(
        discountedAmount,
        gstPercent
      );

    const platformFee =
      calculatePlatformFee(
        discountedAmount
      );

    const total =
      discountedAmount +
      gst +
      platformFee;

    return {
      subtotal,

      discount,

      discountedAmount,

      gst,

      platformFee,

      total,
    };
};