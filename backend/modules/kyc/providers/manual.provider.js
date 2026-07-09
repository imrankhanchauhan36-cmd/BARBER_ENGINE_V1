/**
 * BARBER ENGINE V1
 * backend/modules/kyc/providers/manual.provider.js
 * Manual Verification Provider — Phase 6B
 * Used when admin manually verifies PAN/Aadhaar/Bank
 */

import { VERIFICATION_SOURCE, VERIFICATION_STATUS } from "../constants/kyc.constants.js";

/**
 * Verify PAN manually
 * Admin confirms PAN number is correct
 */
export const verifyPANManual = async ({ panNumber, name }) => {
  // Basic PAN format validation: ABCDE1234F
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panRegex.test(panNumber)) {
    return {
      success: false,
      source:  VERIFICATION_SOURCE.MANUAL,
      status:  VERIFICATION_STATUS.FAILED,
      remarks: "Invalid PAN format. Expected: ABCDE1234F",
      data:    null,
    };
  }

  return {
    success:    true,
    source:     VERIFICATION_SOURCE.MANUAL,
    status:     VERIFICATION_STATUS.VERIFIED,
    remarks:    `PAN manually verified by admin`,
    data: {
      panNumber,
      nameOnPAN:   name   ?? null,
      verifiedAt:  new Date(),
    },
  };
};

/**
 * Verify Aadhaar manually
 * Admin confirms last 4 digits match
 */
export const verifyAadhaarManual = async ({ last4 }) => {
  if (!/^\d{4}$/.test(last4)) {
    return {
      success: false,
      source:  VERIFICATION_SOURCE.MANUAL,
      status:  VERIFICATION_STATUS.FAILED,
      remarks: "Invalid Aadhaar last 4 digits",
      data:    null,
    };
  }

  return {
    success: true,
    source:  VERIFICATION_SOURCE.MANUAL,
    status:  VERIFICATION_STATUS.VERIFIED,
    remarks: `Aadhaar manually verified by admin (last 4: ${last4})`,
    data:    { last4, verifiedAt: new Date() },
  };
};

/**
 * Verify Bank manually
 * Admin confirms bank details are correct
 */
export const verifyBankManual = async ({ accountNumber, ifsc, bankName, accountHolder }) => {
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  if (!ifscRegex.test(ifsc)) {
    return {
      success: false,
      source:  VERIFICATION_SOURCE.MANUAL,
      status:  VERIFICATION_STATUS.FAILED,
      remarks: "Invalid IFSC format. Expected: ABCD0123456",
      data:    null,
    };
  }

  return {
    success: true,
    source:  VERIFICATION_SOURCE.MANUAL,
    status:  VERIFICATION_STATUS.VERIFIED,
    remarks: `Bank manually verified by admin`,
    data: {
      accountHolder,
      ifsc,
      bankName,
      verifiedAt: new Date(),
    },
  };
};