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
import { fetchLists, createList, addWordToList } from '../services/listsService';
import { fetchMyProfile } from '../services/profileService';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';

// Ліміти альтернатив по плану
const MAX_ALTS = { free: 3, pro: 7 };

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

  // Жорсткі евристики "схоже на речення"
  if (/[.!?]/.test(trimmed))                           return { ok: false, code: 'SENTENCE_LIKE' };
  if (/\n/.test(text))                                 return { ok: false, code: 'SENTENCE_LIKE' };
  if (/;/.test(trimmed))                               return { ok: false, code: 'SENTENCE_LIKE' };
  if ((trimmed.match(/,/g) || []).length >= 2)         return { ok: false, code: 'SENTENCE_LIKE' };

  // Кількість слів
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > limits.words) return { ok: false, code: 'TOO_LONG_WORDS', count: words.length };

  // Кількість символів
  if (trimmed.length > limits.chars) return { ok: false, code: 'TOO_LONG_CHARS', count: trimmed.length };

  return { ok: true, wordCount: words.length, charCount: trimmed.length };
}

export default function TranslateScreen() {
  const { t } = useI18n();
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

  
useEffect(() => {
  (async () => {
    try {
      const savedSource = await AsyncStorage.getItem('TRANSLATE_SOURCE_LANG');
      const savedTarget = await AsyncStorage.getItem('TRANSLATE_TARGET_LANG');
      const savedPinned = await AsyncStorage.getItem('PINNED_LANGS');
      const savedRecentSource = await AsyncStorage.getItem('RECENT_SOURCE_LANGS');
      const savedRecentTarget = await AsyncStorage.getItem('RECENT_TARGET_LANGS');

      if (savedSource) setSourceLang(savedSource);
      if (savedTarget) setTargetLang(savedTarget);
      if (savedPinned) setPinnedLangs(JSON.parse(savedPinned) || []);
      if (savedRecentSource) setRecentSource(JSON.parse(savedRecentSource) || []);
      if (savedRecentTarget) setRecentTarget(JSON.parse(savedRecentTarget) || []);
    } catch (e) {
      // ignore
    }

    try {
      const { source, target } = await fetchLanguages();
      // small UX: keep mostly European languages (DeepL list is already curated, but includes non-EU)
      setDeeplSource(source || []);
      setDeeplTarget(target || []);
    } catch (e) {
      // ignore; translate still works with defaults
    }
  })();
}, []);

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

      // Альтернативи приходять у відповіді (вже обрізані до ліміту плану на сервері)
      // Додатково обрізаємо на клієнті якщо план вже оновився
      const planLimit = MAX_ALTS[subscriptionPlan] ?? 3;
      const alts = Array.isArray(data?.alternatives) ? data.alternatives.slice(0, planLimit) : [];
      setAlternatives(alts);
    } catch (err) {
      setError(err.message);
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

      const safeLists = Array.isArray(listsData) ? listsData : [];
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

  const handleCreateNewList = () => {
    // iOS: Alert.prompt доступний; Android — fallback
    const create = async (name) => {
      const listName = (name || '').trim() || 'My Words';

      try {
        const newList = await createList({ name: listName });
        // оновлюємо списки і одразу додаємо слово в новий
        const updated = await fetchLists();
        setLists(Array.isArray(updated) ? updated : []);
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
        setLists(Array.isArray(listsData) ? listsData : []);
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
      setLists(Array.isArray(listsData) ? listsData : []);
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

  <Text style={styles.subtitle} numberOfLines={1}>
    {sourceLang} → {targetLang} · {t('translate.powered_by_ai')}
  </Text>
</View>

<View style={styles.inputCard}>
  <Text style={styles.inputLabel}>{t('translate.input_label')}</Text>
  <View style={styles.inputWrap}>
    <TextInput
      style={styles.input}
      value={query}
      onChangeText={setQuery}
      placeholder={t('translate.placeholder', { max: limits.words })}
      placeholderTextColor={COLORS.textHint}
      returnKeyType="search"
      onSubmitEditing={canTranslate ? handleTranslate : undefined}
      autoCorrect={false}
      autoCapitalize="none"
      multiline={true}
      numberOfLines={3}
      scrollEnabled={true}
      textAlignVertical="top"
      blurOnSubmit={true}
    />
    {query.length > 0 && (
      <TouchableOpacity
        onPress={() => setQuery('')}
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

{error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {result && (
            <View style={styles.resultContainer}>
              <WordCard
                word={result}
                onAddToList={openAddToListModal}
                isAdded={isAdded}
              />
            </View>
          )}

          {/* ─── Alternatives section ─── */}
          {result && alternatives.length > 0 && (
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
          onSelect={pendingAltWord ? handleAltAddToList : handleAddToList}
          onClose={() => { setShowModal(false); setPendingAltWord(null); }}
          onCreateNew={() => {
            setShowModal(false);
            setPendingAltWord(null);
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
    marginTop: SPACING.sm,
    minHeight: 48,
    maxHeight: 90,
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '400',
    letterSpacing: -0.3,
    paddingVertical: 10,
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
  minHeight: 48,
},
clearBtn: {
  marginLeft: 8,
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

// ─── Alternatives section ────────────────────────────────────────────────
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
