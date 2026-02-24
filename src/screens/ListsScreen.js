/**
 * ListsScreen.js — Екран списків слів
 *
 * Реальні дані з бекенду (Supabase + RLS):
 * - показує списки користувача
 * - відкриває список і показує слова (join до words)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  Pressable,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Swipeable } from 'react-native-gesture-handler';
import CefrBadge from '../components/CefrBadge';
import DifficultyBar from '../components/DifficultyBar';
import WordDifficultyBreakdown from '../components/WordDifficultyBreakdown';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import {
  fetchLists,
  fetchListDetails,
  createList,
  deleteList,
  removeWordFromList,
  bulkDeleteWords,
  moveWords,
} from '../services/listsService';
import { fetchSessionCounts, fetchListStatuses } from '../services/practiceService';
import { fetchWordStats } from '../services/todayService';
import { fetchRecQuota } from '../services/recommendationsService';
import { useI18n } from '../i18n';
import RecommendationsSetupScreen from './RecommendationsSetupScreen';
import RecommendationsResultsScreen from './RecommendationsResultsScreen';

// --- Helpers: normalize idiom fields coming from Supabase/HTTP ---
// --- Helpers: normalize idiom fields coming from Supabase/HTTP ---
const parseAltTranslations = (v) => {
  // Supported formats:
  // 1) legacy: ["a","b"]  (or JSON string of that)
  // 2) new: { idiomatic: ["a","b"], literal: "..." } (or JSON string)
  if (!v) return { idiomatic: [], literal: '' };

  let val = v;
  if (typeof val === 'string') {
    try { val = JSON.parse(val); } catch { return { idiomatic: [], literal: '' }; }
  }

  const normalizeList = (arr) => {
    if (!arr) return [];
    return arr
      .map((x) => {
        if (!x) return '';
        if (typeof x === 'string') return x.trim();
        if (typeof x === 'object') return (x.text || x.translation || '').toString().trim();
        return '';
      })
      .filter(Boolean);
  };

  // New format
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const idiomatic = normalizeList(val.idiomatic || val.variants || val.alt || []);
    const literal = (val.literal || val.literal_translation || '').toString().trim();
    return { idiomatic, literal };
  }

  // Legacy array
  if (Array.isArray(val)) {
    return { idiomatic: normalizeList(val), literal: '' };
  }

  return { idiomatic: [], literal: '' };
};

const isIdiomatic = (item) => {
  const kind = (item?.translation_kind || '').toString().toLowerCase();
  const pos = (item?.part_of_speech || item?.pos || '').toString().toLowerCase();
  return kind.includes('idiom') || kind.includes('idiomatic') || pos === 'idiom';
};


// CEFR levels for filter pills
const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const WORD_STATES = ['new', 'learning', 'stabilizing', 'mastered', 'decaying'];

export default function ListsScreen({ navigation }) {
  const { t, locale } = useI18n();
  const [lists, setLists] = useState([]);
  const [listsUsage, setListsUsage] = useState(null); // { listCount, maxLists, plan }
  const [selectedList, setSelectedList] = useState(null);
  const [selectedWords, setSelectedWords] = useState([]);
  const [idiomViewById, setIdiomViewById] = useState({});
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lifetimeSessions, setLifetimeSessions] = useState(null);
  const [listProgressMap, setListProgressMap] = useState({}); // { [listId]: { total, due } }

  // Expanded word breakdown
  const [expandedWordIds, setExpandedWordIds] = useState(() => new Set());

  // Bulk mode
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedWordIds, setSelectedWordIds] = useState(() => new Set());
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [moveTargetListId, setMoveTargetListId] = useState(null);

  // New list modal
  const [newListModalVisible, setNewListModalVisible] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [creatingList, setCreatingList] = useState(false);

  // Filter state (for word list detail view)
  const [cefrFilter, setCefrFilter] = useState([]); // [] = all
  const [stateFilter, setStateFilter] = useState('all');
  const [dueOnly, setDueOnly] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [langPairFilter, setLangPairFilter] = useState(null); // null = all pairs

  // Filter dropdown open state
  const [cefrDropOpen, setCefrDropOpen] = useState(false);
  const [stateDropOpen, setStateDropOpen] = useState(false);
  const [langPairDropOpen, setLangPairDropOpen] = useState(false);

  // Search (client-side, all users)
  const [searchQuery, setSearchQuery] = useState('');

  // Word stats modal
  const [statsModalWord, setStatsModalWord] = useState(null); // word object
  const [wordStats, setWordStats] = useState(null);           // server response
  const [loadingStats, setLoadingStats] = useState(false);

  // Recommendations flow
  const [recSetupVisible, setRecSetupVisible] = useState(false);
  const [recResultsVisible, setRecResultsVisible] = useState(false);
  const [recResults, setRecResults] = useState(null);
  const [recQuota, setRecQuota] = useState(null); // { used, max, left }
  const [lastSeenLangPair, setLastSeenLangPair] = useState(null); // { sourceLang, targetLang }

  // Activation check: show entry point when user has ≥1 list, ≥5 total words, ≥1 practice session
  const recActivationMet = useMemo(() => {
    const totalWords = (lists || []).reduce((sum, l) => sum + (l.word_count || 0), 0);
    const hasLists = (lists || []).length >= 1;
    const hasWords = totalWords >= 5;
    // listProgressMap contains sessions_today per list (from fetchListStatuses).
    // We use sessions_today > 0 OR any list has words reviewed (total > due means progress was made).
    // This way activation works even if user practiced on a previous day (due < total).
    const hasPractice = Object.values(listProgressMap || {}).some(
      s => (s.sessions_today || 0) >= 1 || (s.total > 0 && (s.total - (s.due ?? s.total)) > 0)
    );
    return hasLists && hasWords && hasPractice;
  }, [lists, listProgressMap]);

  // Default lang pair for recommendations setup.
  // Uses the last list the user opened (persists after going back to all-lists view).
  // Falls back to EN→UK; user can always change in Setup screen.
  const recDefaultLang = lastSeenLangPair || { sourceLang: 'EN', targetLang: 'UK' };

  const totals = useMemo(() => {
    const totalWords = (lists || []).reduce((sum, l) => sum + (l.word_count || 0), 0);
    const totalLists = (lists || []).length;
    return { totalWords, totalLists };
  }, [lists]);

  const formatWords = (n) => t('lists.words', { count: n });
  const formatLists = (n) => t('lists.lists', { count: n });

  const loadLists = async (opts = { silent: false }) => {
    if (!opts.silent) setLoadingLists(true);
    try {
      const [fetchedData, statusesData] = await Promise.all([
        fetchLists(),
        fetchListStatuses().catch(() => ({ statuses: {} })),
      ]);
      // Also refresh rec quota in background (non-blocking)
      fetchRecQuota().then(q => setRecQuota(q)).catch(() => {});
      // fetchLists now returns { lists, usage } (or legacy bare array)
      const listsArr = Array.isArray(fetchedData)
        ? fetchedData
        : (fetchedData?.lists || []);
      const usage = fetchedData?.usage ?? null;
      setLists(listsArr);
      setListsUsage(usage);
      // Detect Pro plan from usage metadata
      if (usage?.plan) setIsPro(usage.plan === 'pro');
      setListProgressMap(statusesData?.statuses || {});
    } catch (e) {
      console.warn('Failed to fetch lists:', e?.message);
      Alert.alert('Помилка', 'Не вдалося завантажити списки');
    } finally {
      if (!opts.silent) setLoadingLists(false);
    }
  };

  const openList = async (list) => {
    setSelectedList(list);
    setLoadingDetails(true);
    setSelectedWords([]);
    setLifetimeSessions(null);
    setBulkMode(false);
    setSelectedWordIds(new Set());
    // Reset filters, dropdowns and search when opening a new list
    setCefrFilter([]);
    setStateFilter('all');
    setDueOnly(false);
    setLangPairFilter(null);
    setSearchQuery('');
    setCefrDropOpen(false);
    setStateDropOpen(false);
    setLangPairDropOpen(false);
    try {
      const [details, sessionData] = await Promise.all([
        fetchListDetails(list.id),
        fetchSessionCounts([list.id]).catch(() => ({ counts: {} })),
      ]);
      const words = (details?.words || []).map((w) => ({
        id: w.id,
        original: w.original,
        translation: w.translation,
        transcription: w.transcription ?? null,
        cefr: w.cefr_level,
        cefr_level: w.cefr_level,
        score: w.difficulty_score ?? 50,
        difficulty_score: w.difficulty_score ?? null,
        example_sentence: w.example_sentence ?? null,

        // language pair + idioms (if present)
        source_lang: w.source_lang,
        target_lang: w.target_lang,
        alt_translations: w.alt_translations,
        translation_notes: w.translation_notes,
        translation_kind: w.translation_kind,
        part_of_speech: w.part_of_speech,

        // v2 difficulty engine fields
        base_score:       w.base_score       ?? null,
        ai_adjustment:    w.ai_adjustment    ?? null,
        confidence_score: w.confidence_score ?? null,
        frequency_band:   w.frequency_band   ?? null,
        polysemy_level:   w.polysemy_level   ?? null,
        morph_complexity: w.morph_complexity ?? null,
        phrase_flag:      w.phrase_flag      ?? false,

        // v2: word state + personal score from user_word_progress
        word_state:      w.word_state      ?? null,
        personal_score:  w.personal_score  ?? null,
        trend_direction: w.trend_direction ?? null,
      }));
      setSelectedWords(words);
      setLifetimeSessions(sessionData?.counts?.[list.id] || 0);
      // Remember dominant lang pair for recommendations default
      const pairCounts = {};
      for (const w of words) {
        if (w.source_lang && w.target_lang) {
          const k = `${w.source_lang}|${w.target_lang}`;
          pairCounts[k] = (pairCounts[k] || 0) + 1;
        }
      }
      const topPair = Object.entries(pairCounts).sort((a, b) => b[1] - a[1])[0];
      if (topPair) {
        const [src, tgt] = topPair[0].split('|');
        setLastSeenLangPair({ sourceLang: src, targetLang: tgt });
      }
    } catch (e) {
      console.warn('Failed to fetch list details:', e?.message);
      Alert.alert('Помилка', 'Не вдалося завантажити слова списку');
    } finally {
      setLoadingDetails(false);
    }
  };

  const refreshSelectedList = async () => {
    if (!selectedList) return;
    setLoadingDetails(true);
    try {
      const details = await fetchListDetails(selectedList.id);
      const words = (details?.words || []).map((w) => ({
        id: w.id,
        original: w.original,
        translation: w.translation,
        transcription: w.transcription ?? null,
        cefr: w.cefr_level,
        cefr_level: w.cefr_level,
        score: w.difficulty_score ?? 50,
        difficulty_score: w.difficulty_score ?? null,
        example_sentence: w.example_sentence ?? null,

        // language pair + idioms (if present)
        source_lang: w.source_lang,
        target_lang: w.target_lang,
        alt_translations: w.alt_translations,
        translation_notes: w.translation_notes,
        translation_kind: w.translation_kind,
        part_of_speech: w.part_of_speech,

        // v2 difficulty engine fields
        base_score:       w.base_score       ?? null,
        ai_adjustment:    w.ai_adjustment    ?? null,
        confidence_score: w.confidence_score ?? null,
        frequency_band:   w.frequency_band   ?? null,
        polysemy_level:   w.polysemy_level   ?? null,
        morph_complexity: w.morph_complexity ?? null,
        phrase_flag:      w.phrase_flag      ?? false,

        // v2: word state + personal score from user_word_progress
        word_state:      w.word_state      ?? null,
        personal_score:  w.personal_score  ?? null,
        trend_direction: w.trend_direction ?? null,
      }));
      setSelectedWords(words);
    } catch (e) {
      console.warn('Failed to refresh list details:', e?.message);
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    loadLists();
  }, []);

  // Auto refresh when tab gets focus
  useFocusEffect(
    useCallback(() => {
      if (!selectedList) {
        loadLists({ silent: true });
      } else {
        refreshSelectedList();
      }
    }, [selectedList])
  );

  const onPullRefresh = async () => {
    setRefreshing(true);
    try {
      if (!selectedList) {
        await loadLists({ silent: true });
      } else {
        await refreshSelectedList();
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreateNewList = async () => {
    const name = (newListName || '').trim();
    if (!name) {
      Alert.alert('Помилка', 'Вкажи назву списку');
      return;
    }

    setCreatingList(true);
    try {
      const created = await createList({ name });

      // Optimistic
      setLists((prev) => [
        { ...created, word_count: 0, list_words: undefined },
        ...(prev || []),
      ]);

      setNewListModalVisible(false);
      setNewListName('');

      // Sync
      await loadLists({ silent: true });
    } catch (e) {
      console.warn('Create list failed:', e?.message);
      Alert.alert('Помилка', 'Не вдалося створити список');
    } finally {
      setCreatingList(false);
    }
  };

  const confirmDeleteList = (list) => {
    Alert.alert(
      'Видалити список?',
      `Список «${list.name}» буде видалено.`,
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Видалити',
          style: 'destructive',
          onPress: async () => {
            try {
              setLists((prev) => (prev || []).filter((l) => l.id !== list.id));
              await deleteList(list.id);
            } catch (e) {
              Alert.alert('Помилка', 'Не вдалося видалити список');
              await loadLists({ silent: true });
            }
          },
        },
      ]
    );
  };

  const toggleWordSelected = (wordId) => {
    setSelectedWordIds((prev) => {
      const next = new Set(prev);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  };

  const selectedCount = selectedWordIds.size;

  // ── Filtered words (client-side) ──────────────────────────────────────────────
  // Search:      all users
  // CEFR filter: all users
  // State/Due:   Pro only
  const filteredWords = useMemo(() => {
    let words = selectedWords || [];

    // 1. Text search (all users)
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      words = words.filter(
        (w) =>
          (w.original || '').toLowerCase().includes(q) ||
          (w.translation || '').toLowerCase().includes(q) ||
          (w.transcription || '').toLowerCase().includes(q)
      );
    }

    // 2. CEFR filter (all users)
    if (cefrFilter.length > 0) {
      words = words.filter((w) => cefrFilter.includes(w.cefr_level));
    }

    // 3. Language pair filter (shown only when list has mixed langs)
    if (langPairFilter) {
      words = words.filter((w) => {
        const pair = `${(w.source_lang || '').toUpperCase()}→${(w.target_lang || '').toUpperCase()}`;
        return pair === langPairFilter;
      });
    }

    // 4. Pro-only filters
    if (isPro) {
      if (stateFilter !== 'all') {
        words = words.filter((w) => w.word_state === stateFilter);
      }
      if (dueOnly) {
        words = words.filter((w) => w.is_due);
      }
    }

    return words;
  }, [selectedWords, searchQuery, cefrFilter, langPairFilter, isPro, stateFilter, dueOnly]);

  // Available filter values — computed from ALL words in the list (unfiltered),
  // so the dropdowns only show options that actually exist in this list.
  const availableFilters = useMemo(() => {
    const allWords = selectedWords || [];
    const cefrLevels = CEFR_LEVELS.filter((lvl) => allWords.some((w) => w.cefr_level === lvl));
    const states = WORD_STATES.filter((st) => allWords.some((w) => w.word_state === st));
    const hasDue = allWords.some((w) => w.is_due);
    return { cefrLevels, states, hasDue };
  }, [selectedWords]);

  // Auto-reset filters that are no longer valid for the current list content
  // (e.g. user deleted the last word with state 'learning' while filter was active)
  useEffect(() => {
    if (cefrFilter.length > 0) {
      const stillValid = cefrFilter.filter((lvl) => availableFilters.cefrLevels.includes(lvl));
      if (stillValid.length !== cefrFilter.length) setCefrFilter(stillValid);
    }
    if (stateFilter !== 'all' && !availableFilters.states.includes(stateFilter)) {
      setStateFilter('all');
    }
    if (dueOnly && !availableFilters.hasDue) {
      setDueOnly(false);
    }
  }, [availableFilters]);

  const handleBulkDelete = () => {
    if (selectedCount === 0 || !selectedList) return;
    Alert.alert(
      'Видалити слова?',
      `Видалити ${selectedCount} слів зі списку «${selectedList.name}»?`,
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Видалити',
          style: 'destructive',
          onPress: async () => {
            const ids = Array.from(selectedWordIds);
            try {
              setSelectedWords((prev) => (prev || []).filter((w) => !selectedWordIds.has(w.id)));
              setSelectedWordIds(new Set());
              await bulkDeleteWords(selectedList.id, ids);
              await loadLists({ silent: true });
            } catch (e) {
              Alert.alert('Помилка', 'Не вдалося видалити слова');
              await refreshSelectedList();
            }
          },
        },
      ]
    );
  };

  const handleMoveConfirm = async () => {
    if (!selectedList || selectedCount === 0 || !moveTargetListId) return;
    const target = (lists || []).find((l) => l.id === moveTargetListId);
    const targetName = target?.name || 'обраний список';

    Alert.alert(
      'Перенести слова?',
      `Перенести ${selectedCount} слів у список «${targetName}»?`,
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Перенести',
          onPress: async () => {
            const ids = Array.from(selectedWordIds);
            try {
              setSelectedWords((prev) => (prev || []).filter((w) => !selectedWordIds.has(w.id)));
              setSelectedWordIds(new Set());
              setMoveModalVisible(false);
              setMoveTargetListId(null);

              await moveWords({
                fromListId: selectedList.id,
                toListId: moveTargetListId,
                wordIds: ids,
              });
              await loadLists({ silent: true });
            } catch (e) {
              Alert.alert('Помилка', 'Не вдалося перенести слова');
              await refreshSelectedList();
            }
          },
        },
      ]
    );
  };

  // === Вигляд зі словами конкретного списку ===
  if (selectedList) {
    const words = selectedWords || []; // all words (unfiltered)
    const displayWords = filteredWords; // filtered for display

    // Визначаємо чи є у списку слова з різних мовних пар
    const langPairs = new Set(
      words.map(w => `${(w.source_lang || '').toUpperCase()}→${(w.target_lang || '').toUpperCase()}`)
    );
    const hasMixedLangs = langPairs.size > 1;
    const langPairsArray = Array.from(langPairs).filter(p => p !== '→');

    // Check if any filter is active
    const hasActiveFilter = cefrFilter.length > 0 || stateFilter !== 'all' || dueOnly || langPairFilter !== null;

    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.container}>
          {/* Top row */}
          <View style={styles.detailsTopRow}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                setSelectedList(null);
                setSelectedWords([]);
                setBulkMode(false);
                setSelectedWordIds(new Set());
                setCefrDropOpen(false);
                setStateDropOpen(false);
              }}
            >
              <Text style={styles.backText}>←</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bulkToggle}
              onPress={() => {
                if (bulkMode) {
                  setBulkMode(false);
                  setSelectedWordIds(new Set());
                } else {
                  setBulkMode(true);
                }
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.bulkToggleText}>{bulkMode ? t('common.cancel') : t('lists.select_btn')}</Text>
            </TouchableOpacity>
          </View>

          {/* Header */}
          <View style={styles.listHeader}>
            <Ionicons name="folder-outline" size={24} color={COLORS.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>{selectedList.name}</Text>
              <View style={styles.listSubtitleRow}>
                <Text style={styles.listSubtitle}>
                  {loadingDetails
                    ? '…'
                    : hasActiveFilter
                      ? t('lists.words_filtered', { shown: displayWords.length, total: words.length })
                      : formatWords(words.length)}
                </Text>
                {!loadingDetails && hasMixedLangs && (
                  <View style={styles.mixedLangTag}>
                    <Text style={styles.mixedLangTagText}>{t('lists.mixed_langs_tag')}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* ── Search bar (all users, when >3 words) ── */}
          {!loadingDetails && words.length > 3 && !bulkMode && (
            <View style={styles.searchBarWrap}>
              <Ionicons name="search-outline" size={16} color={COLORS.textHint} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={t('lists.search_placeholder')}
                placeholderTextColor={COLORS.textHint}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={16} color={COLORS.textHint} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── Filter bar — wraps automatically to new lines as needed ── */}
          {!loadingDetails && words.length > 0 && !bulkMode && (
            <View style={styles.filterSection}>
              {/* CEFR dropdown — only if list has 2+ distinct CEFR levels */}
              {availableFilters.cefrLevels.length > 1 && (
                <TouchableOpacity
                  style={[styles.filterDropBtn, cefrFilter.length > 0 && styles.filterDropBtnActive]}
                  onPress={() => setCefrDropOpen((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterDropText, cefrFilter.length > 0 && styles.filterDropTextActive]}>
                    {cefrFilter.length === 0
                      ? t('lists.filter_all_cefr')
                      : cefrFilter.length === 1
                        ? cefrFilter[0]
                        : `${cefrFilter.length} levels`}
                  </Text>
                  <Ionicons
                    name={cefrDropOpen ? 'chevron-up' : 'chevron-down'}
                    size={12}
                    color={cefrFilter.length > 0 ? '#ffffff' : COLORS.textSecondary}
                  />
                </TouchableOpacity>
              )}

              {/* State dropdown (Pro) — only if list has 2+ distinct states */}
              {availableFilters.states.length > 1 && (
                isPro ? (
                  <TouchableOpacity
                    style={[styles.filterDropBtn, stateFilter !== 'all' && styles.filterDropBtnActive]}
                    onPress={() => setStateDropOpen((v) => !v)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.filterDropText, stateFilter !== 'all' && styles.filterDropTextActive]}>
                      {stateFilter === 'all' ? t('lists.filter_all_states') : t(`word.state_${stateFilter}`)}
                    </Text>
                    <Ionicons
                      name={stateDropOpen ? 'chevron-up' : 'chevron-down'}
                      size={12}
                      color={stateFilter !== 'all' ? '#ffffff' : COLORS.textSecondary}
                    />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.filterLockPill}
                    onPress={() => navigation.navigate('Profile', { screen: 'ProScreen' })}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="lock-closed" size={11} color="#ca8a04" />
                    <Text style={styles.filterLockPillText}>{t('lists.filter_advanced_lock')}</Text>
                  </TouchableOpacity>
                )
              )}

              {/* Due only toggle (Pro) — only if list actually has due words */}
              {isPro && availableFilters.hasDue && (
                <TouchableOpacity
                  style={[styles.filterDropBtn, dueOnly && styles.filterDropBtnActive]}
                  onPress={() => setDueOnly((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterDropText, dueOnly && styles.filterDropTextActive]}>
                    {t('lists.filter_due_only')}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Language pair filter — only when list has mixed langs */}
              {hasMixedLangs && (
                <TouchableOpacity
                  style={[styles.filterDropBtn, langPairFilter !== null && styles.filterDropBtnActive]}
                  onPress={() => {
                    setLangPairDropOpen((v) => !v);
                    setCefrDropOpen(false);
                    setStateDropOpen(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterDropText, langPairFilter !== null && styles.filterDropTextActive]}>
                    {langPairFilter ?? t('lists.filter_all_pairs')}
                  </Text>
                  <Ionicons
                    name={langPairDropOpen ? 'chevron-up' : 'chevron-down'}
                    size={12}
                    color={langPairFilter !== null ? '#ffffff' : COLORS.textSecondary}
                  />
                </TouchableOpacity>
              )}

              {/* Reset — clears all active filters */}
              {hasActiveFilter && (
                <TouchableOpacity
                  style={styles.filterResetBtn}
                  onPress={() => {
                    setCefrFilter([]);
                    setStateFilter('all');
                    setDueOnly(false);
                    setLangPairFilter(null);
                    setCefrDropOpen(false);
                    setStateDropOpen(false);
                    setLangPairDropOpen(false);
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="close-circle" size={18} color="#dc2626" />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* CEFR dropdown panel — only levels present in this list */}
          {cefrDropOpen && !bulkMode && (
            <View style={styles.dropPanel}>
              <View style={styles.dropPanelRow}>
                {availableFilters.cefrLevels.map((lvl) => {
                  const active = cefrFilter.includes(lvl);
                  return (
                    <TouchableOpacity
                      key={lvl}
                      style={[styles.dropChip, active && styles.dropChipActive]}
                      onPress={() =>
                        setCefrFilter((prev) =>
                          prev.includes(lvl) ? prev.filter((l) => l !== lvl) : [...prev, lvl]
                        )
                      }
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.dropChipText, active && styles.dropChipTextActive]}>{lvl}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity style={styles.dropDoneBtn} onPress={() => setCefrDropOpen(false)} activeOpacity={0.7}>
                <Text style={styles.dropDoneBtnText}>{t('common.done')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* State dropdown panel (Pro only) — only states present in this list */}
          {stateDropOpen && isPro && !bulkMode && (
            <View style={styles.dropPanel}>
              <View style={styles.dropPanelRow}>
                {['all', ...availableFilters.states].map((st) => {
                  const active = stateFilter === st;
                  const label = st === 'all' ? t('lists.filter_all_states') : t(`word.state_${st}`);
                  return (
                    <TouchableOpacity
                      key={st}
                      style={[styles.dropChip, active && styles.dropChipActive]}
                      onPress={() => { setStateFilter(st); setStateDropOpen(false); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.dropChipText, active && styles.dropChipTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Language pair dropdown panel — only when list has mixed langs */}
          {langPairDropOpen && hasMixedLangs && !bulkMode && (
            <View style={styles.dropPanel}>
              <View style={styles.dropPanelRow}>
                {/* "All" option */}
                <TouchableOpacity
                  style={[styles.dropChip, langPairFilter === null && styles.dropChipActive]}
                  onPress={() => { setLangPairFilter(null); setLangPairDropOpen(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.dropChipText, langPairFilter === null && styles.dropChipTextActive]}>
                    {t('lists.filter_all_pairs')}
                  </Text>
                </TouchableOpacity>
                {langPairsArray.map((pair) => (
                  <TouchableOpacity
                    key={pair}
                    style={[styles.dropChip, langPairFilter === pair && styles.dropChipActive]}
                    onPress={() => { setLangPairFilter(pair); setLangPairDropOpen(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dropChipText, langPairFilter === pair && styles.dropChipTextActive]}>
                      {pair}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Practice info — тільки якщо у списку є слова */}
          {!loadingDetails && words.length > 0 && (
            <View style={styles.practiceInfoRow}>
              <Text style={styles.practiceInfoText}>
                {lifetimeSessions !== null && lifetimeSessions > 0
                  ? t('lists.reviewed_times', { count: lifetimeSessions })
                  : t('lists.not_reviewed_yet')
                }
              </Text>
              <TouchableOpacity
                style={styles.practiceButton}
                onPress={() => {
                  navigation.navigate('Practice', {
                    startListId: selectedList.id,
                    startListName: selectedList.name,
                  });
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="fitness-outline" size={16} color="#ffffff" />
                <Text style={styles.practiceButtonText}>{t('lists.practice_button')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {loadingDetails ? (
            <View style={{ paddingTop: 30, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : (
            <FlatList
              data={displayWords}
              keyExtractor={(item) => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
              ListEmptyComponent={() => (
                <TouchableOpacity
                  style={styles.emptyState}
                  onPress={() => navigation.navigate('Translate')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add-circle-outline" size={28} color={COLORS.primary} />
                  <Text style={styles.emptyTitle}>{t('lists.empty_words')}</Text>
                  <Text style={styles.emptySubtitle}>
                    {t('lists.empty_words_subtitle')}
                  </Text>
                </TouchableOpacity>
              )}
              renderItem={({ item }) => {
                const checked = selectedWordIds.has(item.id);
                const isExpanded = expandedWordIds.has(item.id);
                const hasV2Data = item.base_score != null;

                const toggleExpand = () => {
                  setExpandedWordIds(prev => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  });
                };

                const content = (
                  <View style={styles.wordItem}>
                    {/* Основний рядок слова */}
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => { if (bulkMode) toggleWordSelected(item.id); }}
                      style={styles.wordRow}
                    >
                      {bulkMode && (
                        <View style={styles.checkboxWrap}>
                          <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                            {checked && <Ionicons name="checkmark" size={14} color={COLORS.surface} />}
                          </View>
                        </View>
                      )}

                      <View style={styles.wordLeft}>
                        <View style={styles.wordHeader}>
                          <Text style={styles.wordOriginal}>{item.original}</Text>
                          <CefrBadge level={item.cefr} small />
                          {item.word_state && item.word_state !== 'new' && (() => {
                            const STATE_COLORS = {
                              learning:    { color: '#2563eb', bg: '#eff6ff' },
                              stabilizing: { color: '#ca8a04', bg: '#fefce8' },
                              mastered:    { color: '#16a34a', bg: '#f0fdf4' },
                              decaying:    { color: '#dc2626', bg: '#fef2f2' },
                            };
                            const sc = STATE_COLORS[item.word_state];
                            if (!sc) return null;
                            return (
                              <View style={[styles.wordStateBadge, { backgroundColor: sc.bg }]}>
                                <Text style={[styles.wordStateBadgeText, { color: sc.color }]}>
                                  {t(`word.state_${item.word_state}`)}
                                </Text>
                              </View>
                            );
                          })()}
                        </View>
                        <Text style={styles.wordTranslation}>{item.translation}</Text>
                        {(item.source_lang || item.target_lang) && (
                          <Text style={styles.wordLang}>{(item.source_lang || 'EN')} → {(item.target_lang || 'UK')}</Text>
                        )}

                        {/* Idiom block */}
                        {(() => {
                          if (!isIdiomatic(item)) return null;
                          const meta = parseAltTranslations(item.alt_translations);
                          const idiomaticList = meta.idiomatic || [];
                          const hasIdiomatic = idiomaticList.length > 0;
                          const literalText = (meta.literal || '').toString().trim() || (hasIdiomatic ? (item.translation || '').toString().trim() : '');
                          const hasLiteral = !!literalText;
                          const hasAny = hasIdiomatic || hasLiteral;
                          if (!hasAny && !item.translation_notes) return null;
                          const view = idiomViewById[item.id] || 'idiomatic';
                          const effectiveView = hasIdiomatic ? view : 'literal';
                          const showToggle = hasIdiomatic && hasLiteral;
                          return (
                            <View style={styles.wordAltTranslations}>
                              <View style={styles.idiomHeaderRow}>
                                {!hasIdiomatic && <Text style={styles.wordAltLabel}>Буквально</Text>}
                                {showToggle && (
                                  <View style={styles.idiomToggle}>
                                    <TouchableOpacity
                                      onPress={() => setIdiomViewById((prev) => ({ ...prev, [item.id]: 'idiomatic' }))}
                                      style={[styles.idiomToggleBtn, effectiveView === 'idiomatic' && styles.idiomToggleBtnActive]}
                                    >
                                      <Text style={[styles.idiomToggleText, effectiveView === 'idiomatic' && styles.idiomToggleTextActive]}>Idiomatic</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      onPress={() => setIdiomViewById((prev) => ({ ...prev, [item.id]: 'literal' }))}
                                      style={[styles.idiomToggleBtn, effectiveView === 'literal' && styles.idiomToggleBtnActive]}
                                    >
                                      <Text style={[styles.idiomToggleText, effectiveView === 'literal' && styles.idiomToggleTextActive]}>Literal</Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                              {effectiveView === 'literal' && hasLiteral && <Text style={styles.wordAltText}>• {literalText}</Text>}
                              {effectiveView === 'idiomatic' && idiomaticList.map((txt, i) => (
                                <Text key={`${item.id}-alt-${i}`} style={styles.wordAltText}>• {txt}</Text>
                              ))}
                              {!!item.translation_notes && effectiveView !== 'literal' && (
                                <Text style={styles.wordAltNote}>{item.translation_notes}</Text>
                              )}
                            </View>
                          );
                        })()}
                      </View>

                      <View style={styles.wordRight}>
                        <DifficultyBar score={item.score} />
                      </View>
                    </TouchableOpacity>

                    {/* Рядок кнопок розгортання + статистики */}
                    {!bulkMode && (hasV2Data || true) && (
                      <View style={styles.wordActionRow}>
                        {hasV2Data && (
                          <TouchableOpacity
                            style={styles.expandBtn}
                            onPress={toggleExpand}
                            activeOpacity={0.6}
                          >
                            <Text style={styles.expandBtnText}>
                              {isExpanded ? '▲ ' : '▼ '}{t('word.tap_to_expand')}
                            </Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.statsBtn}
                          onPress={async () => {
                            setStatsModalWord(item);
                            setWordStats(null);
                            setLoadingStats(true);
                            try {
                              const s = await fetchWordStats(item.id);
                              setWordStats(s);
                            } catch (e) {
                              setWordStats({ error: true });
                            } finally {
                              setLoadingStats(false);
                            }
                          }}
                          activeOpacity={0.6}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="analytics-outline" size={14} color={COLORS.textHint} />
                          <Text style={styles.statsBtnText}>{t('word_stats.title')}</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Розгорнутий breakdown */}
                    {isExpanded && hasV2Data && !bulkMode && (
                      <WordDifficultyBreakdown word={item} />
                    )}
                  </View>
                );

                if (bulkMode) return content;

                return (
                  <Swipeable
                    renderRightActions={() => (
                      <TouchableOpacity
                        style={styles.swipeDelete}
                        onPress={() => {
                          Alert.alert('Видалити слово?', `Видалити «${item.original}» зі списку?`, [
                            { text: 'Скасувати', style: 'cancel' },
                            {
                              text: 'Видалити',
                              style: 'destructive',
                              onPress: async () => {
                                try {
                                  setSelectedWords((prev) => (prev || []).filter((w) => w.id !== item.id));
                                  await removeWordFromList(selectedList.id, item.id);
                                  await loadLists({ silent: true });
                                } catch (e) {
                                  Alert.alert('Помилка', 'Не вдалося видалити слово');
                                  await refreshSelectedList();
                                }
                              },
                            },
                          ]);
                        }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="trash-outline" size={18} color={COLORS.surface} />
                        <Text style={styles.swipeDeleteText}>{t('common.delete')}</Text>
                      </TouchableOpacity>
                    )}
                    rightThreshold={40}
                  >
                    {content}
                  </Swipeable>
                );
              }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          )}

          {/* Bulk toolbar */}
          {bulkMode && (
            <View style={styles.bulkBar}>
              <TouchableOpacity
                style={styles.bulkBarBtn}
                onPress={() => {
                  if (selectedWordIds.size === displayWords.length) {
                    setSelectedWordIds(new Set());
                  } else {
                    setSelectedWordIds(new Set(displayWords.map((w) => w.id)));
                  }
                }}
              >
                <Text style={styles.bulkBarText}>
                  {selectedWordIds.size === displayWords.length ? t('lists.unselect_all') : t('lists.select_all')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.bulkBarBtn, selectedCount === 0 && styles.bulkBarBtnDisabled]}
                onPress={() => {
                  if (selectedCount === 0) return;
                  setMoveModalVisible(true);
                }}
                disabled={selectedCount === 0}
              >
                <Text style={styles.bulkBarText}>{t('common.move')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.bulkBarBtnDanger, selectedCount === 0 && styles.bulkBarBtnDisabled]}
                onPress={handleBulkDelete}
                disabled={selectedCount === 0}
              >
                <Text style={styles.bulkBarTextDanger}>{t('common.delete')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Move modal */}
          <Modal
            visible={moveModalVisible}
            transparent
            animationType="slide"
            onRequestClose={() => setMoveModalVisible(false)}
          >
            <Pressable style={styles.overlay} onPress={() => setMoveModalVisible(false)}>
              <Pressable style={styles.modal} onPress={() => {}}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Move to list</Text>
                  <TouchableOpacity onPress={() => setMoveModalVisible(false)}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalSubtitle}>{t('lists.select_target_list')}</Text>

                <FlatList
                  data={(lists || []).filter((l) => l.id !== selectedList.id)}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => {
                    const active = item.id === moveTargetListId;
                    return (
                      <TouchableOpacity
                        style={[styles.modalListItem, active && styles.modalListItemActive]}
                        onPress={() => setMoveTargetListId(item.id)}
                      >
                        <Ionicons name="folder-outline" size={18} color={COLORS.textMuted} />
                        <Text style={styles.modalListName}>{item.name}</Text>
                        {active && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
                      </TouchableOpacity>
                    );
                  }}
                  style={{ maxHeight: 240 }}
                />

                <TouchableOpacity
                  style={[styles.modalPrimaryBtn, !moveTargetListId && styles.bulkBarBtnDisabled]}
                  onPress={handleMoveConfirm}
                  disabled={!moveTargetListId}
                >
                  <Text style={styles.modalPrimaryText}>{t('common.continue')}</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>

          {/* Word Stats Modal */}
          <Modal
            visible={!!statsModalWord}
            transparent
            animationType="slide"
            statusBarTranslucent
            onRequestClose={() => { setStatsModalWord(null); setWordStats(null); }}
          >
            <Pressable
              style={styles.overlay}
              onPress={() => { setStatsModalWord(null); setWordStats(null); }}
            >
              <Pressable style={[styles.modal, { maxHeight: '80%' }]} onPress={() => {}}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {statsModalWord?.original || t('word_stats.title')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => { setStatsModalWord(null); setWordStats(null); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={20} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                </View>
                {statsModalWord?.translation ? (
                  <Text style={styles.statsModalTranslation}>{statsModalWord.translation}</Text>
                ) : null}

                {loadingStats ? (
                  <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                    <ActivityIndicator color={COLORS.primary} />
                  </View>
                ) : !wordStats || wordStats.error ? (
                  <Text style={styles.statsModalEmpty}>{t('word_stats.no_data')}</Text>
                ) : wordStats.total_attempts === 0 ? (
                  <Text style={styles.statsModalEmpty}>{t('word_stats.no_data')}</Text>
                ) : (
                  <ScrollView showsVerticalScrollIndicator={false}>
                    {/* Stats grid */}
                    <View style={styles.statsGrid}>
                      {[
                        {
                          label: t('word_stats.accuracy'),
                          value: wordStats.accuracy_pct != null ? `${wordStats.accuracy_pct}%` : '—',
                          color: wordStats.accuracy_pct >= 70 ? '#16a34a' : wordStats.accuracy_pct >= 40 ? '#ca8a04' : '#dc2626',
                        },
                        {
                          label: t('word_stats.attempts'),
                          value: String(wordStats.total_attempts),
                          color: COLORS.textPrimary,
                        },
                        {
                          label: t('word_stats.streak'),
                          value: String(wordStats.current_streak),
                          color: wordStats.current_streak >= 3 ? '#16a34a' : COLORS.textPrimary,
                        },
                        {
                          label: t('word_stats.avg_time'),
                          value: wordStats.avg_answer_ms
                            ? `${(wordStats.avg_answer_ms / 1000).toFixed(1)}s`
                            : '—',
                          color: COLORS.textPrimary,
                        },
                      ].map((s) => (
                        <View key={s.label} style={styles.statsGridItem}>
                          <Text style={[styles.statsGridValue, { color: s.color }]}>{s.value}</Text>
                          <Text style={styles.statsGridLabel}>{s.label}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Recent history */}
                    {wordStats.recent_events?.length > 0 && (
                      <View style={styles.statsHistorySection}>
                        <Text style={styles.statsHistoryTitle}>{t('word_stats.history')}</Text>
                        <View style={styles.statsHistoryDots}>
                          {wordStats.recent_events.slice(0, 20).map((e, i) => (
                            <View
                              key={i}
                              style={[
                                styles.historyDot,
                                { backgroundColor: e.result ? '#16a34a' : '#dc2626' },
                              ]}
                            />
                          ))}
                        </View>
                        {wordStats.history_limited && (
                          <Text style={styles.statsHistoryLimited}>{t('word_stats.history_limited')}</Text>
                        )}
                      </View>
                    )}
                  </ScrollView>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      </SafeAreaView>
    );
  }

  // === Вигляд з усіма списками ===
  const hasLists = (lists || []).length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>My Lists</Text>
          <View style={styles.subtitleRow}>
            <Text style={styles.subtitle}>
              {t('lists.totals_summary', { words: totals.totalWords, lists: totals.totalLists })}
            </Text>
            {listsUsage && (
              <Text style={styles.usageChip}>
                {t('lists.usage_lists', { used: listsUsage.listCount, max: listsUsage.maxLists })}
              </Text>
            )}
          </View>
        </View>

        {/* ── Recommendations entry block — right below totals header ── */}
        <View style={styles.recEntryBlock}>
          <View style={styles.recEntryHeader}>
            <Ionicons name="sparkles-outline" size={16} color={COLORS.accent} />
            <Text style={styles.recEntryTitle}>{t('rec.entry_title')}</Text>
            {recQuota && recActivationMet && (
              <Text style={styles.recEntryQuota}>
                {recQuota.left > 0
                  ? t('rec.entry_quota', { left: recQuota.left, max: recQuota.max })
                  : t('rec.entry_quota_empty')}
              </Text>
            )}
          </View>
          <Text style={styles.recEntrySubtitle}>{t('rec.entry_subtitle')}</Text>

          {!recActivationMet ? (
            <View style={styles.recActivationRow}>
              <Text style={styles.recActivationHint}>{t('rec.entry_activation_hint')}</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.recEntryBtn,
                recQuota?.left === 0 && styles.recEntryBtnDisabled,
              ]}
              onPress={() => setRecSetupVisible(true)}
              activeOpacity={0.8}
              disabled={recQuota?.left === 0}
            >
              <Ionicons name="sparkles" size={14} color="#fff" />
              <Text style={styles.recEntryBtnText}>{t('rec.entry_btn')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {loadingLists ? (
          <View style={{ paddingTop: 10, alignItems: 'center' }}>
            <ActivityIndicator />
          </View>
        ) : (
          <>
            {!hasLists ? (
              <View style={styles.emptyState}>
                <Ionicons name="folder-open-outline" size={28} color={COLORS.textMuted} />
                <Text style={styles.emptyTitle}>{t('lists.empty_cta')}</Text>
                <Text style={styles.emptySubtitle}>{t('lists.empty_words_subtitle')}</Text>
                <TouchableOpacity
                  style={styles.newListButton}
                  activeOpacity={0.6}
                  onPress={() => setNewListModalVisible(true)}
                >
                  <Text style={styles.newListText}>+ {t('lists.new_list_btn')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {(lists || []).map((list) => {
                  const st = listProgressMap[list.id];
                  const progress = st && st.total > 0
                    ? Math.round(((st.total - st.due) / st.total) * 100)
                    : 0;

                  const card = (
                    <TouchableOpacity
                      style={styles.listCard}
                      onPress={() => openList(list)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.listCardHeader}>
                        <View style={styles.listCardInfo}>
                          <Ionicons name="folder-outline" size={22} color={COLORS.textMuted} />
                          <View>
                            <Text style={styles.listCardName}>{list.name}</Text>
                            <View style={styles.listCardCountRow}>
                              <Text style={styles.listCardCount}>{formatWords(list.word_count || 0)}</Text>
                              {list.has_mixed_langs && (
                                <View style={styles.mixedLangTagSmall}>
                                  <Text style={styles.mixedLangTagSmallText}>{t('lists.mixed_langs_tag')}</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>
                        <Text style={styles.listCardPercent}>{progress}%</Text>
                      </View>

                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${progress}%` }]} />
                      </View>
                    </TouchableOpacity>
                  );

                  return (
                    <Swipeable
                      key={list.id}
                      renderRightActions={() => (
                        <TouchableOpacity
                          style={styles.swipeDelete}
                          onPress={() => confirmDeleteList(list)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="trash-outline" size={18} color={COLORS.surface} />
                          <Text style={styles.swipeDeleteText}>{t('common.delete')}</Text>
                        </TouchableOpacity>
                      )}
                      rightThreshold={40}
                    >
                      {card}
                    </Swipeable>
                  );
                })}

                <TouchableOpacity
                  style={styles.newListButton}
                  activeOpacity={0.6}
                  onPress={() => setNewListModalVisible(true)}
                >
                  <Text style={styles.newListText}>+ {t('lists.new_list_btn')}</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        <View style={{ height: 40 }} />

        {/* Recommendations modals */}
        <RecommendationsSetupScreen
          visible={recSetupVisible}
          onClose={() => setRecSetupVisible(false)}
          onResults={(results) => {
            setRecResults(results);
            setRecResultsVisible(true);
          }}
          lists={lists || []}
          quota={recQuota}
          isPro={isPro}
          defaultLang={recDefaultLang}
        />

        <RecommendationsResultsScreen
          visible={recResultsVisible}
          onClose={() => {
            setRecResultsVisible(false);
            setRecSetupVisible(false);
            setRecResults(null);
            // Refresh quota after closing
            fetchRecQuota().then(q => setRecQuota(q)).catch(() => {});
          }}
          onBack={() => {
            setRecResultsVisible(false);
          }}
          results={recResults}
          lists={lists || []}
          onWordsAdded={() => {
            loadLists({ silent: true });
          }}
        />

        {/* New list modal */}
        <Modal
          visible={newListModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setNewListModalVisible(false)}
        >
          <Pressable style={styles.overlay} onPress={() => setNewListModalVisible(false)}>
            <Pressable style={styles.modal} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('lists.new_list_title')}</Text>
                <TouchableOpacity onPress={() => setNewListModalVisible(false)}>
                  <Text style={styles.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modalSubtitle}>{t('lists.name_label')}</Text>
              <TextInput
                value={newListName}
                onChangeText={setNewListName}
                placeholder="Наприклад: Work / Travel / Verbs"
                placeholderTextColor={COLORS.textMuted}
                style={{
                  borderWidth: 1,
                  borderColor: COLORS.borderLight,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: COLORS.textPrimary,
                  marginBottom: 10,
                }}
              />

              <TouchableOpacity
                style={[styles.modalPrimaryBtn, creatingList && { opacity: 0.7 }]}
                onPress={handleCreateNewList}
                disabled={creatingList}
              >
                <Text style={styles.modalPrimaryText}>{creatingList ? t('lists.creating') : t('common.create')}</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, paddingHorizontal: SPACING.xl },

  // Header
  header: { paddingTop: SPACING.lg, paddingBottom: SPACING.sm },
  title: { fontSize: 28, fontWeight: '400', color: COLORS.primary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 },
  usageChip: { fontSize: 11, color: COLORS.textHint, backgroundColor: COLORS.borderLight, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },

  // ── Filter bar — wraps automatically, no hardcoded rows ────
  filterSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  filterDropBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  filterDropBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterDropText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  filterDropTextActive: { color: '#ffffff' },
  filterResetBtn: {
    marginLeft: 'auto',
    padding: 2,
  },

  // Dropdown panels (shown below filter bar)
  dropPanel: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginBottom: 8,
  },
  dropPanelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dropChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  dropChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  dropChipText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  dropChipTextActive: { color: '#ffffff' },
  dropDoneBtn: {
    alignSelf: 'flex-end',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  dropDoneBtnText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },

  // Lock pill for Free users in filter row
  filterLockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fefce8',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  filterLockPillText: { fontSize: 12, color: '#ca8a04', fontWeight: '600' },

  // Keep legacy styles (used elsewhere or as fallback)
  filterLockBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#fefce8',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fde68a',
    alignSelf: 'flex-start',
  },
  filterLockText: { fontSize: 11, color: '#92400e', fontWeight: '600' },
  filterLockCta: { fontSize: 11, color: '#ca8a04', fontWeight: '700' },

  // List card
  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  listCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  listCardInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  listCardName: { fontSize: 15, fontWeight: '500', color: COLORS.primary },
  listCardCount: { fontSize: 12, color: COLORS.textMuted },
  listCardPercent: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Courier' },

  progressTrack: { height: 3, backgroundColor: COLORS.borderLight, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: COLORS.accent },

  // New list button
  newListButton: {
    padding: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    marginTop: 4,
  },
  newListText: { fontSize: 14, color: COLORS.textMuted },

  // Details
  detailsTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { paddingVertical: SPACING.lg },
  backText: { fontSize: 13, color: COLORS.textMuted },
  bulkToggle: { paddingVertical: SPACING.lg, paddingHorizontal: 6 },
  bulkToggleText: { fontSize: 13, color: COLORS.textMuted },
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: SPACING.sm },
  listTitle: { fontSize: 24, fontWeight: '400', color: COLORS.primary },
  listSubtitle: { fontSize: 12, color: COLORS.textMuted },
  listSubtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  mixedLangTag: {
    backgroundColor: '#fef3c7',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  mixedLangTagText: { fontSize: 10, fontWeight: '700', color: '#92400e', letterSpacing: 0.2 },
  // Smaller variant for list cards in the main Lists tab
  listCardCountRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  mixedLangTagSmall: {
    backgroundColor: '#fef3c7',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  mixedLangTagSmallText: { fontSize: 9, fontWeight: '700', color: '#92400e', letterSpacing: 0.2 },

  // Practice info
  practiceInfoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACING.lg, paddingVertical: SPACING.sm, paddingHorizontal: 2,
  },
  practiceInfoText: { fontSize: 12, color: COLORS.textMuted, flex: 1 },
  practiceButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary, paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: BORDER_RADIUS.md,
  },
  practiceButtonText: { fontSize: 13, color: '#ffffff', fontWeight: '600' },

  // Word item
  wordItem: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
  },
  wordRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  expandBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.background,
  },
  expandBtnText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  checkboxWrap: { marginRight: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  checkboxChecked: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  wordLeft: { flex: 1 },
  wordHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  wordOriginal: { fontSize: 16, fontWeight: '500', color: COLORS.primary },
  wordTranslation: { fontSize: 13, color: COLORS.textMuted },
  wordRight: { width: 100 },

  swipeDelete: {
    width: 92,
    marginLeft: 8,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeDeleteText: { fontSize: 11, color: COLORS.surface, fontWeight: '600' },

  bulkBar: {
    position: 'absolute',
    left: SPACING.xl,
    right: SPACING.xl,
    bottom: 18,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  bulkBarBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  bulkBarBtnDanger: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#ef4444',
    alignItems: 'center',
  },
  bulkBarBtnDisabled: { opacity: 0.45 },
  bulkBarText: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '600' },
  bulkBarTextDanger: { fontSize: 12, color: COLORS.surface, fontWeight: '700' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    maxHeight: '70%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 16, fontWeight: '600', color: COLORS.primary },
  modalClose: { fontSize: 18, color: COLORS.textMuted, padding: 4 },
  modalSubtitle: { fontSize: 12, color: COLORS.textMuted, marginBottom: 10 },
  modalListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    gap: 10,
  },
  modalListItemActive: { backgroundColor: '#f6f7f8' },
  modalListName: { flex: 1, fontSize: 14, color: COLORS.textPrimary },
  modalPrimaryBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  modalPrimaryText: { fontSize: 13, color: COLORS.surface, fontWeight: '700' },

  // Empty states
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 18,
    gap: 10,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: COLORS.textPrimary, marginTop: 2 },
  emptySubtitle: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 18 },

  wordLang: {
  marginTop: 5,
  color: COLORS.textHint,
  fontSize: 12,
  fontWeight: '700',
},
  wordStateBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  wordStateBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  wordAltTranslations: {
  marginTop: 12,
},

  wordAltLabel: {
  color: COLORS.textHint,
  fontSize: 11,
  fontWeight: '800',
  letterSpacing: 0.8,
  textTransform: 'uppercase',
},
  idiomHeaderRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
},
  idiomToggle: {
  flexDirection: 'row',
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: 999,
  overflow: 'hidden',
  backgroundColor: COLORS.surface,
},
  idiomToggleBtn: {
  paddingHorizontal: 10,
  paddingVertical: 6,
},
  idiomToggleBtnActive: {
  backgroundColor: COLORS.card,
},
  idiomToggleText: {
  color: COLORS.textHint,
  fontSize: 11,
  fontWeight: '700',
},
  idiomToggleTextActive: {
  color: COLORS.textPrimary,
},
  wordAltText: {
  color: COLORS.textSecondary,
  fontSize: 12,
  lineHeight: 16,
  opacity: 0.9,
  marginBottom: 2,
},
  wordAltNote: {
  marginTop: 10,
  color: COLORS.textSecondary,
  fontSize: 12,
  lineHeight: 16,
},

  // ─── Search bar ───────────────────────────────────────────
  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 7,
  },
  searchIcon: { marginRight: 6 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
    padding: 0,
  },

  // ─── Word action row ─────────────────────────────────────
  wordActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  statsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
    opacity: 0.7,
  },
  statsBtnText: { fontSize: 11, color: COLORS.textHint },

  // ─── Word Stats Modal ────────────────────────────────────
  statsModalTranslation: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  statsModalEmpty: {
    fontSize: 14,
    color: COLORS.textHint,
    textAlign: 'center',
    paddingVertical: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  statsGridItem: {
    width: '47%',
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.md,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  statsGridValue: {
    fontSize: 26,
    fontWeight: '300',
    fontFamily: 'Courier',
  },
  statsGridLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  statsHistorySection: { marginTop: 4 },
  statsHistoryTitle: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 8, fontWeight: '600' },
  statsHistoryDots: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  historyDot: { width: 12, height: 12, borderRadius: 6 },
  statsHistoryLimited: {
    fontSize: 11,
    color: COLORS.textHint,
    marginTop: 8,
    fontStyle: 'italic',
  },

  // ─── Recommendations entry block ─────────────────────────────────────────
  recEntryBlock: {
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: '#bfdbfe', // light blue
    padding: SPACING.md,
    gap: 8,
  },
  recEntryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recEntryTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  recEntryQuota: {
    fontSize: 11,
    color: COLORS.accent,
    fontWeight: '500',
  },
  recEntrySubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  recActivationRow: {
    marginTop: 4,
  },
  recActivationHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  recEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.accent,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: 11,
    marginTop: 4,
  },
  recEntryBtnDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  recEntryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },

});