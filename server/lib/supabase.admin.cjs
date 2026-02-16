const { createClient } = require("@supabase/supabase-js");

// Admin client (service role) — ONLY for server-side usage.
// Bypasses RLS, so keep the key secret and never ship it to the mobile app.

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!supabaseUrl) {
  throw new Error("Missing SUPABASE_URL in server env");
}
if (!serviceKey) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in server env");
}

module.exports = createClient(supabaseUrl, serviceKey, {
  auth: {
    detectSessionInUrl: false,
    persistSession: false,
    autoRefreshToken: false,
  },
});
