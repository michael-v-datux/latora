/**
 * middleware/optionalAuth.js — Опціональна аутентифікація для публічних маршрутів
 *
 * На відміну від requireAuth, цей middleware НЕ повертає 401 якщо токена нема.
 * Якщо токен є і валідний — заповнює req.user, req.supabase, req.subscriptionPlan.
 * Якщо токена нема або він невалідний — просто викликає next() без помилки.
 *
 * Використовується для /api/translate щоб:
 *  - Анонімні запити отримують Free ліміт (3 альтернативи)
 *  - Авторизовані Pro-юзери отримують більший ліміт (7 альтернатив)
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return next();
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return next(); // токен невалідний — ігноруємо, продовжуємо як анонім
    }

    req.user = data.user;
    req.supabase = supabase;

    // Отримуємо план підписки + AI usage counters
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_plan, ai_requests_today, ai_reset_date')
      .eq('id', data.user.id)
      .single();

    const plan        = profile?.subscription_plan || 'free';
    const todayUTC    = new Date().toISOString().slice(0, 10);
    const resetNeeded = !profile?.ai_reset_date || profile.ai_reset_date !== todayUTC;

    req.subscriptionPlan = plan;
    req.aiUsageToday     = resetNeeded ? 0 : (profile?.ai_requests_today ?? 0);
    req.aiResetDate      = profile?.ai_reset_date ?? null;

  } catch (e) {
    // Будь-яка помилка — ігноруємо, продовжуємо як анонім
  }

  return next();
};
