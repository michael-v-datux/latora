/**
 * srsService.js — SM-2 + Personal Modifier Layer v2
 *
 * Два рівні:
 *
 * 1. SM-2 (Spaced Repetition)  — незмінний: визначає КОЛИ повторити.
 *    Поля: ease_factor, interval_days, repetitions, next_review, last_result
 *
 * 2. Personal Modifier Layer   — визначає «наскільки важке слово ОСОБИСТО ДЛЯ ВАС».
 *    PersonalScore = FinalScore - familiarity_bonus + mistake_penalty + decay_penalty
 *    Поля: personal_score, word_state, trend_direction, wrong_count, correct_count
 *
 * 3. Word State Machine         — life-cycle слова з точки зору засвоєння.
 *    new → learning → stabilizing → mastered → decaying
 *
 * 4. Trend Engine              — порівняння якості останніх 3 відповідей з попередніми 3.
 */

// ─── SM-2 (незмінний) ────────────────────────────────────────────────────────

/**
 * Розрахувати наступний інтервал повторення (SM-2 алгоритм)
 *
 * @param {Object} progress — { ease_factor, interval_days, repetitions }
 * @param {string} quality  — 'easy' | 'good' | 'hard' | 'forgot'
 * @returns {Object}        — оновлений SM-2 прогрес
 */
export function calculateNextReview(progress, quality) {
  let { ease_factor = 2.5, interval_days = 0, repetitions = 0 } = progress;

  const qualityMap = { forgot: 0, hard: 3, good: 4, easy: 5 };
  const q = qualityMap[quality] ?? 0;

  if (q < 3) {
    // Забув — скидаємо прогрес, повторити сьогодні
    repetitions = 0;
    interval_days = 0;
  } else {
    if (repetitions === 0)      interval_days = 1;
    else if (repetitions === 1) interval_days = 6;
    else                        interval_days = Math.round(interval_days * ease_factor);
    repetitions += 1;
  }

  ease_factor = Math.max(
    1.3,
    ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  );

  const next_review = new Date();
  next_review.setDate(next_review.getDate() + interval_days);

  return {
    ease_factor:   Math.round(ease_factor * 100) / 100,
    interval_days,
    repetitions,
    next_review:   next_review.toISOString(),
    last_result:   quality,
  };
}

// ─── Word State Machine ───────────────────────────────────────────────────────

/**
 * Визначити стан слова на основі SM-2 прогресу та часу.
 *
 * Стани:
 *   new         — слово ще не повторювалось
 *   learning    — 1–2 повторення (нестабільне)
 *   stabilizing — 3–4 повторення (зміцнюється)
 *   mastered    — 5+ повторень з хорошим ease_factor та довгим інтервалом
 *   decaying    — було mastered, але не повторювалось занадто довго
 *
 * @param {{ repetitions, ease_factor, interval_days, next_review, last_result }} progress
 * @returns {'new'|'learning'|'stabilizing'|'mastered'|'decaying'}
 */
export function computeWordState(progress) {
  if (!progress || progress.repetitions == null) return 'new';

  const { repetitions = 0, ease_factor = 2.5, interval_days = 0, next_review, last_result } = progress;

  // Слово нове
  if (repetitions === 0) return 'new';

  // Забутий "mastered" → decaying
  if (repetitions >= 5 && ease_factor >= 2.3 && last_result === 'forgot') return 'decaying';

  // Давно не повторювалось (пропущено 14+ днів після due) → decaying
  if (repetitions >= 4 && next_review) {
    const overdueDays = (Date.now() - new Date(next_review).getTime()) / 86_400_000;
    if (overdueDays > 14) return 'decaying';
  }

  // Засвоєно: 5+ повторень, ease_factor ≥ 2.3, інтервал ≥ 21 день
  if (repetitions >= 5 && ease_factor >= 2.3 && interval_days >= 21) return 'mastered';

  // Стабілізується: 3–4 повторення
  if (repetitions >= 3) return 'stabilizing';

  // Вивчається: 1–2 повторення
  return 'learning';
}

// ─── Personal Modifier Layer ──────────────────────────────────────────────────

const FAMILIARITY_BONUS_MAX = 15;  // max знижка за знайомство
const MISTAKE_PENALTY_MAX   = 10;  // max штраф за помилки
const DECAY_PENALTY_MAX     = 8;   // max штраф за давнє невивчення

/**
 * familiarity_bonus: зниження складності за кількість успішних повторень
 */
function familiarityBonus(correctCount, repetitions) {
  const reps = Math.max(correctCount || 0, repetitions || 0);
  // Логарифмічне зниження: більше повторень → більший бонус, але з насиченням
  const raw = Math.log2(reps + 1) * 5;
  return Math.min(FAMILIARITY_BONUS_MAX, Math.round(raw));
}

/**
 * mistake_penalty: підвищення складності якщо часто помиляємось
 */
function mistakePenalty(wrongCount, totalCount) {
  if (!totalCount || totalCount === 0) return 0;
  const wrongRatio = (wrongCount || 0) / totalCount;
  // Лінійно: 100% помилок → MAX_PENALTY
  return Math.min(MISTAKE_PENALTY_MAX, Math.round(wrongRatio * MISTAKE_PENALTY_MAX));
}

/**
 * time_decay_penalty: якщо давно не повторювали, складність зростає
 */
function decayPenalty(nextReview) {
  if (!nextReview) return 0;
  const overdueDays = (Date.now() - new Date(nextReview).getTime()) / 86_400_000;
  if (overdueDays <= 0) return 0;
  // Плавне зростання: 7 днів прострочення → невелика пеналізація, 30+ → max
  const raw = Math.log2(overdueDays + 1) * 3;
  return Math.min(DECAY_PENALTY_MAX, Math.round(raw));
}

/**
 * Розрахувати PersonalScore (0–100)
 *
 * @param {number} finalScore       — FinalScore зі словника (difficulty_score)
 * @param {object} progress         — SM-2 + counters прогрес
 * @returns {number}                — PersonalScore 0–100
 */
export function computePersonalScore(finalScore, progress) {
  if (!progress || progress.repetitions == null || progress.repetitions === 0) {
    return finalScore; // до першого повторення = словниковий score
  }

  const { correct_count = 0, wrong_count = 0, repetitions = 0, next_review } = progress;
  const total = correct_count + wrong_count;

  const bonus   = familiarityBonus(correct_count, repetitions);
  const penalty = mistakePenalty(wrong_count, total);
  const decay   = decayPenalty(next_review);

  const personal = finalScore - bonus + penalty + decay;
  return Math.min(100, Math.max(0, Math.round(personal)));
}

// ─── Trend Engine ─────────────────────────────────────────────────────────────

/**
 * Визначити тренд: порівнюємо average якості останніх 3 відповідей
 * vs попередніх 3. Використовуємо practice_events (масив результатів).
 *
 * @param {Array<{result: boolean}>} recentEvents  — масив відповідей (найновіші першими)
 * @returns {'easier'|'harder'|'stable'}
 */
export function computeTrend(recentEvents) {
  if (!recentEvents || recentEvents.length < 4) return 'stable';

  const qualityOf = (e) => (e.result ? 1 : 0);

  const last3     = recentEvents.slice(0, 3).map(qualityOf);
  const prev3     = recentEvents.slice(3, 6).map(qualityOf);

  if (prev3.length === 0) return 'stable';

  const avgLast = last3.reduce((a, b) => a + b, 0) / last3.length;
  const avgPrev = prev3.reduce((a, b) => a + b, 0) / prev3.length;

  const delta = avgLast - avgPrev;

  if (delta >  0.2) return 'easier';
  if (delta < -0.2) return 'harder';
  return 'stable';
}

/**
 * Розрахувати оновлений Personal Layer після відповіді.
 * Повертає поля для upsert у user_word_progress.
 *
 * @param {{ correct_count, wrong_count, repetitions, ease_factor,
 *            interval_days, next_review, last_result }} currentProgress
 * @param {string}  quality    — 'easy'|'good'|'hard'|'forgot'
 * @param {number}  finalScore — difficulty_score зі словника
 * @param {Array}   recentEvents — масив practice_events (для тренду)
 * @returns {{ ...sm2Fields, wrong_count, correct_count,
 *             personal_score, word_state, trend_direction }}
 */
export function calculateFullProgress(currentProgress, quality, finalScore, recentEvents = []) {
  // 1. SM-2
  const sm2 = calculateNextReview(currentProgress, quality);

  // 2. Лічильники правильних / неправильних
  const isCorrect = quality !== 'forgot';
  const wrong_count   = (currentProgress.wrong_count   || 0) + (isCorrect ? 0 : 1);
  const correct_count = (currentProgress.correct_count || 0) + (isCorrect ? 1 : 0);

  // 3. Merged прогрес для розрахунків
  const merged = { ...currentProgress, ...sm2, wrong_count, correct_count };

  // 4. Word State Machine
  const word_state = computeWordState(merged);

  // 5. Personal Score
  const personal_score = computePersonalScore(finalScore, merged);

  // 6. Trend — додаємо поточну відповідь на початок масиву
  const updatedEvents = [{ result: isCorrect }, ...recentEvents];
  const trend_direction = computeTrend(updatedEvents);

  return {
    ...sm2,
    wrong_count,
    correct_count,
    personal_score,
    word_state,
    trend_direction,
  };
}

// ─── Фільтрація / сортування (без змін) ─────────────────────────────────────

export function getWordsDueForReview(wordsWithProgress) {
  const now = new Date();
  return wordsWithProgress.filter(item => {
    if (!item.next_review) return true;
    return new Date(item.next_review) <= now;
  });
}

export function sortWordsForReview(words) {
  return [...words].sort((a, b) => {
    if (a.last_result === 'forgot' && b.last_result !== 'forgot') return -1;
    if (b.last_result === 'forgot' && a.last_result !== 'forgot') return 1;
    if (!a.repetitions && b.repetitions) return -1;
    if (a.repetitions && !b.repetitions) return 1;
    return new Date(a.next_review || 0) - new Date(b.next_review || 0);
  });
}
