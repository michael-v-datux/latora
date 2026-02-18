#!/usr/bin/env node
/**
 * server/scripts/backfill-difficulty-v2.js
 *
 * Backfill Difficulty Engine v2 fields для всіх слів у базі,
 * де base_score IS NULL (тобто ще не оброблено v2).
 *
 * Що робить:
 *   1. Завантажує слова пачками (BATCH_SIZE), де base_score IS NULL
 *   2. Для кожного слова — викликає assessDifficulty (без AI якщо --no-ai)
 *   3. Записує назад у таблицю words:
 *        base_score, ai_adjustment, confidence_score,
 *        frequency_band, polysemy_level, morph_complexity, phrase_flag,
 *        difficulty_score (FinalScore), cefr_level
 *
 * Використання:
 *   cd server
 *   node scripts/backfill-difficulty-v2.js           # з AI (повільно, платно)
 *   node scripts/backfill-difficulty-v2.js --no-ai   # тільки детерміновані компоненти (швидко)
 *   node scripts/backfill-difficulty-v2.js --limit 100 --no-ai
 *
 * Вимоги:
 *   .env з SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + ANTHROPIC_API_KEY (якщо AI)
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const supabase = require("../lib/supabase.admin.cjs");
const {
  assessDifficulty,
  cefrToNum,
  computeBaseScore,
  estimateFrequencyBand,
  estimatePolysemyLevel,
  morphComplexity,
  detectPhrase,
  scoreToCefr,
} = require("../services/difficulty");

// ─── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const NO_AI      = args.includes("--no-ai");
const LIMIT_ARG  = args.indexOf("--limit");
const MAX_WORDS  = LIMIT_ARG >= 0 ? parseInt(args[LIMIT_ARG + 1], 10) : Infinity;
const BATCH_SIZE = 50;
const AI_DELAY_MS = 600; // затримка між AI-запитами (rate limit)

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔧 Backfill Difficulty v2`);
  console.log(`   Mode:  ${NO_AI ? "deterministic only (no AI)" : "full (BaseScore + AI)"}`);
  console.log(`   Limit: ${isFinite(MAX_WORDS) ? MAX_WORDS : "all"}`);
  console.log(`   Batch: ${BATCH_SIZE}\n`);

  let offset = 0;
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  while (true) {
    if (processed >= MAX_WORDS) break;

    // Завантажуємо слова з NULL base_score
    const batchLimit = Math.min(BATCH_SIZE, MAX_WORDS - processed);

    const { data: words, error: fetchErr } = await supabase
      .from("words")
      .select("id, original, translation, cefr_level, source_lang, target_lang, part_of_speech")
      .is("base_score", null)
      .range(offset, offset + batchLimit - 1);

    if (fetchErr) {
      console.error("❌ Fetch error:", fetchErr.message);
      break;
    }

    if (!words || words.length === 0) {
      console.log("✅ No more words to process.");
      break;
    }

    console.log(`📦 Processing batch: offset=${offset}, count=${words.length}`);

    for (const word of words) {
      try {
        let payload;

        if (NO_AI) {
          // Детерміністичний режим — без AI
          const cefrNum      = cefrToNum(word.cefr_level) || 3;
          const freqBand     = estimateFrequencyBand(word.original);
          const polyLevel    = estimatePolysemyLevel(word.original, word.part_of_speech);
          const morphCx      = morphComplexity(word.original);
          const phrase       = detectPhrase(word.original);

          const baseScore = computeBaseScore({
            word:             word.original,
            cefrNum,
            frequencyBand:    freqBand,
            polysemyLevel:    polyLevel,
            morphComplexityVal: morphCx,
            phraseFlag:       phrase,
          });

          const finalScore = Math.min(100, Math.max(0, baseScore));

          payload = {
            base_score:       finalScore,
            ai_adjustment:    0,
            confidence_score: 40, // "Medium" за замовчуванням без AI
            frequency_band:   freqBand,
            polysemy_level:   polyLevel,
            morph_complexity: morphCx,
            phrase_flag:      phrase,
            difficulty_score: finalScore,
            cefr_level:       scoreToCefr(finalScore),
          };
        } else {
          // Повний режим — з AI
          const result = await assessDifficulty(
            word.original,
            word.translation,
            { sourceLang: word.source_lang, targetLang: word.target_lang }
          );
          payload = {
            base_score:       result.base_score,
            ai_adjustment:    result.ai_adjustment,
            confidence_score: result.confidence_score,
            frequency_band:   result.frequency_band,
            polysemy_level:   result.polysemy_level,
            morph_complexity: result.morph_complexity,
            phrase_flag:      result.phrase_flag,
            difficulty_score: result.difficulty_score,
            cefr_level:       result.cefr_level,
          };
          // Затримка між AI-запитами
          await sleep(AI_DELAY_MS);
        }

        const { error: updateErr } = await supabase
          .from("words")
          .update(payload)
          .eq("id", word.id);

        if (updateErr) {
          console.warn(`  ⚠️  ${word.original} (${word.id}): update failed — ${updateErr.message}`);
          errors++;
        } else {
          const cefrLabel = payload.cefr_level || '?';
          const scoreLabel = payload.difficulty_score ?? '?';
          const adjLabel = payload.ai_adjustment >= 0
            ? `+${payload.ai_adjustment}` : `${payload.ai_adjustment}`;
          console.log(
            `  ✓ ${word.original.padEnd(20)} ` +
            `${cefrLabel.padEnd(3)} score=${String(scoreLabel).padEnd(4)} ` +
            (NO_AI ? "" : `adj=${adjLabel.padEnd(4)} `) +
            `conf=${payload.confidence_score}`
          );
          processed++;
        }
      } catch (err) {
        console.warn(`  ✗ ${word.original} (${word.id}): ${err.message}`);
        errors++;
        // Не виходимо — продовжуємо наступне слово
      }
    }

    offset += words.length;

    if (words.length < batchLimit) {
      // Менше ніж очікували — досягли кінця
      break;
    }
  }

  console.log(`\n📊 Done.`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Errors:    ${errors}`);
  if (skipped > 0) console.log(`   Skipped:   ${skipped}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
