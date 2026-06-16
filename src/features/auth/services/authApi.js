import client from "../../../shared/api/client";

//////////////////////////////////////////////////////
// LOGIN
//////////////////////////////////////////////////////

export const loginUser = async (
  payload
) => {

  const response =
    await client.post(
      "/auth/login",
      payload
    );

  return response.data;
};

//////////////////////////////////////////////////////
// VERIFY OTP
//////////////////////////////////////////////////////

export const verifyOtp = async (
  payload
) => {

  const response =
    await client.post(
      "/auth/verify-otp",
      payload
    );

  return response.data;
};

//////////////////////////////////////////////////////
// GET CURRENT USER
//////////////////////////////////////////////////////

export const getCurrentUser =
  async () => {

    const response =
      await client.get(
        "/users/me"
      );

    return response.data;
};