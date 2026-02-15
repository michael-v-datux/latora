/**
 * srsService.js — Алгоритм інтервального повторення SM-2
 * 
 * SM-2 — це алгоритм, який визначає КОЛИ показувати слово наступного разу.
 * Чим краще ви знаєте слово, тим рідше воно з'являється.
 * 
 * Як працює:
 * 1. Нове слово показується одразу
 * 2. Після відповіді, залежно від якості (Easy/Good/Hard/Forgot):
 *    - Easy: наступне повторення через 7+ днів
 *    - Good: через 3-5 днів
 *    - Hard: через 1 день
 *    - Forgot: через 10 хвилин (скидає прогрес)
 * 3. З кожним успішним повторенням інтервал збільшується
 * 
 * Параметри для кожного слова:
 * - ease_factor: "легкість" слова (2.5 за замовчуванням, більше = легше)
 * - interval_days: через скільки днів повторити
 * - repetitions: скільки разів успішно повторено
 */

/**
 * Розрахувати наступний інтервал повторення
 * 
 * @param {Object} progress — поточний прогрес { ease_factor, interval_days, repetitions }
 * @param {string} quality — якість відповіді: 'easy', 'good', 'hard', 'forgot'
 * @returns {Object} — оновлений прогрес + дата наступного повторення
 * 
 * Приклад:
 *   const newProgress = calculateNextReview(
 *     { ease_factor: 2.5, interval_days: 1, repetitions: 1 },
 *     'good'
 *   );
 *   console.log(newProgress.interval_days); // 6
 */
export function calculateNextReview(progress, quality) {
  // Поточні значення (або значення за замовчуванням для нового слова)
  let { ease_factor = 2.5, interval_days = 0, repetitions = 0 } = progress;

  // Конвертуємо якість відповіді в числовий бал (0-5)
  // SM-2 використовує шкалу 0-5, де 3+ = "пам'ятаю"
  const qualityMap = {
    forgot: 0,  // зовсім забув
    hard: 3,    // згадав, але з труднощами
    good: 4,    // згадав нормально
    easy: 5,    // згадав легко
  };
  const q = qualityMap[quality] ?? 0;

  // Якщо забув (quality < 3) — скидаємо прогрес
  if (q < 3) {
    repetitions = 0;
    interval_days = 0; // повторити сьогодні/завтра
  } else {
    // Успішна відповідь — збільшуємо інтервал
    if (repetitions === 0) {
      interval_days = 1;         // перше повторення — через 1 день
    } else if (repetitions === 1) {
      interval_days = 6;         // друге повторення — через 6 днів
    } else {
      // Подальші повторення: інтервал × ease_factor
      interval_days = Math.round(interval_days * ease_factor);
    }
    repetitions += 1;
  }

  // Оновлюємо ease_factor (формула SM-2)
  // Мінімум 1.3, щоб інтервал завжди зростав
  ease_factor = Math.max(
    1.3,
    ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  );

  // Розраховуємо дату наступного повторення
  const next_review = new Date();
  next_review.setDate(next_review.getDate() + interval_days);

  return {
    ease_factor: Math.round(ease_factor * 100) / 100, // округлюємо до 2 знаків
    interval_days,
    repetitions,
    next_review: next_review.toISOString(),
    last_result: quality,
  };
}

/**
 * Відфільтрувати слова, які потрібно повторити сьогодні
 * 
 * @param {Array} wordsWithProgress — масив слів з прогресом
 * @returns {Array} — слова, дата повторення яких вже настала
 */
export function getWordsDueForReview(wordsWithProgress) {
  const now = new Date();
  
  return wordsWithProgress.filter(item => {
    // Нові слова (без прогресу) завжди показуємо
    if (!item.next_review) return true;
    
    // Показуємо якщо дата повторення вже настала
    return new Date(item.next_review) <= now;
  });
}

/**
 * Відсортувати слова для повторення (пріоритет: забуті, потім нові, потім старі)
 * 
 * @param {Array} words — масив слів для повторення
 * @returns {Array} — відсортований масив
 */
export function sortWordsForReview(words) {
  return [...words].sort((a, b) => {
    // Забуті слова першими
    if (a.last_result === 'forgot' && b.last_result !== 'forgot') return -1;
    if (b.last_result === 'forgot' && a.last_result !== 'forgot') return 1;
    
    // Нові слова другими
    if (!a.repetitions && b.repetitions) return -1;
    if (a.repetitions && !b.repetitions) return 1;
    
    // Решта — за датою (раніше = вище пріоритет)
    return new Date(a.next_review || 0) - new Date(b.next_review || 0);
  });
}
