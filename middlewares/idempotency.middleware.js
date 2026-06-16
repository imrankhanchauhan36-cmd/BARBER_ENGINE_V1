const store = new Map();

export const idempotency = (req, res, next) => {
  const key = req.headers["idempotency-key"];
  const userId = req.user?._id?.toString() || "guest";

  if (!key) return next();

  const finalKey = `${userId}:${key}`;

  //////////////////////////////////////////////////////////
  // 🔁 DUPLICATE REQUEST
  //////////////////////////////////////////////////////////

  if (store.has(finalKey)) {
    const cached = store.get(finalKey);

    return res.status(200).json({
      success: true,
      cached: true,
      data: cached,
    });
  }

  //////////////////////////////////////////////////////////
  // 📦 OVERRIDE RESPONSE SEND
  //////////////////////////////////////////////////////////

  const originalJson = res.json.bind(res);

  res.json = (body) => {
    store.set(finalKey, body);

    setTimeout(() => {
      store.delete(finalKey);
    }, 2 * 60 * 1000);

    return originalJson(body);
  };

  next();
};