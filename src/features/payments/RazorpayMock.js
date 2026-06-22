export default {
  open: async (options) => ({
    razorpay_payment_id: "mock_pay_" + Date.now(),
    razorpay_order_id:   options.order_id,
    razorpay_signature:  "mock_signature",
  }),
};
