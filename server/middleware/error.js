module.exports = function errorHandler(err, req, res, next) {
  console.error("❌", err);
  res.status(500).json({ error: err.message || "Server error" });
};