/**
 * PracticeScreen.js — Екран повторення слів (flashcards)
 *
 * 5 станів:
 * 1. Home — реальна статистика + список для повторення
 * 2. Difficulty — вибір рівня складності (1-4)
 * 3. Session — flashcard сесія (логіка залежить від рівня)
 * 4. Results — підсумок сесії
 * 5. Loading / Empty — стани завантаження та порожнього списку
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CefrBadge from '../components/CefrBadge';
import { calculateNextReview, sortWordsForReview } from '../services/srsService';
import { fetchLists } from '../services/listsService';
import {
  fetchPracticeStats,
  fetchPracticeWords,
  fetchAllListWords,
  fetchListStatuses,
  submitPracticeResult,
} from '../services/practiceService';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';

// ─── Кнопки оцінки ───
const ANSWER_BUTTONS = [
  { key: 'forgot', label: 'forgot', color: '#dc2626', bg: '#fef2f2' },
  { key: 'hard', label: 'hard', color: '#ea580c', bg: '#fff7ed' },
  { key: 'good', label: 'good', color: '#2563eb', bg: '#eff6ff' },
  { key: 'easy', label: 'easy', color: '#16a34a', bg: '#f0fdf4' },
];

// ─── Рівні складності ───
const DIFFICULTY_LEVELS = [
  { key: 1, icon: '💡', i18nKey: 'hint' },
  { key: 2, icon: '✋', i18nKey: 'quiz' },
  { key: 3, icon: '🧠', i18nKey: 'classic' },
  { key: 4, icon: '⏱', i18nKey: 'timer' },
];

const TIMER_SECONDS = 5;

// ─── Утиліти ───

/** Приховати ~65% літер у тексті перекладу, залишити першу/останню */
function maskTranslation(text) {
  if (!text) return '';
  return text.split(' ').map(word => {
    // Зберігаємо розділові знаки
    if (word.length <= 2) return word.replace(/[a-zA-Zа-яА-ЯіІїЇєЄґҐёЁ]/g, '●');
    const chars = [...word];
    const letterIndices = [];
    chars.forEach((ch, i) => {
      if (/[a-zA-Zа-яА-ЯіІїЇєЄґҐёЁʼ']/u.test(ch)) letterIndices.push(i);
    });
    if (letterIndices.length <= 2) return word;
    // Зберігаємо першу та останню літеру
    const middleIndices = letterIndices.slice(1, -1);
    const hideCount = Math.ceil(middleIndices.length * 0.65);
    // Випадково вибираємо які літери ховати
    const shuffled = [...middleIndices].sort(() => Math.random() - 0.5);
    const toHide = new Set(shuffled.slice(0, hideCount));
    return chars.map((ch, i) => toHide.has(i) ? '●' : ch).join('');
  }).join(' ');
}

/** Fisher-Yates shuffle */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Згенерувати 3 варіанти (1 правильний + 2 фейкових) */
function generateOptions(correctWord, allWords, distractors = []) {
  // Спочатку пробуємо взяти з того ж списку
  const others = allWords.filter(w => w.id !== correctWord.id && w.translation);
  const fakes = shuffle(others).slice(0, 2).map(w => w.translation);
  // Якщо мало слів у списку — беремо з дистракторів (інші слова тієї ж мовної пари)
  if (fakes.length < 2 && distractors.length > 0) {
    const extraFakes = shuffle(distractors)
      .filter(d => d.translation !== correctWord.translation && !fakes.includes(d.translation))
      .slice(0, 2 - fakes.length)
      .map(d => d.translation);
    fakes.push(...extraFakes);
  }
  // Крайній fallback — не повинен спрацьовувати якщо в БД є слова
  while (fakes.length < 2) {
    fakes.push(fakes.length === 0 ? '...' : '???');
  }
  const options = shuffle([
    { text: correctWord.translation, correct: true },
    { text: fakes[0], correct: false },
    { text: fakes[1], correct: false },
  ]);
  return options;
}

// ═══════════════════════════════════════════════════════════════
// Компонент
// ═══════════════════════════════════════════════════════════════

export default function PracticeScreen() {
  const { t } = useI18n();

  // ─── Стан навігації ───
  const [screen, setScreen] = useState('home'); // home | difficulty | session | results
  const [selectedList, setSelectedList] = useState(null);
  const [difficulty, setDifficulty] = useState(null); // 1-4

  // ─── Дані ───
  const [lists, setLists] = useState([]);
  const [practiceStats, setPracticeStats] = useState({ due: 0, mastered: 0, total: 0 });
  const [listStatuses, setListStatuses] = useState({}); // { [listId]: { total, due, reviewed_today } }
  const [words, setWords] = useState([]);        // due words для сесії
  const [allListWords, setAllListWords] = useState([]); // усі слова списку (для quiz)
  const [distractors, setDistractors] = useState([]); // додаткові слова для quiz (малі списки)
  const [loading, setLoading] = useState(false);
  const [forceRestart, setForceRestart] = useState(false); // для "Start over"

  // ─── Info tooltip ───
  const [activeTooltip, setActiveTooltip] = useState(null); // 'due' | 'mastered' | 'total' | null
  const tooltipTimerRef = useRef(null);

  // ─── Сесія ───
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ easy: 0, good: 0, hard: 0, forgot: 0 });

  // ─── Level 1: masked translation ───
  const [maskedText, setMaskedText] = useState('');

  // ─── Level 2: quiz ───
  const [quizOptions, setQuizOptions] = useState([]);
  const [quizAnswered, setQuizAnswered] = useState(null); // null | index

  // ─── Level 4: timer ───
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS);
  const [timerExpired, setTimerExpired] = useState(false);
  const timerRef = useRef(null);

  // ─── Остання збережена відповідь (щоб дочекатися перед refresh) ───
  const lastSubmitRef = useRef(null);

  // ─── Завантаження даних для Home ───
  const loadHomeData = useCallback(async () => {
    try {
      const [listsData, statsData, statusesData] = await Promise.all([
        fetchLists(),
        fetchPracticeStats(),
        fetchListStatuses(),
      ]);
      setLists(listsData || []);
      setPracticeStats(statsData || { due: 0, mastered: 0, total: 0 });
      setListStatuses(statusesData?.statuses || {});
    } catch (e) {
      console.warn('Failed to load practice home data:', e);
    }
  }, []);

  useEffect(() => {
    loadHomeData();
  }, [loadHomeData]);

  // ─── Tooltip auto-dismiss (6 сек) ───
  useEffect(() => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    if (activeTooltip) {
      tooltipTimerRef.current = setTimeout(() => setActiveTooltip(null), 6000);
    }
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
  }, [activeTooltip]);

  // ─── Обробка натискання на список ───
  const handleListPress = (list, force = false) => {
    setSelectedList(list);
    setForceRestart(force);
    setScreen('difficulty');
  };

  // ─── Завантаження слів та старт сесії ───
  const startSession = async (level) => {
    setDifficulty(level);
    setLoading(true);
    try {
      const [practiceData, allData] = await Promise.all([
        fetchPracticeWords(selectedList.id, forceRestart),
        level === 2 ? fetchAllListWords(selectedList.id) : Promise.resolve({ words: [] }),
      ]);

      const dueWords = practiceData.words || [];
      if (dueWords.length === 0) {
        setWords([]);
        setLoading(false);
        setScreen('empty');
        return;
      }

      // Сортуємо: забуті → нові → решта
      const sorted = sortWordsForReview(
        dueWords.map(w => ({
          ...w,
          last_result: w.progress?.last_result,
          repetitions: w.progress?.repetitions,
          next_review: w.progress?.next_review,
        }))
      );

      const quizDistractors = allData.distractors || [];

      setWords(sorted);
      setAllListWords(allData.words || sorted);
      setDistractors(quizDistractors);
      setCurrentIndex(0);
      setRevealed(false);
      setStats({ easy: 0, good: 0, hard: 0, forgot: 0 });
      setQuizAnswered(null);
      setTimerExpired(false);
      setTimeLeft(TIMER_SECONDS);

      // Підготувати дані для першого слова
      prepareWord(sorted[0], level, allData.words || sorted, quizDistractors);

      setLoading(false);
      setScreen('session');
    } catch (e) {
      console.warn('Failed to start practice session:', e);
      setLoading(false);
    }
  };

  // ─── Підготувати дані для поточного слова ───
  const prepareWord = (word, level, pool, extraDistractors) => {
    if (level === 1) {
      setMaskedText(maskTranslation(word.translation));
    }
    if (level === 2) {
      setQuizOptions(generateOptions(word, pool, extraDistractors || distractors));
      setQuizAnswered(null);
    }
    if (level === 4) {
      setTimerExpired(false);
      setTimeLeft(TIMER_SECONDS);
    }
    setRevealed(false);
  };

  // ─── Timer (Level 4) ───
  useEffect(() => {
    if (screen !== 'session' || difficulty !== 4 || revealed || timerExpired) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 0.1) {
          clearInterval(timerRef.current);
          setTimerExpired(true);
          return 0;
        }
        return Math.max(0, prev - 0.1);
      });
    }, 100);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [screen, difficulty, revealed, timerExpired, currentIndex]);

  // Коли таймер вийшов — автоматично "forgot"
  useEffect(() => {
    if (timerExpired && !revealed) {
      setRevealed(true);
    }
  }, [timerExpired, revealed]);

  // ─── Обробка відповіді ───
  const handleAnswer = async (quality) => {
    const word = words[currentIndex];
    setStats(prev => ({ ...prev, [quality]: prev[quality] + 1 }));

    // Розрахувати наступне повторення (SM-2)
    const progress = word.progress || { ease_factor: 2.5, interval_days: 0, repetitions: 0 };
    const newProgress = calculateNextReview(progress, quality);

    // Зберегти результат на сервері (fire-and-forget, але зберігаємо promise для refresh)
    lastSubmitRef.current = submitPracticeResult(word.id, quality, newProgress).catch(e => {
      console.warn('Failed to save practice result:', e);
    });

    // Перейти до наступного слова або завершити
    if (currentIndex + 1 >= words.length) {
      setScreen('results');
    } else {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      prepareWord(words[nextIndex], difficulty, allListWords, distractors);
    }
  };

  // ─── Quiz answer (Level 2) ───
  const handleQuizAnswer = (optionIndex) => {
    if (quizAnswered !== null) return;
    setQuizAnswered(optionIndex);
    setRevealed(true);
  };

  // Quiz → next word (після показу результату)
  const handleQuizNext = () => {
    const isCorrect = quizOptions[quizAnswered]?.correct;
    handleAnswer(isCorrect ? 'good' : 'forgot');
  };

  // ─── Timer: "I know" / "Don't know" ───
  const handleTimerKnow = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRevealed(true);
  };

  const handleTimerDontKnow = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimerExpired(true);
    setRevealed(true);
  };

  const handleTimerAdd3 = () => {
    setTimeLeft(prev => prev + 3);
  };

  // ─── Reset ───
  const reset = async () => {
    setScreen('home');
    setSelectedList(null);
    setDifficulty(null);
    setForceRestart(false);
    setWords([]);
    setAllListWords([]);
    setDistractors([]);
    setCurrentIndex(0);
    setRevealed(false);
    setStats({ easy: 0, good: 0, hard: 0, forgot: 0 });
    setQuizAnswered(null);
    setTimerExpired(false);
    setTimeLeft(TIMER_SECONDS);
    setActiveTooltip(null);
    if (timerRef.current) clearInterval(timerRef.current);
    // Дочекатися останнього збереження, щоб статуси оновились коректно
    if (lastSubmitRef.current) {
      await lastSubmitRef.current;
      lastSubmitRef.current = null;
    }
    loadHomeData();
  };

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  // ─── Loading ───
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>{t('practice.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Empty (no due words) ───
  if (screen === 'empty') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerContainer}>
          <Text style={styles.emptyIcon}>✓</Text>
          <Text style={styles.emptyTitle}>{t('practice.no_due')}</Text>
          <Text style={styles.emptySubtitle}>{t('practice.no_due_subtitle')}</Text>
          <TouchableOpacity style={styles.doneButton} onPress={reset} activeOpacity={0.7}>
            <Text style={styles.doneButtonText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ═══ Стан 1: Home ═══
  if (screen === 'home') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('practice.title')}</Text>
            <Text style={styles.subtitle}>{t('practice.subtitle')}</Text>
          </View>

          {/* Статистика */}
          <View style={styles.statsCard}>
            <View style={styles.statsRow}>
              {[
                { key: 'due', n: practiceStats.due, label: t('practice.due_today'), color: '#ea580c', tooltip: t('practice.tooltip_due') },
                { key: 'mastered', n: practiceStats.mastered, label: t('practice.mastered'), color: '#16a34a', tooltip: t('practice.tooltip_mastered') },
                { key: 'total', n: practiceStats.total, label: t('practice.total'), color: '#2563eb', tooltip: t('practice.tooltip_total') },
              ].map(stat => (
                <TouchableOpacity
                  key={stat.key}
                  style={styles.statItem}
                  onPress={() => setActiveTooltip(activeTooltip === stat.key ? null : stat.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.statNumber, { color: stat.color }]}>{stat.n}</Text>
                  <View style={styles.statLabelRow}>
                    <Text style={styles.statLabel}>{stat.label}</Text>
                    <Text style={styles.statInfoIcon}>ⓘ</Text>
                  </View>
                  {activeTooltip === stat.key && (
                    <View style={styles.tooltip}>
                      <Text style={styles.tooltipText}>{stat.tooltip}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Вибір списку */}
          <Text style={styles.sectionLabel}>{t('practice.choose_list')}</Text>
          {lists.length === 0 && (
            <View style={styles.emptyListCard}>
              <Text style={styles.emptyListText}>{t('practice.no_words')}</Text>
              <Text style={styles.emptyListSubtext}>{t('practice.no_words_subtitle')}</Text>
            </View>
          )}
          {lists.map(list => {
            const st = listStatuses[list.id];
            const total = st?.total || 0;
            const due = st?.due ?? total;
            const reviewed = st?.reviewed_today || 0;

            // Status: done | partial | due | empty
            let status = 'due';
            if (total === 0) status = 'empty';
            else if (due === 0) status = 'done';
            else if (reviewed > 0) status = 'partial';

            return (
              <View key={list.id} style={[
                styles.listItem,
                status === 'done' && styles.listItemDone,
              ]}>
                <TouchableOpacity
                  style={styles.listItemRow}
                  onPress={() => handleListPress(list)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.listEmoji}>{list.emoji || '📚'}</Text>
                  <Text style={styles.listName}>{list.name}</Text>
                  <Text style={styles.listCount}>{list.word_count || 0}</Text>
                </TouchableOpacity>

                {/* Status badge */}
                {status === 'done' && (
                  <View style={[styles.statusRow, { borderTopColor: '#bbf7d0' }]}>
                    <Text style={styles.statusDone}>✅ {t('practice.status_done')}</Text>
                  </View>
                )}
                {status === 'partial' && (
                  <View style={styles.statusRow}>
                    <Text style={styles.statusPartial}>
                      🔄 {t('practice.status_partial', { done: total - due, total })}
                    </Text>
                    <View style={styles.statusActions}>
                      <TouchableOpacity
                        onPress={() => handleListPress(list)}
                        activeOpacity={0.6}
                        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                      >
                        <Text style={styles.statusContinue}>{t('practice.continue')}</Text>
                      </TouchableOpacity>
                      <Text style={styles.statusDivider}>·</Text>
                      <TouchableOpacity
                        onPress={() => handleListPress(list, true)}
                        activeOpacity={0.6}
                        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                      >
                        <Text style={styles.statusRestart}>{t('practice.restart')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                {status === 'due' && (
                  <View style={styles.statusRow}>
                    <Text style={styles.statusDue}>
                      {t('practice.status_due', { count: due })}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ═══ Стан 2: Вибір складності ═══
  if (screen === 'difficulty') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.container}>
          <View style={styles.difficultyHeader}>
            <TouchableOpacity onPress={reset}>
              <Text style={styles.backButton}>← {t('common.cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.difficultyListName}>
              {selectedList?.emoji || '📚'} {selectedList?.name}
            </Text>
          </View>

          <Text style={styles.sectionLabel}>{t('practice.choose_difficulty')}</Text>

          <View style={styles.difficultyGrid}>
            {DIFFICULTY_LEVELS.map(level => (
              <TouchableOpacity
                key={level.key}
                style={styles.difficultyCard}
                onPress={() => startSession(level.key)}
                activeOpacity={0.6}
              >
                <Text style={styles.difficultyIcon}>{level.icon}</Text>
                <Text style={styles.difficultyName}>{t(`practice.difficulty.${level.i18nKey}`)}</Text>
                <Text style={styles.difficultyDesc}>{t(`practice.difficulty.${level.i18nKey}_desc`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ═══ Стан 4: Результати ═══
  if (screen === 'results') {
    const totalAnswers = stats.easy + stats.good + stats.hard + stats.forgot;
    const correctPercent = totalAnswers > 0
      ? Math.round(((stats.easy + stats.good) / totalAnswers) * 100)
      : 0;

    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.finishedContainer}>
          <View style={styles.checkCircle}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
          <Text style={styles.finishedTitle}>{t('practice.session_complete')}</Text>

          {/* Відсоток */}
          <Text style={styles.scoreText}>{correctPercent}%</Text>
          <Text style={styles.scoreLabel}>{t('practice.score')}</Text>

          <View style={styles.resultsGrid}>
            {ANSWER_BUTTONS.map(btn => (
              <View key={btn.key} style={[styles.resultCard, { backgroundColor: btn.bg }]}>
                <Text style={[styles.resultNumber, { color: btn.color }]}>{stats[btn.key]}</Text>
                <Text style={styles.resultLabel}>{t(`practice.answer.${btn.key}`)}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.doneButton} onPress={reset} activeOpacity={0.7}>
            <Text style={styles.doneButtonText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ═══ Стан 3: Сесія ═══
  const word = words[currentIndex];
  if (!word) return null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.sessionContainer}>
        {/* Прогрес-бар */}
        <View style={styles.progressHeader}>
          <TouchableOpacity onPress={reset}>
            <Text style={styles.endButton}>✕ {t('practice.end')}</Text>
          </TouchableOpacity>
          <Text style={styles.progressText}>{currentIndex + 1} / {words.length}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((currentIndex + 1) / words.length) * 100}%` }]} />
        </View>

        {/* Flashcard */}
        <View style={styles.cardArea}>
          {/* ─── Level 1: Hint ─── */}
          {difficulty === 1 && (
            <View style={styles.flashcard}>
              <CefrBadge level={word.cefr_level} />
              <Text style={styles.flashcardWord}>{word.original}</Text>
              <Text style={styles.flashcardTranscription}>{word.transcription}</Text>

              <View style={styles.revealedContent}>
                <View style={styles.divider} />
                {!revealed ? (
                  <>
                    <Text style={styles.maskedTranslation}>{maskedText}</Text>
                    <TouchableOpacity
                      style={styles.revealButton}
                      onPress={() => setRevealed(true)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.revealButtonText}>{t('practice.tap_to_reveal')}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.flashcardTranslation}>{word.translation}</Text>
                    {word.example_sentence ? (
                      <Text style={styles.flashcardExample}>"{word.example_sentence}"</Text>
                    ) : null}
                  </>
                )}
              </View>
            </View>
          )}

          {/* ─── Level 2: Quiz ─── */}
          {difficulty === 2 && (
            <View style={styles.flashcard}>
              <CefrBadge level={word.cefr_level} />
              <Text style={styles.flashcardWord}>{word.original}</Text>
              <Text style={styles.flashcardTranscription}>{word.transcription}</Text>

              <View style={styles.quizOptionsContainer}>
                {quizOptions.map((opt, i) => {
                  let optStyle = styles.quizOption;
                  let textStyle = styles.quizOptionText;

                  if (quizAnswered !== null) {
                    if (opt.correct) {
                      optStyle = [styles.quizOption, styles.quizCorrect];
                      textStyle = [styles.quizOptionText, styles.quizCorrectText];
                    } else if (i === quizAnswered && !opt.correct) {
                      optStyle = [styles.quizOption, styles.quizWrong];
                      textStyle = [styles.quizOptionText, styles.quizWrongText];
                    }
                  }

                  return (
                    <TouchableOpacity
                      key={i}
                      style={optStyle}
                      onPress={() => handleQuizAnswer(i)}
                      activeOpacity={quizAnswered !== null ? 1 : 0.6}
                      disabled={quizAnswered !== null}
                    >
                      <Text style={textStyle}>{opt.text}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Feedback після відповіді */}
              {quizAnswered !== null && (
                <View style={styles.quizFeedback}>
                  <Text style={[
                    styles.quizFeedbackText,
                    { color: quizOptions[quizAnswered]?.correct ? '#16a34a' : '#dc2626' }
                  ]}>
                    {quizOptions[quizAnswered]?.correct ? t('practice.correct') : t('practice.incorrect')}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ─── Level 3: Classic ─── */}
          {difficulty === 3 && (
            <TouchableOpacity
              style={styles.flashcard}
              onPress={() => !revealed && setRevealed(true)}
              activeOpacity={revealed ? 1 : 0.8}
            >
              <CefrBadge level={word.cefr_level} />
              <Text style={styles.flashcardWord}>{word.original}</Text>
              <Text style={styles.flashcardTranscription}>{word.transcription}</Text>

              {!revealed && (
                <Text style={styles.tapHint}>{t('practice.tap_to_reveal')}</Text>
              )}

              {revealed && (
                <View style={styles.revealedContent}>
                  <View style={styles.divider} />
                  <Text style={styles.flashcardTranslation}>{word.translation}</Text>
                  {word.example_sentence ? (
                    <Text style={styles.flashcardExample}>"{word.example_sentence}"</Text>
                  ) : null}
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* ─── Level 4: Timer ─── */}
          {difficulty === 4 && (
            <View style={styles.flashcard}>
              <Text style={styles.flashcardWord}>{word.original}</Text>

              {/* Timer bar */}
              {!revealed && !timerExpired && (
                <View style={styles.timerContainer}>
                  <View style={styles.timerTrack}>
                    <View style={[
                      styles.timerFill,
                      {
                        width: `${Math.min((timeLeft / TIMER_SECONDS) * 100, 100)}%`,
                        backgroundColor: timeLeft > 2 ? '#2563eb' : timeLeft > 1 ? '#ea580c' : '#dc2626',
                      },
                    ]} />
                  </View>
                  <Text style={styles.timerText}>{Math.ceil(timeLeft)}s</Text>
                </View>
              )}

              {/* Кнопки know/don't know + add time (до reveal) */}
              {!revealed && !timerExpired && (
                <View style={styles.timerButtonsColumn}>
                  <View style={styles.timerButtons}>
                    <TouchableOpacity
                      style={[styles.timerActionButton, styles.timerDontKnow]}
                      onPress={handleTimerDontKnow}
                      activeOpacity={0.6}
                    >
                      <Text style={styles.timerDontKnowText}>{t('practice.dont_know')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.timerActionButton, styles.timerKnow]}
                      onPress={handleTimerKnow}
                      activeOpacity={0.6}
                    >
                      <Text style={styles.timerKnowText}>{t('practice.i_know')}</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.addTimeButton}
                    onPress={handleTimerAdd3}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.addTimeText}>{t('practice.add_time')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Revealed content */}
              {revealed && (
                <View style={styles.revealedContent}>
                  {timerExpired && (
                    <Text style={styles.timesUpText}>{t('practice.times_up')}</Text>
                  )}
                  <View style={styles.divider} />
                  <Text style={styles.flashcardTranslation}>{word.translation}</Text>
                  {word.example_sentence ? (
                    <Text style={styles.flashcardExample}>"{word.example_sentence}"</Text>
                  ) : null}
                </View>
              )}
            </View>
          )}

          {/* ─── Answer buttons ─── */}
          {/* Level 1, 3: після reveal */}
          {(difficulty === 1 || difficulty === 3) && revealed && (
            <View style={styles.answerButtons}>
              {ANSWER_BUTTONS.map(btn => (
                <TouchableOpacity
                  key={btn.key}
                  style={[styles.answerButton, { backgroundColor: btn.bg, borderColor: btn.color + '20' }]}
                  onPress={() => handleAnswer(btn.key)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.answerButtonText, { color: btn.color }]}>
                    {t(`practice.answer.${btn.key}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Level 2: кнопка "Next" після quiz answer */}
          {difficulty === 2 && quizAnswered !== null && (
            <TouchableOpacity
              style={styles.nextButton}
              onPress={handleQuizNext}
              activeOpacity={0.7}
            >
              <Text style={styles.nextButtonText}>{t('practice.next')}</Text>
            </TouchableOpacity>
          )}

          {/* Level 4: після reveal */}
          {difficulty === 4 && revealed && (
            <>
              {timerExpired ? (
                /* Timer expired — автоматично "forgot", просто кнопка Next */
                <TouchableOpacity
                  style={styles.nextButton}
                  onPress={() => handleAnswer('forgot')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.nextButtonText}>{t('practice.next')}</Text>
                </TouchableOpacity>
              ) : (
                /* User pressed "I know" — показати Hard/Good/Easy */
                <View style={styles.answerButtons}>
                  {ANSWER_BUTTONS.filter(b => b.key !== 'forgot').map(btn => (
                    <TouchableOpacity
                      key={btn.key}
                      style={[styles.answerButton, { backgroundColor: btn.bg, borderColor: btn.color + '20' }]}
                      onPress={() => handleAnswer(btn.key)}
                      activeOpacity={0.6}
                    >
                      <Text style={[styles.answerButtonText, { color: btn.color }]}>
                        {t(`practice.answer.${btn.key}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════
// Стилі
// ═══════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, paddingHorizontal: SPACING.xl },
  header: { paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  title: { fontSize: 28, fontWeight: '400', color: COLORS.primary },
  subtitle: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },

  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACING.xl },
  loadingText: { fontSize: 14, color: COLORS.textMuted, marginTop: 12 },

  // Empty states
  emptyIcon: { fontSize: 40, color: '#16a34a', marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '400', color: COLORS.primary, textAlign: 'center' },
  emptySubtitle: { fontSize: 13, color: COLORS.textMuted, marginTop: 6, textAlign: 'center' },
  emptyListCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.xl,
    borderWidth: 1, borderColor: COLORS.borderLight, alignItems: 'center',
  },
  emptyListText: { fontSize: 14, color: COLORS.textSecondary },
  emptyListSubtext: { fontSize: 12, color: COLORS.textMuted, marginTop: 4, textAlign: 'center' },

  // Статистика
  statsCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.xl,
    borderWidth: 1, borderColor: COLORS.borderLight, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 3,
    zIndex: 10, elevation: 10,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', overflow: 'visible' },
  statItem: { alignItems: 'center', position: 'relative', overflow: 'visible', zIndex: 10 },
  statNumber: { fontSize: 28, fontWeight: '300', fontFamily: 'Courier' },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  statLabel: { fontSize: 11, color: COLORS.textMuted },
  statInfoIcon: { fontSize: 11, color: COLORS.textHint },
  tooltip: {
    position: 'absolute', top: '100%', marginTop: 6,
    backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.sm, padding: 10,
    width: 180, zIndex: 999, elevation: 999,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6,
  },
  tooltipText: { fontSize: 11, color: '#ffffff', lineHeight: 16, textAlign: 'center' },

  // Списки
  sectionLabel: { fontSize: 12, color: COLORS.textMuted, letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },
  listItem: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: 11, paddingTop: 11, paddingBottom: 11,
    marginBottom: 6, borderWidth: 1, borderColor: COLORS.borderLight,
  },
  listItemDone: {
    backgroundColor: '#f0fdf4', borderColor: '#bbf7d0',
  },
  listItemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  listEmoji: { fontSize: 16 },
  listName: { flex: 1, fontSize: 14, color: COLORS.textPrimary },
  listCount: { fontSize: 12, color: COLORS.textMuted },

  // Status badges
  statusRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 7, paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.borderLight,
  },
  statusDone: { fontSize: 12, color: '#16a34a', fontWeight: '500' },
  statusPartial: { fontSize: 12, color: '#ea580c' },
  statusDue: { fontSize: 12, color: COLORS.textMuted },
  statusActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusContinue: { fontSize: 12, color: '#2563eb', fontWeight: '600' },
  statusDivider: { fontSize: 12, color: COLORS.textHint },
  statusRestart: { fontSize: 12, color: COLORS.textMuted },

  // Difficulty select
  difficultyHeader: { paddingTop: SPACING.lg, paddingBottom: SPACING.xl },
  backButton: { fontSize: 14, color: COLORS.textMuted, marginBottom: 12 },
  difficultyListName: { fontSize: 20, fontWeight: '400', color: COLORS.primary },
  difficultyGrid: { gap: 10 },
  difficultyCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: 18,
    borderWidth: 1, borderColor: COLORS.borderLight, flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 3,
  },
  difficultyIcon: { fontSize: 24 },
  difficultyName: { fontSize: 16, fontWeight: '500', color: COLORS.textPrimary },
  difficultyDesc: { fontSize: 12, color: COLORS.textMuted, flex: 1 },

  // Сесія
  sessionContainer: { flex: 1, paddingHorizontal: SPACING.xl },
  progressHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: SPACING.lg, marginBottom: 8,
  },
  endButton: { fontSize: 13, color: COLORS.textMuted },
  progressText: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Courier' },
  progressTrack: { height: 3, backgroundColor: COLORS.borderLight, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 2 },

  cardArea: { flex: 1, justifyContent: 'center', paddingBottom: 20 },
  flashcard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, padding: 32,
    borderWidth: 1, borderColor: COLORS.borderLight, alignItems: 'center', minHeight: 220,
    justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8,
  },
  flashcardWord: { fontSize: 28, fontWeight: '400', color: COLORS.primary, marginTop: 16, textAlign: 'center' },
  flashcardTranscription: { fontSize: 13, color: COLORS.textMuted, fontFamily: 'Courier', marginTop: 4 },
  tapHint: { fontSize: 13, color: COLORS.textHint, marginTop: 24, letterSpacing: 0.5 },

  revealedContent: { marginTop: 24, alignItems: 'center', width: '100%' },
  divider: { height: 1, backgroundColor: COLORS.borderLight, width: 120, marginBottom: 20 },
  flashcardTranslation: { fontSize: 20, fontWeight: '500', color: COLORS.textPrimary, textAlign: 'center' },
  flashcardExample: { fontSize: 13, color: COLORS.textMuted, fontStyle: 'italic', marginTop: 12, textAlign: 'center', lineHeight: 20 },

  // Level 1: masked
  maskedTranslation: { fontSize: 20, fontWeight: '500', color: COLORS.textMuted, textAlign: 'center', letterSpacing: 1 },
  revealButton: {
    marginTop: 16, paddingVertical: 8, paddingHorizontal: 20,
    borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  revealButtonText: { fontSize: 13, color: COLORS.textSecondary },

  // Level 2: quiz
  quizOptionsContainer: { marginTop: 24, width: '100%', gap: 10 },
  quizOption: {
    paddingVertical: 14, paddingHorizontal: 16, borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  quizOptionText: { fontSize: 16, color: COLORS.textPrimary },
  quizCorrect: { backgroundColor: '#f0fdf4', borderColor: '#16a34a' },
  quizCorrectText: { color: '#16a34a', fontWeight: '600' },
  quizWrong: { backgroundColor: '#fef2f2', borderColor: '#dc2626' },
  quizWrongText: { color: '#dc2626', fontWeight: '600' },
  quizFeedback: { marginTop: 12 },
  quizFeedbackText: { fontSize: 15, fontWeight: '600' },

  // Level 4: timer
  timerContainer: { marginTop: 20, width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10 },
  timerTrack: { flex: 1, height: 6, backgroundColor: COLORS.borderLight, borderRadius: 3, overflow: 'hidden' },
  timerFill: { height: '100%', borderRadius: 3 },
  timerText: { fontSize: 14, fontFamily: 'Courier', color: COLORS.textMuted, width: 28, textAlign: 'right' },
  timerButtonsColumn: { width: '100%', marginTop: 24, gap: 10 },
  timerButtons: { flexDirection: 'row', gap: 10, width: '100%' },
  timerActionButton: { flex: 1, paddingVertical: 14, borderRadius: BORDER_RADIUS.md, alignItems: 'center', borderWidth: 1 },
  timerKnow: { backgroundColor: '#f0fdf4', borderColor: '#16a34a40' },
  timerKnowText: { fontSize: 15, fontWeight: '600', color: '#16a34a' },
  timerDontKnow: { backgroundColor: '#fef2f2', borderColor: '#dc262640' },
  timerDontKnowText: { fontSize: 15, fontWeight: '600', color: '#dc2626' },
  addTimeButton: {
    alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 20,
    borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  addTimeText: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '500' },
  timesUpText: { fontSize: 15, fontWeight: '600', color: '#dc2626', marginBottom: 8 },

  // Answer buttons
  answerButtons: { flexDirection: 'row', gap: 8, marginTop: 16 },
  answerButton: {
    flex: 1, paddingVertical: 12, borderRadius: BORDER_RADIUS.md,
    alignItems: 'center', borderWidth: 1,
  },
  answerButtonText: { fontSize: 13, fontWeight: '600' },

  // Next button (quiz, timer-expired)
  nextButton: {
    backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md,
    paddingVertical: 14, alignItems: 'center', marginTop: 16,
  },
  nextButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },

  // Результати
  finishedContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACING.xl },
  checkCircle: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#f0fdf4',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  checkMark: { fontSize: 24, color: '#16a34a' },
  finishedTitle: { fontSize: 22, fontWeight: '400', color: COLORS.primary, marginBottom: 8 },
  scoreText: { fontSize: 44, fontWeight: '300', fontFamily: 'Courier', color: COLORS.primary },
  scoreLabel: { fontSize: 12, color: COLORS.textMuted, marginBottom: 24 },
  resultsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, width: '100%', maxWidth: 280, marginBottom: 28,
  },
  resultCard: {
    width: '47%', borderRadius: BORDER_RADIUS.md, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.borderLight,
  },
  resultNumber: { fontSize: 24, fontWeight: '300', fontFamily: 'Courier' },
  resultLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  doneButton: {
    backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md,
    paddingVertical: 12, paddingHorizontal: 32,
  },
  doneButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});
