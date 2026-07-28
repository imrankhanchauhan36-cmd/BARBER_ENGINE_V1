// Deterministic customer-facing ID from a Mongo ObjectId — the single
// canonical source for every "friendly ID" shown anywhere in the app
// (booking, transaction, wallet). Previously duplicated inline in
// booking.controller.js and WalletTransactionDetailScreen.js "kept in
// sync manually" — consolidated here so there's exactly one algorithm.
export const toFriendlyId = (objectId, prefix) => {
  if (!objectId) return null;
  const idStr = objectId.toString();
  const timestampHex = idStr.substring(0, 8);
  const createdAt = new Date(parseInt(timestampHex, 16) * 1000);
  const yymm = `${String(createdAt.getFullYear()).slice(2)}${String(createdAt.getMonth() + 1).padStart(2, "0")}`;
  const suffix = idStr.slice(-4).toUpperCase();
  return `${prefix}${yymm}${suffix}`;
};
