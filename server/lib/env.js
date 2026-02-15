function required(name) {
  const val = (process.env[name] || "").trim();
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
}

module.exports = {
  PORT: process.env.PORT || 3001,
  SUPABASE_URL: required("SUPABASE_URL"),
  SUPABASE_ANON_KEY: required("SUPABASE_ANON_KEY"),
  DEEPL_API_KEY: required("DEEPL_API_KEY"),
  // якщо використовуєш Anthropic у difficulty:
  // ANTHROPIC_API_KEY: required("ANTHROPIC_API_KEY"),
};