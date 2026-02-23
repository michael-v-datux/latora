/**
 * skillScoring.js — Adaptive Language Engine (ALE) skill profile logic
 *
 * Each word belongs to 1–4 linguistic factor categories:
 *   frequency  → frequency_band (1=common … 5=rare)
 *   polysemy   → polysemy_level (1=single … 4=many meanings)
 *   morphology → morph_complexity (1=simple … 4=complex)
 *   idiom      → phrase_flag (boolean) OR translation_kind = 'idiomatic'
 *
 * After every practice answer we update user_skill_profile via EMA:
 *   new_score = old_score * (1 - α) + signal * α
 * where:
 *   signal = +DELTA on correct answer, -DELTA on wrong answer
 *   α = 0.15  (recent answers weighted more)
 *   DELTA = 20 (step size — keeps range ~[-100, +100])
 *
 * Scores:
 *   < -15  → clear weakness (red)
 *   -15…15 → neutral / unknown (gray)
 *   > +15  → strength (green)
 */

const EMA_ALPHA = 0.15;  // smoothing factor
const DELTA     = 20;    // reward/penalty per answer
const MAX_SCORE = 100;
const MIN_SCORE = -100;

/**
 * Determine which skill factors a word belongs to.
 * Returns a Set of factor keys: 'frequency' | 'polysemy' | 'morphology' | 'idiom'
 *
 * @param {object} word  — row from `words` table
 * @returns {Set<string>}
 */
function wordFactors(word) {
  const factors = new Set();

  // Frequency: rare words (band 4–5) are a "frequency" weakness
  if (word.frequency_band != null && word.frequency_band >= 4) {
    factors.add("frequency");
  }

  // Polysemy: multiple meanings (level 3–4)
  if (word.polysemy_level != null && word.polysemy_level >= 3) {
    factors.add("polysemy");
  }

  // Morphology: complex grammar (level 3–4)
  if (word.morph_complexity != null && word.morph_complexity >= 3) {
    factors.add("morphology");
  }

  // Idiom: phrase_flag OR translation_kind contains 'idiom'
  const isIdiomKind =
    typeof word.translation_kind === "string" &&
    word.translation_kind.toLowerCase().includes("idiom");
  if (word.phrase_flag || isIdiomKind) {
    factors.add("idiom");
  }

  return factors;
}

/**
 * EMA step: clamp to [-100, +100].
 */
function emaStep(oldScore, isCorrect) {
  const signal = isCorrect ? DELTA : -DELTA;
  const newScore = oldScore * (1 - EMA_ALPHA) + signal * EMA_ALPHA;
  return Math.round(Math.max(MIN_SCORE, Math.min(MAX_SCORE, newScore)));
}

/**
 * Update user_skill_profile in Supabase after one practice answer.
 * Fire-and-forget friendly — call without await if needed.
 *
 * @param {object} supabase  — Supabase client with user auth
 * @param {string} userId
 * @param {string} wordId
 * @param {boolean} isCorrect
 */
async function updateSkillProfile(supabase, userId, wordId, isCorrect) {
  // 1. Fetch word factors
  const { data: word, error: wordErr } = await supabase
    .from("words")
    .select("frequency_band, polysemy_level, morph_complexity, phrase_flag, translation_kind")
    .eq("id", wordId)
    .single();

  if (wordErr || !word) return; // word not found → skip silently

  const factors = wordFactors(word);
  if (factors.size === 0) return; // word has no factor metadata → skip

  // 2. Get or create current skill profile
  const { data: profile } = await supabase
    .from("user_skill_profile")
    .select("frequency_score, polysemy_score, morph_score, idiom_score, total_updates")
    .eq("user_id", userId)
    .single();

  const current = profile || {
    frequency_score: 0,
    polysemy_score:  0,
    morph_score:     0,
    idiom_score:     0,
    total_updates:   0,
  };

  // 3. Apply EMA update for each factor this word belongs to
  const updates = { total_updates: current.total_updates + 1, updated_at: new Date().toISOString() };

  if (factors.has("frequency")) {
    updates.frequency_score = emaStep(current.frequency_score, isCorrect);
  }
  if (factors.has("polysemy")) {
    updates.polysemy_score = emaStep(current.polysemy_score, isCorrect);
  }
  if (factors.has("morphology")) {
    updates.morph_score = emaStep(current.morph_score, isCorrect);
  }
  if (factors.has("idiom")) {
    updates.idiom_score = emaStep(current.idiom_score, isCorrect);
  }

  // 4. Upsert
  await supabase
    .from("user_skill_profile")
    .upsert({ user_id: userId, ...updates }, { onConflict: "user_id" });
}

/**
 * Get the dominant weakness factor for a user (lowest score below threshold).
 * Returns { factor: string|null, score: number }
 */
function dominantWeakness(profile) {
  if (!profile) return { factor: null, score: 0 };

  const factors = [
    { key: "frequency",  score: profile.frequency_score ?? 0 },
    { key: "polysemy",   score: profile.polysemy_score  ?? 0 },
    { key: "morphology", score: profile.morph_score     ?? 0 },
    { key: "idiom",      score: profile.idiom_score     ?? 0 },
  ];

  const weaknesses = factors.filter(f => f.score < -10).sort((a, b) => a.score - b.score);
  return weaknesses.length > 0 ? weaknesses[0] : { factor: null, score: 0 };
}

/**
 * Build a DB filter predicate to target words that match a weakness factor.
 * Returns an object { column, op, value } or null if no targeting needed.
 */
function weaknessFilter(factor) {
  switch (factor) {
    case "frequency":  return { column: "frequency_band",   op: "gte", value: 4 };
    case "polysemy":   return { column: "polysemy_level",   op: "gte", value: 3 };
    case "morphology": return { column: "morph_complexity", op: "gte", value: 3 };
    case "idiom":      return { column: "phrase_flag",      op: "eq",  value: true };
    default:           return null;
  }
}

module.exports = { wordFactors, updateSkillProfile, dominantWeakness, weaknessFilter };
