/**
 * MOCK PAYMENT CONTROLLER
 * Dev / Testing purpose only
 * Simulates successful payment like Zomato before booking
 */

export const mockPayment = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      });
    }

    // 🔒 Always success (mock)
    return res.json({
      success: true,
      paymentConfirmed: true,
      paymentRef: "MOCK_PAY_" + Date.now(),
      amount,
    });
  } catch (error) {
    console.error("MOCK PAYMENT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Mock payment failed",
    });
  }
};
