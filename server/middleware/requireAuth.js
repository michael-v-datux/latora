/**
 * middleware/requireAuth.js — Перевірка Bearer JWT (Supabase Auth) для API.
 *
 * Очікує заголовок: Authorization: Bearer <access_token>
 * Додає:
 *   - req.user         (Supabase user)
 *   - req.supabase     (Supabase client з підставленим токеном, щоб працював RLS через auth.uid())
 *   - req.supabaseAdmin (Supabase service-role client — тільки для privileged ops як deleteUser)
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Admin client (singleton) — only if SERVICE_ROLE_KEY is configured
let _adminClient = null;
function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!_adminClient) {
    _adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _adminClient;
}

module.exports = async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Не авторизовано" });
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: "Server misconfigured: SUPABASE_* env missing" });
    }

    // Supabase client "під користувача" (RLS працює через JWT)
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return res.status(401).json({ error: "Не авторизовано" });
    }

    req.user         = data.user;
    req.supabase     = supabase;
    req.supabaseAdmin = getAdminClient(); // null if SERVICE_ROLE_KEY not set
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Не авторизовано" });
  }
};
