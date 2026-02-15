const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseKey = (process.env.SUPABASE_ANON_KEY || "").trim();

if (!supabaseUrl) throw new Error("Missing SUPABASE_URL in server env");
if (!supabaseKey) throw new Error("Missing SUPABASE_ANON_KEY in server env");

module.exports = createClient(supabaseUrl, supabaseKey);