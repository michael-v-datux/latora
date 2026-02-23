/**
 * TranslateScreen.js — Головний екран перекладу
 *
 * Користувач вводить слово → отримує переклад + оцінку складності → може додати в список.
 * Додавання в список: через модалку вибору списку (реальні дані з бекенду).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
  Modal, Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import WordCard from '../components/WordCard';
import AlternativeWordCard from '../components/AlternativeWordCard';
import AddToListModal from '../components/AddToListModal';
import LanguagePickerModal from '../components/LanguagePickerModal';
import { translateWord, suggestList, fetchLanguages } from '../services/translateService';
import { fetchLists, createList, addWordToList, removeWordFromList } from '../services/listsService';
import { fetchMyProfile } from '../services/profileService';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';
import { useAuth } from '../hooks/useAuth';

// Ліміти альтернатив по плану
const MAX_ALTS = { free: 3, pro: 7 };

// History key is user-scoped to prevent leaking between accounts on the same device.
// Language preferences (source/target/pinned/recent) stay device-global — they're not
// sensitive and it's good UX to preserve them across sign-out/sign-in.
const historyKey = (userId) => userId ? `TRANSLATE_HISTORY_${userId}` : null;
const HISTORY_MAX = 25;

// ─── Ліміти вводу по плану ────────────────────────────────────────────────────
const INPUT_LIMITS = {
  free: { words: 6, chars: 80 },
  pro:  { words: 8, chars: 120 },
};

/**
 * Валідує введений текст відносно лімітів плану.
 * Повертає { ok, code, count? }
 */
function validateInput(text, limits) {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { ok: false, code: 'EMPTY' };

  // Структурні маркери речення — завжди блокуємо
  if (/\n/.test(text))                                 return { ok: false, code: 'SENTENCE_LIKE' };
  if (/;/.test(trimmed))                               return { ok: false, code: 'SENTENCE_LIKE' };
  if ((trimmed.match(/,/g) || []).length >= 2)         return { ok: false, code: 'SENTENCE_LIKE' };

  // Кількість слів (обчислюємо до перевірки пунктуації)
  const words = trimmed.split(/\s+/).filter(Boolean);

  // ?/!/. — блокуємо лише якщо фраза довга (> 5 слів).
  // Короткі фрази з пунктуацією (привітання, повсякденні вирази) — дозволяємо.
  // Наприклад: "Як справи?" (2 сл.) ✅   "I went to the store yesterday." (6 сл.) ❌
  const CONVERSATIONAL_THRESHOLD = 5;
  if (/[.!?]/.test(trimmed) && words.length > CONVERSATIONAL_THRESHOLD) {
    return { ok: false, code: 'SENTENCE_LIKE' };
  }
  if (words.length > limits.words) return { ok: false, code: 'TOO_LONG_WORDS', count: words.length };

  // Кількість символів
  if (trimmed.length > limits.chars) return { ok: false, code: 'TOO_LONG_CHARS', count: trimmed.length };

  return { ok: true, wordCount: words.length, charCount: trimmed.length };
}

export default function TranslateScreen() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [activeTab, setActiveTab] = useState('translate'); // 'translate' | 'history'
  const [history, setHistory] = useState([]);               // [{...wordObj, addedToListId}]
  const [historyAddedIds, setHistoryAddedIds] = useState({}); // { wordId: listId }
  const [pendingHistoryWord, setPendingHistoryWord] = useState(null);

  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Alternatives
  const [alternatives, setAlternatives] = useState([]);   // масив word-об'єктів
  const [selectedIds, setSelectedIds] = useState(new Set());  // Set id-шних чекбоксів
  const [addedAltIds, setAddedAltIds] = useState(new Set()); // Set вже доданих
  const [subscriptionPlan, setSubscriptionPlan] = useState('free');
  // Модалка для bulk-add альтернатив
  const [bulkAddModal, setBulkAddModal] = useState(false);
  // Тимчасово вибране слово для single-alt-add модалки
  const [pendingAltWord, setPendingAltWord] = useState(null);

const [sourceLang, setSourceLang] = useState('EN');
const [targetLang, setTargetLang] = useState('UK');
const [langModalVisible, setLangModalVisible] = useState(false);
const [langModalMode, setLangModalMode] = useState('source'); // 'source' | 'target'
const [deeplSource, setDeeplSource] = useState([]);
const [deeplTarget, setDeeplTarget] = useState([]);

const [pinnedLangs, setPinnedLangs] = useState([]);
const [recentSource, setRecentSource] = useState([]);
const [recentTarget, setRecentTarget] = useState([]);


  const [showModal, setShowModal] = useState(false);
  const [lists, setLists] = useState([]);
  const [suggestedListName, setSuggestedListName] = useState(null);
  const [suggestedListId, setSuggestedListId] = useState(null);

  const [isAdded, setIsAdded] = useState(false);
  // Для Revert: зберігаємо listId та wordId останнього доданого основного слова
  const [lastAddedListId, setLastAddedListId] = useState(null);

  // language mix confirm modal
  const [langMixModal, setLangMixModal] = useState(null); // null | { listId, listPair, newPair }

  // toast
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = (message) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };

  const saveToHistory = async (wordObj) => {
    const key = historyKey(userId);
    if (!key) return; // not logged in — don't save
    try {
      const savedRaw = await AsyncStorage.getItem(key);
      const prev = savedRaw ? JSON.parse(savedRaw) : [];
      // Видаляємо дублікат якщо вже є (за id)
      const filtered = prev.filter((w) => w.id !== wordObj.id);
      const next = [wordObj, ...filtered].slice(0, HISTORY_MAX);
      setHistory(next);
      await AsyncStorage.setItem(key, JSON.stringify(next));
    } catch (e) {
      // ignore
    }
  };

  // ── Load device-global preferences (once, on mount) ───────────────────────
  useEffect(() => {
    (async () => {
      try {
        const savedSource      = await AsyncStorage.getItem('TRANSLATE_SOURCE_LANG');
        const savedTarget      = await AsyncStorage.getItem('TRANSLATE_TARGET_LANG');
        const savedPinned      = await AsyncStorage.getItem('PINNED_LANGS');
        const savedRecentSource = await AsyncStorage.getItem('RECENT_SOURCE_LANGS');
        const savedRecentTarget = await AsyncStorage.getItem('RECENT_TARGET_LANGS');

        if (savedSource)      setSourceLang(savedSource);
        if (savedTarget)      setTargetLang(savedTarget);
        if (savedPinned)      setPinnedLangs(JSON.parse(savedPinned) || []);
        if (savedRecentSource) setRecentSource(JSON.parse(savedRecentSource) || []);
        if (savedRecentTarget) setRecentTarget(JSON.parse(savedRecentTarget) || []);
      } catch (e) {
        // ignore
      }

      try {
        const { source, target } = await fetchLanguages();
        setDeeplSource(source || []);
        setDeeplTarget(target || []);
      } catch (e) {
        // ignore; translate still works with defaults
      }
    })();
  }, []); // runs once — language prefs are device-global

  // ── Load per-user history whenever the logged-in user changes ─────────────
  // Resets to [] immediately when userId changes (sign-out / switch account),
  // then loads the correct user's history from their scoped key.
  useEffect(() => {
    setHistory([]);           // clear immediately so previous user's history isn't visible
    setHistoryAddedIds({});   // clear add-state as well

    const key = historyKey(userId);
    if (!key) return; // no user logged in — leave empty

    AsyncStorage.getItem(key)
      .then(raw => { if (raw) setHistory(JSON.parse(raw) || []); })
      .catch(() => {});
  }, [userId]);

useEffect(() => {
  AsyncStorage.setItem('TRANSLATE_SOURCE_LANG', sourceLang).catch(() => {});
}, [sourceLang]);

useEffect(() => {
  AsyncStorage.setItem('TRANSLATE_TARGET_LANG', targetLang).catch(() => {});
}, [targetLang]);

// Завантажуємо план підписки для обмеження альтернатив
useEffect(() => {
  fetchMyProfile()
    .then((profile) => {
      if (profile?.subscription_plan) setSubscriptionPlan(profile.subscription_plan);
    })
    .catch(() => {}); // Якщо не залогінений — лишаємо 'free'
}, []);

const togglePin = async (code) => {
  const c = String(code || '').toUpperCase();
  const next = pinnedLangs.includes(c)
    ? pinnedLangs.filter((x) => x !== c)
    : [c, ...pinnedLangs].slice(0, 12);

  setPinnedLangs(next);
  await AsyncStorage.setItem('PINNED_LANGS', JSON.stringify(next)).catch(() => {});
};

const pushRecent = async (mode, code) => {
  const c = String(code || '').toUpperCase();
  if (mode === 'source') {
    const next = [c, ...recentSource.filter((x) => x !== c)].slice(0, 10);
    setRecentSource(next);
    await AsyncStorage.setItem('RECENT_SOURCE_LANGS', JSON.stringify(next)).catch(() => {});
  } else {
    const next = [c, ...recentTarget.filter((x) => x !== c)].slice(0, 10);
    setRecentTarget(next);
    await AsyncStorage.setItem('RECENT_TARGET_LANGS', JSON.stringify(next)).catch(() => {});
  }
};

const openLangModal = (mode) => {
  setLangModalMode(mode);
  setLangModalVisible(true);
};

const normalizeToSource = (code) => String(code || '').toUpperCase().split('-')[0];

const handleSwap = () => {
  const newSource = normalizeToSource(targetLang);
  const newTarget = sourceLang;

  // sanity: if newSource is empty, do nothing
  if (!newSource || !newTarget) return;

  setSourceLang(newSource);
  setTargetLang(newTarget);

  pushRecent('source', newSource);
  pushRecent('target', newTarget);
};

  const limits       = INPUT_LIMITS[subscriptionPlan] ?? INPUT_LIMITS.free;
  const validation   = useMemo(() => validateInput(query, limits), [query, limits]);
  const wordCount    = useMemo(() => query.trim() ? query.trim().split(/\s+/).filter(Boolean).length : 0, [query]);
  const charCount    = useMemo(() => query.trim().length, [query]);
  const canTranslate = validation.ok;

  const handleTranslate = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setIsAdded(false);
    setLastAddedListId(null);
    setAlternatives([]);
    setSelectedIds(new Set());
    setAddedAltIds(new Set());

    try {
      const data = await translateWord(query, sourceLang, targetLang);

      if (data?.error) {
        setError(data.error); // "Цього слова немає у словнику"
        setResult(null);
        return;
      }

      setResult(data);
      if (data?.id) saveToHistory(data);

      // Альтернативи приходять у відповіді (вже обрізані до ліміту плану на сервері)
      // Додатково обрізаємо на клієнті якщо план вже оновився
      const planLimit = MAX_ALTS[subscriptionPlan] ?? 3;
      const alts = Array.isArray(data?.alternatives) ? data.alternatives.slice(0, planLimit) : [];
      setAlternatives(alts);
    } catch (err) {
      // Handle structured limit errors from server (429)
      const errorCode = err?.response?.data?.errorCode || err?.data?.errorCode;
      if (errorCode === 'AI_LIMIT_REACHED') {
        const limit = err?.response?.data?.limit || err?.data?.limit || 5;
        const resetAt = err?.response?.data?.resetAt || err?.data?.resetAt || null;
        setError(`__AI_LIMIT__${limit}__${resetAt || ''}`); // special sentinel for UI
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const openAddToListModal = async () => {
    if (!result?.id) return;

    setShowModal(true);
    setSuggestedListName(null);
    setSuggestedListId(null);

    try {
      const [listsData, suggestion] = await Promise.all([
        fetchLists(),
        suggestList(result.id),
      ]);

      const safeLists = Array.isArray(listsData) ? listsData : (listsData?.lists || []);
      setLists(safeLists);

      if (suggestion?.suggested_list_id) {
        setSuggestedListId(suggestion.suggested_list_id);
        setSuggestedListName(suggestion.suggested_list_name || null);
      }
    } catch (e) {
      // якщо щось пішло не так — все одно показуємо модалку, але без рекомендації
      console.warn('Failed to open modal:', e?.message);
    }
  };

  const handleAddToList = async (listId, opts = {}) => {
    try {
      if (!result?.id) return;

      await addWordToList(listId, result.id, opts);

      setShowModal(false);
      setIsAdded(true);
      setLastAddedListId(listId);
      const listName = (lists || []).find((l) => l.id === listId)?.name;
      showToast(listName ? `✓ Додано у «${listName}»` : '✓ Додано у список');
    } catch (e) {
      // 409 LANG_MIX_CONFIRM — показуємо попап-підтвердження
      if (e?.status === 409 && e?.data?.code === 'LANG_MIX_CONFIRM') {
        setShowModal(false);
        setLangMixModal({
          listId,
          listPair: e.data.list_pair || '',
          newPair: e.data.new_pair || '',
        });
        return;
      }
      console.warn('Add to list failed:', e?.message);
      Alert.alert('Помилка', 'Не вдалося додати слово у список');
    }
  };

  // ─── History handlers ─────────────────────────────────────────────────────

  const openHistoryWordModal = (histWord) => {
    setPendingHistoryWord(histWord);
    setShowModal(true);
    setSuggestedListName(null);
    setSuggestedListId(null);

    Promise.all([fetchLists(), suggestList(histWord.id)])
      .then(([listsData, suggestion]) => {
        setLists(Array.isArray(listsData) ? listsData : (listsData?.lists || []));
        if (suggestion?.suggested_list_id) {
          setSuggestedListId(suggestion.suggested_list_id);
          setSuggestedListName(suggestion.suggested_list_name || null);
        }
      })
      .catch((e) => console.warn('openHistoryWordModal failed:', e?.message));
  };

  const handleHistoryAddToList = async (listId, opts = {}) => {
    try {
      const wordToAdd = pendingHistoryWord;
      if (!wordToAdd?.id) return;

      await addWordToList(listId, wordToAdd.id, opts);

      setShowModal(false);
      setPendingHistoryWord(null);
      setHistoryAddedIds((prev) => ({ ...prev, [wordToAdd.id]: listId }));
      const listName = (lists || []).find((l) => l.id === listId)?.name;
      showToast(listName ? `✓ Додано у «${listName}»` : '✓ Додано у список');
    } catch (e) {
      if (e?.status === 409 && e?.data?.code === 'LANG_MIX_CONFIRM') {
        setShowModal(false);
        setLangMixModal({
          listId,
          listPair: e.data.list_pair || '',
          newPair: e.data.new_pair || '',
          _isHistory: true,
        });
        return;
      }
      console.warn('History add to list failed:', e?.message);
      Alert.alert('Помилка', 'Не вдалося додати слово у список');
    }
  };

  const handleHistoryRevert = async (histWord) => {
    const listId = historyAddedIds[histWord.id];
    if (!listId) return;
    try {
      await removeWordFromList(listId, histWord.id);
      setHistoryAddedIds((prev) => {
        const next = { ...prev };
        delete next[histWord.id];
        return next;
      });
      showToast('↩ Видалено зі списку');
    } catch (e) {
      console.warn('History revert failed:', e?.message);
    }
  };

  const handleRevert = async () => {
    if (!result?.id || !lastAddedListId) return;
    try {
      await removeWordFromList(lastAddedListId, result.id);
      setIsAdded(false);
      setLastAddedListId(null);
      showToast('↩ Видалено зі списку');
    } catch (e) {
      console.warn('Revert failed:', e?.message);
      showToast('Не вдалось скасувати');
    }
  };

  const handleCreateNewList = () => {
    // iOS: Alert.prompt доступний; Android — fallback
    const create = async (name) => {
      const listName = (name || '').trim() || 'My Words';

      try {
        const newList = await createList({ name: listName });
        // оновлюємо списки і одразу додаємо слово в новий
        const updated = await fetchLists();
        setLists(Array.isArray(updated) ? updated : (updated?.lists || []));
        await handleAddToList(newList.id);
      } catch (e) {
        console.warn('Create list failed:', e?.message);
        Alert.alert('Помилка', 'Не вдалося створити список');
      }
    };

    if (Platform.OS === 'ios' && Alert.prompt) {
      Alert.prompt('New list', 'Назва списку', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Create', onPress: (value) => create(value) },
      ]);
    } else {
      // простий fallback
      create('My Words');
    }
  };

  // ─── Alternatives handlers ────────────────────────────────────────────────

  const toggleAltSelection = (altId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(altId)) {
        next.delete(altId);
      } else {
        next.add(altId);
      }
      return next;
    });
  };

  // Додати одну альтернативу (з expandedContent картки)
  const openAltAddModal = (altWord) => {
    // Встановлюємо тимчасовий result для AddToListModal — через pendingAlt state
    setPendingAltWord(altWord);
    setShowModal(true);
    setSuggestedListName(null);
    setSuggestedListId(null);

    Promise.all([fetchLists(), suggestList(altWord.id)])
      .then(([listsData, suggestion]) => {
        setLists(Array.isArray(listsData) ? listsData : (listsData?.lists || []));
        if (suggestion?.suggested_list_id) {
          setSuggestedListId(suggestion.suggested_list_id);
          setSuggestedListName(suggestion.suggested_list_name || null);
        }
      })
      .catch((e) => console.warn('openAltAddModal failed:', e?.message));
  };

  const handleAltAddToList = async (listId, opts = {}) => {
    try {
      const wordToAdd = pendingAltWord;
      if (!wordToAdd?.id) return;

      await addWordToList(listId, wordToAdd.id, opts);

      setShowModal(false);
      setPendingAltWord(null);
      setAddedAltIds((prev) => new Set([...prev, wordToAdd.id]));
      const listName = (lists || []).find((l) => l.id === listId)?.name;
      showToast(listName ? `✓ Додано у «${listName}»` : '✓ Додано у список');
    } catch (e) {
      if (e?.status === 409 && e?.data?.code === 'LANG_MIX_CONFIRM') {
        setShowModal(false);
        setLangMixModal({
          listId,
          listPair: e.data.list_pair || '',
          newPair: e.data.new_pair || '',
          _isAlt: true,
        });
        return;
      }
      console.warn('Alt add to list failed:', e?.message);
      Alert.alert('Помилка', 'Не вдалося додати слово у список');
    }
  };

  // Відкрити модалку для bulk-додавання вибраних альтернатив
  const openBulkAddModal = async () => {
    setBulkAddModal(true);
    setSuggestedListName(null);
    setSuggestedListId(null);

    try {
      const listsData = await fetchLists();
      setLists(Array.isArray(listsData) ? listsData : (listsData?.lists || []));
    } catch (e) {
      console.warn('openBulkAddModal failed:', e?.message);
    }
  };

  const handleBulkAddToList = async (listId, opts = {}) => {
    setBulkAddModal(false);

    const selectedAlts = alternatives.filter((a) => selectedIds.has(a.id));
    if (selectedAlts.length === 0) return;

    let added = 0;
    let langMixEncountered = false;

    for (const alt of selectedAlts) {
      try {
        await addWordToList(listId, alt.id, opts);
        added++;
        setAddedAltIds((prev) => new Set([...prev, alt.id]));
      } catch (e) {
        if (e?.status === 409 && e?.data?.code === 'LANG_MIX_CONFIRM') {
          if (!langMixEncountered) {
            // Показуємо mix confirm один раз — apply to all
            langMixEncountered = true;
            setLangMixModal({
              listId,
              listPair: e.data.list_pair || '',
              newPair: e.data.new_pair || '',
              _isBulk: true,
              _bulkOpts: opts,
            });
          }
          break;
        }
        console.warn('Bulk add failed for:', alt.id, e?.message);
      }
    }

    if (added > 0 && !langMixEncountered) {
      const listName = (lists || []).find((l) => l.id === listId)?.name;
      const msg = listName
        ? `✓ Додано ${added} слів у «${listName}»`
        : `✓ Додано ${added} слів у список`;
      showToast(msg);
      setSelectedIds(new Set());
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
  <Text style={styles.title}>{t('translate.title')}</Text>

  {/* ─── Screen tabs: Translate / History ─── */}
  <View style={styles.screenTabs}>
    <TouchableOpacity
      style={[styles.screenTab, activeTab === 'translate' && styles.screenTabActive]}
      onPress={() => setActiveTab('translate')}
      activeOpacity={0.7}
    >
      <Text style={[styles.screenTabText, activeTab === 'translate' && styles.screenTabTextActive]}>
        {t('translate.tab_translate')}
      </Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.screenTab, activeTab === 'history' && styles.screenTabActive]}
      onPress={() => setActiveTab('history')}
      activeOpacity={0.7}
    >
      <Text style={[styles.screenTabText, activeTab === 'history' && styles.screenTabTextActive]}>
        {t('translate.tab_history')}
        {history.length > 0 ? ` (${history.length})` : ''}
      </Text>
    </TouchableOpacity>
  </View>

  {activeTab === 'translate' && (
    <>
      <View style={styles.langRow}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => openLangModal('source')}
          style={styles.langBubble}
        >
          <Text style={styles.langBubbleText}>{sourceLang}</Text>
          <Ionicons name="chevron-down" size={14} color={COLORS.textHint} />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.9}
          onPress={handleSwap}
          style={styles.swapBtn}
        >
          <Ionicons name="swap-horizontal" size={18} color={COLORS.primary} />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => openLangModal('target')}
          style={styles.langBubble}
        >
          <Text style={styles.langBubbleText}>{targetLang}</Text>
          <Ionicons name="chevron-down" size={14} color={COLORS.textHint} />
        </TouchableOpacity>
      </View>

      {/* subtitle removed: language pair already visible in the pickers above */}
    </>
  )}
</View>

{/* ─── History tab content ─── */}
{activeTab === 'history' && (
  <View style={styles.historyContainer}>
    {history.length === 0 ? (
      <View style={styles.historyEmpty}>
        <Text style={styles.historyEmptyIcon}>🕐</Text>
        <Text style={styles.historyEmptyTitle}>{t('translate.history_empty_title')}</Text>
        <Text style={styles.historyEmptySubtitle}>{t('translate.history_empty_sub')}</Text>
      </View>
    ) : (
      history.map((histWord) => {
        const isHistAdded = !!historyAddedIds[histWord.id];
        return (
          <View key={histWord.id} style={styles.historyCard}>
            <View style={styles.historyCardHeader}>
              <View style={styles.historyCardLeft}>
                <Text style={styles.historyCardWord}>{histWord.original}</Text>
                {histWord.transcription ? (
                  <Text style={styles.historyCardTranscription}>{histWord.transcription}</Text>
                ) : null}
              </View>
              <View style={styles.historyCardRight}>
                {histWord.cefr_level ? (
                  <Text style={styles.historyCardCefr}>{histWord.cefr_level}</Text>
                ) : null}
                <Text style={styles.historyCardLang}>
                  {histWord.source_lang} → {histWord.target_lang}
                </Text>
              </View>
            </View>
            <Text style={styles.historyCardTranslation}>{histWord.translation}</Text>
            {!!(locale === 'uk' ? (histWord.definition_uk || histWord.definition) : histWord.definition) && (
              <Text style={styles.historyCardDefinition}>
                {locale === 'uk' ? (histWord.definition_uk || histWord.definition) : histWord.definition}
              </Text>
            )}
            {isHistAdded ? (
              <View style={styles.historyAddedRow}>
                <Text style={styles.historyAddedText}>✓ {t('lists.added_to_list_short')}</Text>
                <TouchableOpacity
                  style={styles.historyRevertBtn}
                  onPress={() => handleHistoryRevert(histWord)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.historyRevertText}>{t('word.revert')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.historyAddBtn}
                onPress={() => openHistoryWordModal(histWord)}
                activeOpacity={0.7}
              >
                <Text style={styles.historyAddBtnText}>+ {t('lists.add_to_list')}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })
    )}
  </View>
)}

{activeTab === 'translate' && (
<View style={styles.inputCard}>
  <Text style={styles.inputLabel}>{t('translate.input_label')}</Text>
  <View style={styles.inputWrap}>
    <TextInput
      style={styles.input}
      value={query}
      onChangeText={setQuery}
      placeholder={t('translate.placeholder')}
      placeholderTextColor={COLORS.textHint}
      returnKeyType="search"
      onSubmitEditing={canTranslate ? handleTranslate : undefined}
      autoCorrect={false}   // no silent auto-replacement — user decides via tap
      spellCheck={true}     // OS underlines typos natively (like Notes / Messages)
      autoCapitalize="none"
      multiline={true}
      scrollEnabled={false}
      textAlignVertical="top"
      blurOnSubmit={true}
    />
    {query.length > 0 && (
      <TouchableOpacity
        onPress={() => {
          setQuery('');
          setResult(null);
          setError(null);
          setAlternatives([]);
          setIsAdded(false);
          setLastAddedListId(null);
          setSelectedIds(new Set());
          setAddedAltIds(new Set());
        }}
        hitSlop={12}
        style={styles.clearBtn}
      >
        <Ionicons name="close-circle" size={18} color={COLORS.textHint} />
      </TouchableOpacity>
    )}
  </View>

  {/* Лічильник слів/символів */}
  {query.trim().length > 0 && (
    <View style={styles.inputCounterRow}>
      <Text style={[
        styles.inputCounter,
        !validation.ok && validation.code !== 'EMPTY' && styles.inputCounterError,
      ]}>
        {wordCount}/{limits.words} {t('translate.counter_words')} · {charCount}/{limits.chars} {t('translate.counter_chars')}
      </Text>
    </View>
  )}

  {/* Inline повідомлення про помилку валідації */}
  {!validation.ok && validation.code !== 'EMPTY' && query.trim().length > 0 && (
    <Text style={styles.inputValidationMsg}>
      {validation.code === 'SENTENCE_LIKE'
        ? t('translate.err_sentence')
        : validation.code === 'TOO_LONG_WORDS'
          ? t('translate.err_too_long_words', { max: limits.words })
          : validation.code === 'TOO_LONG_CHARS'
            ? t('translate.err_too_long_chars', { max: limits.chars })
            : ''}
    </Text>
  )}

  <TouchableOpacity
    style={[styles.primaryBtn, !canTranslate && styles.primaryBtnDisabled]}
    onPress={handleTranslate}
    disabled={!canTranslate || loading}
    activeOpacity={0.8}
  >
    {loading ? (
      <ActivityIndicator size="small" color="#ffffff" />
    ) : (
      <Text style={styles.primaryBtnText}>{t('translate.button')}</Text>
    )}
  </TouchableOpacity>

  <Text style={styles.hint}>{t('translate.hint')}</Text>
</View>
)}

{activeTab === 'translate' && error && (
            error.startsWith('__AI_LIMIT__') ? (() => {
              // Parse sentinel: __AI_LIMIT__<limit>__<resetAt>
              const parts = error.replace('__AI_LIMIT__', '').split('__');
              const limitNum = parts[0];
              const resetAtStr = parts[1] || '';
              let resetLabel = '';
              if (resetAtStr) {
                try {
                  const resetDate = new Date(resetAtStr);
                  const hoursLeft = Math.ceil((resetDate - Date.now()) / (1000 * 60 * 60));
                  resetLabel = hoursLeft > 0 ? ` (resets in ~${hoursLeft}h)` : '';
                } catch {}
              }
              return (
                <View style={styles.limitBox}>
                  <Text style={styles.limitTitle}>{t('translate.limit_ai_title')}</Text>
                  <Text style={styles.limitBody}>
                    {t('translate.limit_ai_body', { max: limitNum })}{resetLabel}
                  </Text>
                  <TouchableOpacity
                    style={styles.limitUpgradeBtn}
                    onPress={() => setError(null)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.limitUpgradeText}>{t('translate.limit_ai_upgrade')}</Text>
                  </TouchableOpacity>
                </View>
              );
            })() : (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )
          )}

          {activeTab === 'translate' && result && (
            <View style={styles.resultContainer}>
              <WordCard
                word={result}
                onAddToList={openAddToListModal}
                isAdded={isAdded}
                onRevert={isAdded ? handleRevert : null}
              />
            </View>
          )}

          {/* ─── Alternatives section ─── */}
          {activeTab === 'translate' && result && alternatives.length > 0 && (
            <View style={styles.altSection}>
              {/* Section header */}
              <View style={styles.altSectionHeader}>
                <Text style={styles.altSectionTitle}>{t('translate.alternatives_title')}</Text>
                {subscriptionPlan === 'free' && alternatives.length >= (MAX_ALTS.free) && (
                  <View style={styles.proTeaser}>
                    <Text style={styles.proTeaserText}>{t('translate.pro_teaser')}</Text>
                  </View>
                )}
              </View>

              {alternatives.map((alt) => (
                <AlternativeWordCard
                  key={alt.id}
                  word={alt}
                  isSelected={selectedIds.has(alt.id)}
                  onToggle={() => toggleAltSelection(alt.id)}
                  onAddToList={() => openAltAddModal(alt)}
                  isAdded={addedAltIds.has(alt.id)}
                  isPro={subscriptionPlan === 'pro'}
                />
              ))}

              {/* Bulk-add button (shows when ≥1 selected) */}
              {selectedIds.size > 0 && (
                <TouchableOpacity
                  style={styles.bulkAddBtn}
                  onPress={openBulkAddModal}
                  activeOpacity={0.8}
                >
                  <Text style={styles.bulkAddBtnText}>
                    {t('translate.add_selected', { count: selectedIds.size })}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={{ height: 40 }} />
        
<LanguagePickerModal
  visible={langModalVisible}
  onClose={() => setLangModalVisible(false)}
  mode={langModalMode}
  languagesSource={deeplSource}
  languagesTarget={deeplTarget}
  selectedSource={sourceLang}
  selectedTarget={targetLang}
  pinned={pinnedLangs}
  recent={langModalMode === 'source' ? recentSource : recentTarget}
  onTogglePin={togglePin}
  onSelect={(code) => {
    setLangModalVisible(false);
    if (langModalMode === 'source') {
      const v = String(code).toUpperCase().split('-')[0];
      setSourceLang(v);
      pushRecent('source', v);
    } else {
      const v = String(code).toUpperCase();
      setTargetLang(v);
      pushRecent('target', v);
    }
  }}
/>
</ScrollView>

        {/* toast */}
        {toast && (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}

        <AddToListModal
          visible={showModal}
          lists={lists}
          suggestedList={suggestedListName}
          onSelect={
            pendingAltWord ? handleAltAddToList
            : pendingHistoryWord ? handleHistoryAddToList
            : handleAddToList
          }
          onClose={() => { setShowModal(false); setPendingAltWord(null); setPendingHistoryWord(null); }}
          onCreateNew={() => {
            setShowModal(false);
            setPendingAltWord(null);
            setPendingHistoryWord(null);
            handleCreateNewList();
          }}
        />

        {/* Модалка bulk-add вибраних альтернатив */}
        <AddToListModal
          visible={bulkAddModal}
          lists={lists}
          suggestedList={null}
          onSelect={handleBulkAddToList}
          onClose={() => setBulkAddModal(false)}
          onCreateNew={() => {
            setBulkAddModal(false);
            handleCreateNewList();
          }}
        />

        {/* Попап підтвердження: додати слово з іншою мовною парою */}
        <Modal
          visible={!!langMixModal}
          transparent
          animationType="fade"
          onRequestClose={() => setLangMixModal(null)}
        >
          <Pressable style={styles.mixOverlay} onPress={() => setLangMixModal(null)}>
            <Pressable style={styles.mixModal} onPress={() => {}}>
              <Text style={styles.mixTitle}>{t('lists.mix_confirm_title')}</Text>
              <Text style={styles.mixBody}>
                {t('lists.mix_confirm_body', {
                  listPair: langMixModal?.listPair || '',
                  newPair: langMixModal?.newPair || '',
                })}
              </Text>
              <View style={styles.mixButtons}>
                <TouchableOpacity
                  style={styles.mixBtnCancel}
                  onPress={() => setLangMixModal(null)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.mixBtnCancelText}>{t('lists.mix_confirm_cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.mixBtnAdd}
                  onPress={() => {
                    const info = langMixModal;
                    setLangMixModal(null);
                    if (info._isBulk) {
                      // Повторюємо bulk-add з forceMix
                      handleBulkAddToList(info.listId, { ...info._bulkOpts, forceMix: true });
                    } else if (info._isAlt) {
                      handleAltAddToList(info.listId, { forceMix: true });
                    } else if (info._isHistory) {
                      handleHistoryAddToList(info.listId, { forceMix: true });
                    } else {
                      handleAddToList(info.listId, { forceMix: true });
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.mixBtnAddText}>{t('lists.mix_confirm_add')}</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    marginTop: SPACING.md,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    marginTop: SPACING.md,
  },
  scrollView: {
    flex: 1,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  header: {
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: '400',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 11,
    color: COLORS.textHint,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  inputCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  input: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    color: COLORS.primary,
    fontWeight: '400',
    letterSpacing: -0.3,
    paddingVertical: 0,
    textAlignVertical: 'top',
  },
  inputCounterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  inputCounter: {
    fontSize: 11,
    color: COLORS.textHint,
    fontFamily: 'Courier',
  },
  inputCounterError: {
    color: '#ca8a04',
  },
  inputValidationMsg: {
    fontSize: 12,
    color: '#ca8a04',
    marginTop: 6,
    marginBottom: 2,
    lineHeight: 17,
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  hint: {
    fontSize: 11,
    color: COLORS.textHint,
    letterSpacing: 0.3,
    flex: 1,
    marginTop: SPACING.md,
  },
  translateButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  translateButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  translateButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  translateButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: BORDER_RADIUS.md,
    padding: 12,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
  },
  limitBox: {
    backgroundColor: '#fefce8',
    borderRadius: BORDER_RADIUS.md,
    padding: 14,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: '#fde68a',
    gap: 6,
  },
  limitTitle: {
    color: '#92400e',
    fontSize: 13,
    fontWeight: '700',
  },
  limitBody: {
    color: '#78350f',
    fontSize: 12,
    lineHeight: 17,
  },
  limitUpgradeBtn: {
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#ca8a04',
  },
  limitUpgradeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  resultContainer: {
    marginBottom: SPACING.lg,
  },

  toast: {
    position: 'absolute',
    left: SPACING.xl,
    right: SPACING.xl,
    bottom: 22,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  toastText: {
    color: '#fff',
    fontSize: 13,
  },

langRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  marginTop: SPACING.md,
},
langBubble: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderRadius: 999,
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.border,
},
langBubbleText: {
  fontSize: 13,
  fontWeight: '700',
  color: COLORS.primary,
  letterSpacing: 0.2,
},
swapBtn: {
  width: 40,
  height: 40,
  borderRadius: 999,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.border,
},
inputWrap: {
  flexDirection: 'row',
  alignItems: 'center',
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: BORDER_RADIUS.md,
  backgroundColor: COLORS.surface,
  paddingHorizontal: SPACING.md,
  paddingVertical: 12,
},
clearBtn: {
  marginLeft: 8,
  alignSelf: 'center',
},
primaryBtn: {
  marginTop: SPACING.md,
  backgroundColor: COLORS.primary,
  paddingVertical: 14,
  borderRadius: BORDER_RADIUS.md,
  alignItems: 'center',
  justifyContent: 'center',
},
primaryBtnDisabled: {
  opacity: 0.5,
},
primaryBtnText: {
  color: '#ffffff',
  fontWeight: '700',
  fontSize: 14,
},


inputLabel: {
  color: COLORS.textHint,
  fontSize: 12,
  fontWeight: '700',
  marginBottom: 8,
  letterSpacing: 0.3,
},

// Language mix confirm modal
mixOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.4)',
  justifyContent: 'center',
  alignItems: 'center',
  padding: 32,
},
mixModal: {
  backgroundColor: COLORS.surface,
  borderRadius: BORDER_RADIUS.xl,
  padding: 24,
  width: '100%',
  maxWidth: 320,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.15,
  shadowRadius: 12,
  elevation: 8,
},
mixTitle: {
  fontSize: 16,
  fontWeight: '600',
  color: COLORS.primary,
  marginBottom: 10,
},
mixBody: {
  fontSize: 14,
  color: COLORS.textSecondary,
  lineHeight: 20,
  marginBottom: 20,
},
mixButtons: {
  flexDirection: 'row',
  gap: 10,
},
mixBtnCancel: {
  flex: 1,
  paddingVertical: 12,
  borderRadius: BORDER_RADIUS.md,
  borderWidth: 1,
  borderColor: COLORS.border,
  alignItems: 'center',
},
mixBtnCancelText: {
  fontSize: 14,
  fontWeight: '600',
  color: COLORS.textSecondary,
},
mixBtnAdd: {
  flex: 1,
  paddingVertical: 12,
  borderRadius: BORDER_RADIUS.md,
  backgroundColor: COLORS.primary,
  alignItems: 'center',
},
mixBtnAddText: {
  fontSize: 14,
  fontWeight: '600',
  color: '#ffffff',
},

// ─── Screen tabs ─────────────────────────────────────────────────────────
screenTabs: {
  flexDirection: 'row',
  marginTop: SPACING.md,
  borderRadius: BORDER_RADIUS.md,
  borderWidth: 1,
  borderColor: COLORS.border,
  backgroundColor: COLORS.surface,
  overflow: 'hidden',
},
screenTab: {
  flex: 1,
  paddingVertical: 9,
  alignItems: 'center',
  justifyContent: 'center',
},
screenTabActive: {
  backgroundColor: COLORS.primary,
},
screenTabText: {
  fontSize: 13,
  fontWeight: '600',
  color: COLORS.textMuted,
},
screenTabTextActive: {
  color: '#ffffff',
},

// ─── History ──────────────────────────────────────────────────────────────
historyContainer: {
  paddingTop: SPACING.lg,
  gap: SPACING.md,
},
historyEmpty: {
  alignItems: 'center',
  paddingVertical: 60,
  paddingHorizontal: 24,
},
historyEmptyIcon: {
  fontSize: 36,
  marginBottom: 12,
},
historyEmptyTitle: {
  fontSize: 16,
  fontWeight: '600',
  color: COLORS.textPrimary,
  marginBottom: 6,
  textAlign: 'center',
},
historyEmptySubtitle: {
  fontSize: 14,
  color: COLORS.textMuted,
  textAlign: 'center',
  lineHeight: 20,
},
historyCard: {
  backgroundColor: COLORS.surface,
  borderRadius: BORDER_RADIUS.lg,
  padding: SPACING.lg,
  borderWidth: 1,
  borderColor: COLORS.border,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.03,
  shadowRadius: 2,
  elevation: 1,
},
historyCardHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: 6,
},
historyCardLeft: {
  flex: 1,
},
historyCardRight: {
  alignItems: 'flex-end',
  gap: 4,
},
historyCardWord: {
  fontSize: 18,
  fontWeight: '500',
  color: COLORS.primary,
},
historyCardTranscription: {
  fontSize: 12,
  color: COLORS.textMuted,
  fontFamily: 'Courier',
  marginTop: 2,
},
historyCardCefr: {
  fontSize: 11,
  fontWeight: '700',
  color: COLORS.textMuted,
  paddingHorizontal: 7,
  paddingVertical: 2,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: COLORS.border,
},
historyCardLang: {
  fontSize: 11,
  color: COLORS.textHint,
},
historyCardTranslation: {
  fontSize: 15,
  fontWeight: '500',
  color: COLORS.textPrimary,
  marginBottom: 4,
},
historyCardDefinition: {
  fontSize: 12,
  color: COLORS.textSecondary,
  fontStyle: 'italic',
  marginBottom: 10,
  lineHeight: 18,
},
historyAddBtn: {
  marginTop: 10,
  paddingVertical: 9,
  borderRadius: BORDER_RADIUS.md,
  borderWidth: 1,
  borderColor: COLORS.border,
  backgroundColor: '#fafbfc',
  alignItems: 'center',
},
historyAddBtnText: {
  fontSize: 13,
  fontWeight: '500',
  color: COLORS.textPrimary,
},
historyAddedRow: {
  flexDirection: 'row',
  alignItems: 'center',
  marginTop: 10,
  borderRadius: BORDER_RADIUS.md,
  borderWidth: 1,
  borderColor: '#bbf7d0',
  backgroundColor: '#f0fdf4',
  overflow: 'hidden',
},
historyAddedText: {
  flex: 1,
  paddingVertical: 9,
  paddingHorizontal: 12,
  fontSize: 13,
  fontWeight: '500',
  color: '#16a34a',
},
historyRevertBtn: {
  paddingVertical: 9,
  paddingHorizontal: 12,
  borderLeftWidth: 1,
  borderLeftColor: '#bbf7d0',
},
historyRevertText: {
  fontSize: 12,
  fontWeight: '600',
  color: '#dc2626',
},

// ─── Alternatives section ─────────────────────────────────────────────────────
altSection: {
  marginBottom: SPACING.lg,
},
altSectionHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: SPACING.sm,
},
altSectionTitle: {
  fontSize: 11,
  color: COLORS.textMuted,
  fontWeight: '700',
  letterSpacing: 0.8,
  textTransform: 'uppercase',
},
proTeaser: {
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: 999,
  backgroundColor: '#fef9c3',
  borderWidth: 1,
  borderColor: '#fde047',
},
proTeaserText: {
  fontSize: 11,
  fontWeight: '600',
  color: '#a16207',
},
bulkAddBtn: {
  marginTop: SPACING.sm,
  backgroundColor: COLORS.primary,
  paddingVertical: 13,
  borderRadius: BORDER_RADIUS.md,
  alignItems: 'center',
},
bulkAddBtnText: {
  color: '#fff',
  fontWeight: '700',
  fontSize: 14,
},

});
