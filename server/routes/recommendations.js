/**
 * server/routes/recommendations.js — Lexum Recommendations Engine
 *
 * POST /api/recommendations/generate
 *   Body: { sourceLang, targetLang, mode, intent?, difficulty?, topic?, format?, count? }
 *   Returns: { runId, items: [...], strategy, poolSize, quotaUsed, quotaMax, quotaLeft }
 *
 * POST /api/recommendations/action
 *   Body: { itemId, action: 'added'|'hidden'|'skipped', listId? }
 *   Returns: { ok: true }
 *
 * GET /api/recommendations/quota
 *   Returns: { used, max, left, resetAt }
 *
 * Pipeline (strategy selection):
 *   pool ≥ 80  →  pure SQL scoring (no LLM cost)
 *   pool 20-79 →  SQL scoring + LLM fills the gap
 *   pool < 20  →  LLM generates all (SQL only for dedup)
 *
 * Cold-start tiers (user word count):
 *   < 10  words → foundation mode: LLM with no seed, just lang+CEFR
 *   10-29 words → hybrid seed: SQL seed + LLM
 *   30+   words → full system
 */

const express  = require('express');
const router   = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

const requireAuth            = require('../middleware/requireAuth');
const loadPlan               = require('../middleware/loadPlan');
const supabaseAdmin          = require('../lib/supabase.admin.cjs');
const { getEntitlements }    = require('../config/entitlements');

// ─── Anthropic ────────────────────────────────────────────────────────────────
let anthropic;
try {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
} catch (e) {
  console.warn('⚠️ [recommendations] Anthropic SDK not available');
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SQL_POOL_THRESHOLD   = 80;  // pool ≥ this → pure SQL
const HYBRID_POOL_MIN      = 20;  // pool ≥ this → hybrid (SQL + LLM top-up)
const FOUNDATION_THRESHOLD = 10;  // user words < this → foundation mode (LLM only)
const SEED_THRESHOLD       = 30;  // user words < this → seed hybrid

// reason_code priority label mapping (for UI)
const REASON_LABELS = {
  cefr_fit:       'Matches your level',
  topic_match:    'Matches your topic',
  high_frequency: 'High-frequency word',
  phrase_needed:  'You need more phrases',
  gap_fill:       'Fills a vocabulary gap',
  explore:        'Slightly above your level',
  llm_curated:    'AI-curated for you',
};

// ─── JSON parser (same as alternatives.js) ───────────────────────────────────
function parseClaudeJson(rawText) {
  if (!rawText || typeof rawText !== 'string') throw new Error('Empty response');
  let text = rawText.trim();

  if (text.includes('```')) {
    const s = text.indexOf('```');
    const e = text.indexOf('```', s + 3);
    if (s !== -1 && e > s) {
      let inner = text.slice(s + 3, e).trim();
      inner = inner.replace(/^json\s*/i, '').trim();
      text = inner;
    }
  }

  try { return JSON.parse(text); } catch (_) {}

  const arrStart = text.indexOf('[');
  const arrEnd   = text.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(text.slice(arrStart, arrEnd + 1)); } catch (_) {}
  }

  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s !== -1 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch (_) {}
  }

  throw new Error(`Not valid JSON: "${text.slice(0, 200)}"`);
}

// ─── Strategy selector ───────────────────────────────────────────────────────
/**
 * Decides how to build recommendations based on pool & user word count.
 * This is the central architectural decision — not scattered if/elses.
 *
 * @param {number} poolSize - SQL candidate count
 * @param {number} userWordCount - total words user has saved
 * @param {number} requested - how many recommendations user wants
 * @returns {{ mode: 'sql'|'hybrid'|'llm', sqlCount: number, llmCount: number }}
 */
function getRecommendationStrategy(poolSize, userWordCount, requested) {
  // Cold start: < FOUNDATION_THRESHOLD words → LLM does everything
  if (userWordCount < FOUNDATION_THRESHOLD) {
    return { mode: 'llm', sqlCount: 0, llmCount: requested };
  }

  // Small pool: fewer than HYBRID_POOL_MIN SQL candidates → LLM generates all
  if (poolSize < HYBRID_POOL_MIN) {
    return { mode: 'llm', sqlCount: 0, llmCount: requested };
  }

  // Large pool: enough SQL candidates → pure SQL scoring
  if (poolSize >= SQL_POOL_THRESHOLD) {
    return { mode: 'sql', sqlCount: requested, llmCount: 0 };
  }

  // Hybrid: SQL gives what it can, LLM fills the rest
  const sqlCount = Math.min(poolSize, Math.ceil(requested * 0.7));
  const llmCount = requested - sqlCount;
  return { mode: 'hybrid', sqlCount, llmCount };
}

// ─── CEFR helpers ────────────────────────────────────────────────────────────
const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function cefrStep(level, delta) {
  const idx = CEFR_ORDER.indexOf(level);
  if (idx === -1) return level;
  return CEFR_ORDER[Math.max(0, Math.min(CEFR_ORDER.length - 1, idx + delta))];
}

/**
 * Derives target CEFR range based on mode + difficulty intent.
 * Returns array of acceptable cefr_level values.
 */
function targetCefrLevels(dominantCefr, difficulty, mode, intent) {
  const base = dominantCefr || 'B1';

  if (mode === 'auto') {
    // Auto: same level + one step up
    return [base, cefrStep(base, 1)].filter(Boolean);
  }

  // Controlled + intent
  if (intent === 'focus') return [base];
  if (intent === 'explore') return [cefrStep(base, 1), cefrStep(base, 2)].filter(Boolean);

  // expand (default): current ± 1
  const lower = cefrStep(base, -1);
  const upper = cefrStep(base, 1);
  return Array.from(new Set([lower, base, upper]));
}

// ─── SQL candidate pool query ─────────────────────────────────────────────────
/**
 * Fetches candidates from `words` table that:
 * 1. Match source/target lang
 * 2. Match target CEFR levels
 * 3. Are NOT already in any of the user's lists (across all lists)
 * 4. Were NOT shown in a recommendation in the last 30 days
 * 5. Have confidence_score ≥ 60 (quality gate)
 *
 * Returns array of word rows scored by CEFR fit + frequency.
 */
async function fetchSqlCandidates(supabase, {
  userId, sourceLang, targetLang, cefrLevels, requested, alreadyShownIds,
}) {
  // Fetch user's existing word IDs (all lists) to exclude them
  const { data: userListWords } = await supabase
    .from('list_words')
    .select('word_id');

  const userWordIds = (userListWords || []).map(r => r.word_id).filter(Boolean);

  // Build the candidate query
  let query = supabaseAdmin
    .from('words')
    .select('id, original, translation, transcription, cefr_level, part_of_speech, phrase_flag, example_sentence_target, definition, definition_uk, frequency_band, base_score, confidence_score')
    .eq('source_lang', sourceLang)
    .eq('target_lang', targetLang)
    .in('cefr_level', cefrLevels)
    .gte('confidence_score', 60)
    .order('frequency_band', { ascending: true })  // lower band = more common = higher priority
    .order('base_score', { ascending: false })
    .limit(Math.min(requested * 5, 300)); // fetch more than needed for scoring

  // Exclude words already in user's lists
  if (userWordIds.length > 0) {
    query = query.not('id', 'in', `(${userWordIds.join(',')})`);
  }

  // Exclude recently shown words
  if (alreadyShownIds.length > 0) {
    query = query.not('id', 'in', `(${alreadyShownIds.join(',')})`);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('⚠️ [recommendations] SQL candidates error:', error.message);
    return [];
  }

  return data || [];
}

/**
 * Gets IDs of words shown to user in last 30 days via recommendations.
 */
async function getRecentlyShownWordIds(supabase, userId) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data } = await supabase
    .from('recommendation_items')
    .select('word_id')
    .eq('user_id', userId)
    .not('word_id', 'is', null)
    .gte('created_at', thirtyDaysAgo.toISOString());

  return (data || []).map(r => r.word_id).filter(Boolean);
}

/**
 * Score SQL candidates. Higher = better recommendation.
 * Factors: CEFR fit (primary level = 3pts, adjacent = 1pt) + frequency (band 1=5pts, 5=0pts)
 */
function scoreCandidates(candidates, primaryCefr) {
  return candidates.map(w => {
    let score = 0;

    // CEFR fit
    if (w.cefr_level === primaryCefr) score += 3;
    else score += 1;

    // Frequency (lower band = more common = better for learning)
    score += Math.max(0, 5 - (w.frequency_band || 3));

    // Confidence bonus
    score += (w.confidence_score || 50) >= 80 ? 1 : 0;

    // Phrase bonus (if format includes phrases)
    score += w.phrase_flag ? 0.5 : 0;

    return { ...w, _score: score };
  }).sort((a, b) => b._score - a._score);
}

// ─── LLM word generation ──────────────────────────────────────────────────────
/**
 * Generates vocabulary recommendations via Claude.
 * Used for: cold start, small pool, hybrid top-up.
 *
 * @param {object} opts
 * @param {string} opts.sourceLang
 * @param {string} opts.targetLang
 * @param {string[]} opts.cefrLevels
 * @param {number} opts.count
 * @param {string[]} opts.excludeOriginals - words to exclude (already in list)
 * @param {string} opts.seedWords - comma-separated user vocabulary sample (optional)
 * @param {string} opts.topic - optional topic hint
 * @param {string} opts.format - 'words' | 'phrases' | 'mixed'
 * @param {string} opts.intent - 'focus' | 'expand' | 'explore'
 * @param {boolean} opts.foundationMode - no seed, just lang+CEFR
 * @returns {Promise<Array>}
 */
async function generateLlmWords(opts) {
  if (!anthropic) return [];

  const {
    sourceLang, targetLang, cefrLevels, count, excludeOriginals = [],
    seedWords = '', topic = '', format = 'mixed', intent = 'expand',
    foundationMode = false,
  } = opts;

  const cefrStr = cefrLevels.join(', ');
  const formatHint = format === 'words' ? 'single words only'
    : format === 'phrases' ? 'multi-word expressions and phrases only'
    : '70% single words, 30% phrases and expressions';
  const topicHint = topic ? `\nFocus on the topic: "${topic}".` : '';
  const seedHint = foundationMode || !seedWords
    ? ''
    : `\nUser's current vocabulary sample (avoid suggesting already-known words): ${seedWords}`;
  const excludeHint = excludeOriginals.length > 0
    ? `\nDO NOT include any of these words: ${excludeOriginals.slice(0, 50).join(', ')}`
    : '';
  const intentHint = intent === 'focus'
    ? 'Focus on core, high-utility vocabulary the learner is likely to encounter daily.'
    : intent === 'explore'
    ? 'Include more advanced, less common words to push the learner beyond their comfort zone.'
    : 'Balance between familiar territory and slightly new vocabulary.';

  const prompt = `You are an expert ${sourceLang} language teacher recommending vocabulary to a learner.

Task: Generate exactly ${count} vocabulary items for a learner of ${sourceLang} whose native/study language is ${targetLang}.
CEFR target level(s): ${cefrStr}
Format preference: ${formatHint}${topicHint}
Intent: ${intentHint}${seedHint}${excludeHint}

Rules:
- Each item must be a realistic, useful vocabulary item a learner at this level would want to know
- Provide translation in ${targetLang}
- Include a short example sentence IN ${sourceLang} (the language being learned)
- reason_code must be one of: cefr_fit, topic_match, high_frequency, phrase_needed, gap_fill, explore, llm_curated
- phrase_flag: true if multi-word expression or idiom, false if single word

Respond ONLY with a valid JSON array of exactly ${count} items:
[
  {
    "original": "word or phrase in ${sourceLang}",
    "translation": "translation in ${targetLang}",
    "transcription": "phonetic transcription (optional, null if not needed)",
    "cefr_level": "A1|A2|B1|B2|C1|C2",
    "part_of_speech": "noun|verb|adjective|adverb|phrase|idiom|other",
    "phrase_flag": false,
    "example_sentence_target": "example sentence in ${sourceLang}",
    "definition": "short English definition (1 sentence)",
    "definition_uk": "short Ukrainian definition (1 sentence)",
    "reason_code": "cefr_fit"
  }
]`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0]?.text?.trim() || '[]';
    const parsed = parseClaudeJson(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(item => item && typeof item.original === 'string' && typeof item.translation === 'string')
      .slice(0, count)
      .map(item => ({
        original:               String(item.original || '').trim().toLowerCase(),
        translation:            String(item.translation || '').trim(),
        transcription:          item.transcription ? String(item.transcription).trim() : null,
        cefr_level:             String(item.cefr_level || cefrLevels[0] || 'B1').trim(),
        part_of_speech:         String(item.part_of_speech || 'other').trim(),
        phrase_flag:            Boolean(item.phrase_flag),
        example_sentence_target: item.example_sentence_target ? String(item.example_sentence_target).trim() : null,
        definition:             item.definition ? String(item.definition).trim() : null,
        definition_uk:          item.definition_uk ? String(item.definition_uk).trim() : null,
        reason_code:            String(item.reason_code || 'llm_curated').trim(),
        _source: 'llm',
      }));

  } catch (e) {
    console.warn('⚠️ [recommendations] LLM generation error:', e?.message || e);
    return [];
  }
}

/**
 * Saves LLM-generated words to recommendation_words table (dedup by original+langs).
 * Returns array of { rec_word_id, ...wordData } for use in recommendation_items.
 */
async function saveLlmWords(words, sourceLang, targetLang) {
  const results = [];

  for (const word of words) {
    try {
      const { data, error } = await supabaseAdmin
        .from('recommendation_words')
        .upsert({
          source_lang:             sourceLang,
          target_lang:             targetLang,
          original:                word.original,
          translation:             word.translation,
          transcription:           word.transcription,
          cefr_level:              word.cefr_level,
          part_of_speech:          word.part_of_speech,
          phrase_flag:             word.phrase_flag,
          example_sentence_target: word.example_sentence_target,
          definition:              word.definition,
          definition_uk:           word.definition_uk,
          trust_level:             'provisional',
        }, { onConflict: 'source_lang,target_lang,original' })
        .select('id')
        .single();

      if (!error && data) {
        results.push({ rec_word_id: data.id, ...word });
      }
    } catch (e) {
      console.warn('⚠️ [recommendations] saveLlmWords error:', e?.message);
    }
  }

  return results;
}

// ─── Quota helpers ────────────────────────────────────────────────────────────
/**
 * Returns current rec quota state for the user.
 * Handles daily reset.
 */
async function getRecQuota(supabase, userId, plan) {
  const ent = getEntitlements(plan);
  const todayUTC = new Date().toISOString().slice(0, 10);

  const { data } = await supabase
    .from('profiles')
    .select('rec_requests_today, rec_reset_date')
    .eq('id', userId)
    .single();

  const resetNeeded = !data?.rec_reset_date || data.rec_reset_date !== todayUTC;
  const used = resetNeeded ? 0 : (data?.rec_requests_today ?? 0);

  return { used, max: ent.maxRecsPerDay, resetNeeded, todayUTC };
}

/**
 * Increments rec counter (fire-and-forget).
 */
function incrementRecQuota(userId, newCount, todayUTC) {
  supabaseAdmin
    .from('profiles')
    .update({ rec_requests_today: newCount, rec_reset_date: todayUTC })
    .eq('id', userId)
    .then(({ error }) => {
      if (error) console.warn('⚠️ [recommendations] quota increment failed:', error.message);
    });
}

// ─── GET /api/recommendations/quota ──────────────────────────────────────────
router.get('/recommendations/quota', requireAuth, loadPlan, async (req, res, next) => {
  try {
    const { used, max } = await getRecQuota(req.supabase, req.user.id, req.plan);
    const nextMidnight = new Date();
    nextMidnight.setUTCHours(24, 0, 0, 0);

    return res.json({
      used,
      max,
      left: Math.max(0, max - used),
      resetAt: nextMidnight.toISOString(),
      plan: req.plan,
    });
  } catch (e) {
    return next(e);
  }
});

// ─── POST /api/recommendations/generate ──────────────────────────────────────
router.post('/recommendations/generate', requireAuth, loadPlan, async (req, res, next) => {
  try {
    const {
      sourceLang,
      targetLang,
      mode = 'auto',
      intent = 'expand',
      difficulty = 'same',
      topic = '',
      format = 'mixed',
      count: requestedCount,
    } = req.body;

    // Validate required params
    if (!sourceLang || !targetLang) {
      return res.status(400).json({ error: 'sourceLang and targetLang are required' });
    }

    const src = String(sourceLang).trim().toUpperCase();
    const tgt = String(targetLang).trim().toUpperCase();

    const ent = req.entitlements;

    // ── Quota check ──────────────────────────────────────────────────────────
    const { used, max, resetNeeded, todayUTC } = await getRecQuota(req.supabase, req.user.id, req.plan);
    const available = Math.max(0, max - used);

    if (available <= 0) {
      const nextMidnight = new Date();
      nextMidnight.setUTCHours(24, 0, 0, 0);
      return res.status(429).json({
        error: `Daily recommendation limit reached (${max}/day on ${req.plan} plan).`,
        errorCode: 'REC_LIMIT_REACHED',
        limit: max,
        used,
        plan: req.plan,
        resetAt: nextMidnight.toISOString(),
      });
    }

    // Clamp requested count to available quota
    const requested = Math.min(
      Math.max(1, parseInt(requestedCount, 10) || 5),
      available,
      ent.maxRecsPerDay
    );

    // ── Fetch user's word count (for cold-start detection) ───────────────────
    const { count: userWordCount } = await req.supabase
      .from('list_words')
      .select('word_id', { count: 'exact', head: true });

    // ── Determine dominant CEFR (from user's vocabulary) ────────────────────
    let dominantCefr = 'B1';
    if ((userWordCount || 0) >= FOUNDATION_THRESHOLD) {
      // Count words per CEFR level, pick the most common
      const { data: cefrCounts } = await supabaseAdmin
        .from('list_words')
        .select('words(cefr_level)')
        .in('list_id',
          // Get user's list IDs via RLS-scoped supabase
          (await req.supabase.from('lists').select('id').then(r => (r.data || []).map(l => l.id)))
        );

      const counts = {};
      for (const row of (cefrCounts || [])) {
        const lvl = row.words?.cefr_level;
        if (lvl) counts[lvl] = (counts[lvl] || 0) + 1;
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) dominantCefr = sorted[0][0];
    }

    // ── Target CEFR levels based on mode + difficulty ────────────────────────
    let adjustedCefr = dominantCefr;
    if (difficulty === 'easier') adjustedCefr = cefrStep(dominantCefr, -1);
    if (difficulty === 'harder') adjustedCefr = cefrStep(dominantCefr, 1);

    const cefrLevels = targetCefrLevels(adjustedCefr, difficulty, mode, intent);

    // ── Get recently shown word IDs (dedup) ──────────────────────────────────
    const recentlyShownIds = await getRecentlyShownWordIds(req.supabase, req.user.id);

    // ── Fetch SQL candidates ─────────────────────────────────────────────────
    const sqlCandidates = await fetchSqlCandidates(req.supabase, {
      userId:         req.user.id,
      sourceLang:     src,
      targetLang:     tgt,
      cefrLevels,
      requested,
      alreadyShownIds: recentlyShownIds,
    });

    // ── Determine strategy ───────────────────────────────────────────────────
    const strategy = getRecommendationStrategy(sqlCandidates.length, userWordCount || 0, requested);
    console.log(`📊 [recommendations] strategy=${strategy.mode} pool=${sqlCandidates.length} userWords=${userWordCount} requested=${requested}`);

    // ── Build recommendations ─────────────────────────────────────────────────
    const items = [];

    // SQL portion
    if (strategy.sqlCount > 0) {
      const scored = scoreCandidates(sqlCandidates, adjustedCefr);
      const sqlPick = scored.slice(0, strategy.sqlCount);

      for (const w of sqlPick) {
        items.push({
          word_id:      w.id,
          rec_word_id:  null,
          original:     w.original,
          translation:  w.translation,
          transcription: w.transcription,
          cefr_level:   w.cefr_level,
          part_of_speech: w.part_of_speech,
          phrase_flag:  w.phrase_flag,
          example_sentence_target: w.example_sentence_target,
          definition:   w.definition,
          definition_uk: w.definition_uk,
          reason_code:  w.phrase_flag ? 'phrase_needed' : 'cefr_fit',
          score:        Math.round(w._score * 10),
          _source:      'sql',
        });
      }
    }

    // LLM portion
    if (strategy.llmCount > 0) {
      // Build seed from user's words (sample of originals)
      let seedWords = '';
      if ((userWordCount || 0) >= FOUNDATION_THRESHOLD && (userWordCount || 0) < SEED_THRESHOLD) {
        const { data: userWords } = await req.supabase
          .from('list_words')
          .select('words(original)')
          .limit(20);
        seedWords = (userWords || [])
          .map(r => r.words?.original)
          .filter(Boolean)
          .join(', ');
      }

      const excludeOriginals = items.map(i => i.original);
      const foundationMode = (userWordCount || 0) < FOUNDATION_THRESHOLD;

      const llmWords = await generateLlmWords({
        sourceLang: src,
        targetLang: tgt,
        cefrLevels,
        count: strategy.llmCount,
        excludeOriginals,
        seedWords,
        topic,
        format,
        intent: mode === 'controlled' ? intent : 'expand',
        foundationMode,
      });

      if (llmWords.length > 0) {
        const savedLlm = await saveLlmWords(llmWords, src, tgt);
        for (const w of savedLlm) {
          items.push({
            word_id:      null,
            rec_word_id:  w.rec_word_id,
            original:     w.original,
            translation:  w.translation,
            transcription: w.transcription,
            cefr_level:   w.cefr_level,
            part_of_speech: w.part_of_speech,
            phrase_flag:  w.phrase_flag,
            example_sentence_target: w.example_sentence_target,
            definition:   w.definition,
            definition_uk: w.definition_uk,
            reason_code:  w.reason_code || 'llm_curated',
            score:        50,
            _source:      'llm',
          });
        }
      }
    }

    // ── Save run to DB ────────────────────────────────────────────────────────
    const { data: run, error: runErr } = await supabaseAdmin
      .from('recommendation_runs')
      .insert({
        user_id:         req.user.id,
        source_lang:     src,
        target_lang:     tgt,
        mode,
        intent:          mode === 'controlled' ? intent : null,
        difficulty:      mode === 'controlled' ? difficulty : null,
        topic:           topic || null,
        format:          mode === 'controlled' ? format : null,
        requested_count: requested,
        strategy:        strategy.mode,
        pool_size:       sqlCandidates.length,
        sql_count:       items.filter(i => i._source === 'sql').length,
        llm_count:       items.filter(i => i._source === 'llm').length,
      })
      .select('id')
      .single();

    if (runErr) {
      console.error('❌ [recommendations] Failed to save run:', runErr.message);
      // Continue — don't fail the whole request over a logging failure
    }

    const runId = run?.id;

    // ── Save items to DB ──────────────────────────────────────────────────────
    let savedItems = [];
    if (runId && items.length > 0) {
      const itemRows = items.map((item, idx) => ({
        run_id:                  runId,
        user_id:                 req.user.id,
        word_id:                 item.word_id || null,
        rec_word_id:             item.rec_word_id || null,
        source_lang:             src,   // denormalized — avoids run join in action endpoint
        target_lang:             tgt,
        original:                item.original,
        translation:             item.translation,
        transcription:           item.transcription || null,
        cefr_level:              item.cefr_level || null,
        part_of_speech:          item.part_of_speech || null,
        phrase_flag:             item.phrase_flag || false,
        example_sentence_target: item.example_sentence_target || null,
        definition:              item.definition || null,
        definition_uk:           item.definition_uk || null,
        reason_code:             item.reason_code || 'cefr_fit',
        score:                   item.score || 50,
        rank_position:           idx + 1,
      }));

      const { data: inserted, error: itemErr } = await supabaseAdmin
        .from('recommendation_items')
        .insert(itemRows)
        .select('id, word_id, rec_word_id, original, translation, transcription, cefr_level, part_of_speech, phrase_flag, example_sentence_target, definition, definition_uk, reason_code, score, rank_position');

      if (itemErr) {
        console.error('❌ [recommendations] Failed to save items:', itemErr.message);
      } else {
        savedItems = inserted || [];
      }
    }

    // ── Increment quota (fire-and-forget) ─────────────────────────────────────
    const actualCount = savedItems.length || items.length;
    if (actualCount > 0) {
      const newUsed = (resetNeeded ? 0 : used) + actualCount;
      incrementRecQuota(req.user.id, newUsed, todayUTC);
    }

    // ── Build response ────────────────────────────────────────────────────────
    const responseItems = (savedItems.length > 0 ? savedItems : items).map(item => ({
      id:            item.id || null,
      wordId:        item.word_id || null,
      recWordId:     item.rec_word_id || null,
      original:      item.original,
      translation:   item.translation,
      transcription: item.transcription || null,
      cefrLevel:     item.cefr_level || null,
      partOfSpeech:  item.part_of_speech || null,
      phraseFlag:    item.phrase_flag || false,
      exampleSentence: item.example_sentence_target || null,
      definition:    item.definition || null,
      definitionUk:  item.definition_uk || null,
      reasonCode:    item.reason_code || 'cefr_fit',
      reasonLabel:   REASON_LABELS[item.reason_code] || 'Recommended for you',
      score:         item.score || 50,
      rankPosition:  item.rank_position || 0,
      userAction:    'pending',
    }));

    return res.json({
      runId,
      items: responseItems,
      strategy:  strategy.mode,
      poolSize:  sqlCandidates.length,
      quotaUsed: (resetNeeded ? 0 : used) + actualCount,
      quotaMax:  max,
      quotaLeft: Math.max(0, max - used - actualCount),
      plan:      req.plan,
    });

  } catch (e) {
    console.error('❌ [recommendations] generate error:', e.message, e.stack);
    return next(e);
  }
});

// ─── POST /api/recommendations/action ────────────────────────────────────────
router.post('/recommendations/action', requireAuth, async (req, res, next) => {
  try {
    const { itemId, action, listId } = req.body;

    if (!itemId) return res.status(400).json({ error: 'itemId is required' });
    if (!['added', 'hidden', 'skipped'].includes(action)) {
      return res.status(400).json({ error: 'action must be added|hidden|skipped' });
    }

    // Fetch the recommendation item (verify ownership + get word refs + denormalized langs)
    const { data: item, error: fetchErr } = await supabaseAdmin
      .from('recommendation_items')
      .select('id, user_id, word_id, rec_word_id, source_lang, target_lang, original, translation, transcription, cefr_level, part_of_speech, phrase_flag, example_sentence_target, definition, definition_uk')
      .eq('id', itemId)
      .eq('user_id', req.user.id) // ownership check
      .single();

    if (fetchErr || !item) {
      return res.status(404).json({ error: 'Recommendation item not found' });
    }

    let resolvedWordId = item.word_id || null;

    // ── LLM word promotion ────────────────────────────────────────────────────
    // If action is 'added' and this is an LLM-generated word (rec_word_id, no word_id),
    // promote it to the global `words` table so it can be added to a list.
    if (action === 'added' && listId && !item.word_id && item.rec_word_id) {
      // Fetch full word data from recommendation_words
      const { data: recWord, error: recWordErr } = await supabaseAdmin
        .from('recommendation_words')
        .select('*')
        .eq('id', item.rec_word_id)
        .single();

      if (recWord && !recWordErr) {
        // source/target lang is denormalized onto the item — no run join needed
        const srcLang = item.source_lang || recWord.source_lang;
        const tgtLang = item.target_lang || recWord.target_lang;

        // Insert into `words` table — ignore conflict if an existing row (e.g. source='translated') already has this word.
        // ignoreDuplicates: true prevents overwriting a high-quality 'translated' row with 'promoted' data.
        const insertPayload = {
          source_lang:             srcLang,
          target_lang:             tgtLang,
          original:                recWord.original,
          translation:             recWord.translation,
          transcription:           recWord.transcription || null,
          cefr_level:              recWord.cefr_level || 'B1',
          part_of_speech:          recWord.part_of_speech || 'other',
          phrase_flag:             recWord.phrase_flag || false,
          example_sentence_target: recWord.example_sentence_target || null,
          definition:              recWord.definition || null,
          definition_uk:           recWord.definition_uk || null,
          frequency_band:          3,          // neutral default
          base_score:              50,
          confidence_score:        60,         // "provisional" quality gate
          source:                  'promoted', // LLM-generated, user-validated — excluded from translate cache
        };

        let { data: promoted, error: promoteErr } = await supabaseAdmin
          .from('words')
          .upsert(insertPayload, {
            onConflict: 'original,source_lang,target_lang,translation',
            ignoreDuplicates: true,  // never overwrite an existing 'translated' word with 'promoted'
          })
          .select('id')
          .single();

        // ignoreDuplicates returns null on conflict — fetch the existing row by unique key
        if (!promoted?.id) {
          const { data: existing } = await supabaseAdmin
            .from('words')
            .select('id')
            .eq('original', recWord.original)
            .eq('source_lang', srcLang)
            .eq('target_lang', tgtLang)
            .eq('translation', recWord.translation)
            .single();
          if (existing?.id) promoted = existing;
        }

        if (promoted?.id) {
          resolvedWordId = promoted.id;

          // Link the recommendation_item to its new word_id (so future references work)
          supabaseAdmin
            .from('recommendation_items')
            .update({ word_id: resolvedWordId })
            .eq('id', itemId)
            .then(() => {});

          // Increment add_count on recommendation_words (fire-and-forget)
          supabaseAdmin
            .from('recommendation_words')
            .update({ add_count: (recWord.add_count || 0) + 1 })
            .eq('id', item.rec_word_id)
            .then(() => {});
        } else {
          if (promoteErr) console.warn('⚠️ [recommendations] word promotion failed:', promoteErr.message);
          // Fall through — word won't be added to list this time, action is still recorded
        }
      }
    }

    // ── Add to list (for SQL words or newly promoted LLM words) ───────────────
    if (action === 'added' && listId && resolvedWordId) {
      // Use user-scoped supabase so RLS limits insertion to their own lists
      const { error: addErr } = await req.supabase
        .from('list_words')
        .upsert({
          list_id:  listId,
          word_id:  resolvedWordId,
        }, { onConflict: 'list_id,word_id', ignoreDuplicates: true });

      if (addErr) {
        console.warn('⚠️ [recommendations] list_words upsert failed:', addErr.message);
        // Non-fatal — still record the recommendation action
      }
    }

    // ── Update recommendation_items record ────────────────────────────────────
    const update = {
      user_action:  action,
      actioned_at:  new Date().toISOString(),
    };

    if (action === 'added' && listId) {
      update.added_to_list_id = listId;
    }

    await supabaseAdmin
      .from('recommendation_items')
      .update(update)
      .eq('id', itemId)
      .eq('user_id', req.user.id);

    return res.json({ ok: true, wordId: resolvedWordId });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
