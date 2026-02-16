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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WordCard from '../components/WordCard';
import AddToListModal from '../components/AddToListModal';
import LanguagePairPickerModal from '../components/LanguagePairPickerModal';
import LanguageMixConfirmModal from '../components/LanguageMixConfirmModal';
import { translateWord, suggestList } from '../services/translateService';
import { fetchLists, createList, addWordToList } from '../services/listsService';
import { fetchDeepLLanguages } from '../services/languagesService';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';
import { DEFAULT_PAIR, EUROPE_LANGUAGE_ALLOWLIST, normalizeLangCode, pairLabel } from '../utils/languages';

export default function TranslateScreen() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [lists, setLists] = useState([]);
  const [suggestedListName, setSuggestedListName] = useState(null);
  const [suggestedListId, setSuggestedListId] = useState(null);

  const [isAdded, setIsAdded] = useState(false);

  // Language pair selection
  const [pair, setPair] = useState(DEFAULT_PAIR);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [recentPairs, setRecentPairs] = useState([]);
  const [pinnedPairs, setPinnedPairs] = useState([]);
  const [deeplLangs, setDeeplLangs] = useState({ source: [], target: [] });

  // Mix confirm flow
  const [mixConfirmVisible, setMixConfirmVisible] = useState(false);
  const [mixPayload, setMixPayload] = useState(null); // { listId, listPair, newPair }

  // toast
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = (message) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };

  const canTranslate = useMemo(() => !!query.trim(), [query]);

  const STORAGE_PAIR = 'LL_PAIR';
  const STORAGE_RECENTS = 'LL_RECENT_PAIRS';
  const STORAGE_PINS = 'LL_PINNED_PAIRS';

  const presets = useMemo(() => ([
    { sourceLang: 'EN', targetLang: 'UK' },
    { sourceLang: 'UK', targetLang: 'EN' },
    { sourceLang: 'EN', targetLang: 'PL' },
    { sourceLang: 'PL', targetLang: 'EN' },
    { sourceLang: 'EN', targetLang: 'DE' },
    { sourceLang: 'EN', targetLang: 'FR' },
    { sourceLang: 'EN', targetLang: 'IT' },
    { sourceLang: 'EN', targetLang: 'ES' },
  ]), []);

  // bootstrap saved pair + prefs
  useEffect(() => {
    (async () => {
      try {
        const rawPair = await AsyncStorage.getItem(STORAGE_PAIR);
        if (rawPair) {
          const parsed = JSON.parse(rawPair);
          if (parsed?.sourceLang && parsed?.targetLang) {
            setPair({
              sourceLang: normalizeLangCode(parsed.sourceLang),
              targetLang: normalizeLangCode(parsed.targetLang),
            });
          }
        }
      } catch {
        // ignore
      }

      try {
        const rawRecent = await AsyncStorage.getItem(STORAGE_RECENTS);
        if (rawRecent) setRecentPairs(JSON.parse(rawRecent) || []);
      } catch {
        // ignore
      }

      try {
        const rawPins = await AsyncStorage.getItem(STORAGE_PINS);
        if (rawPins) setPinnedPairs(JSON.parse(rawPins) || []);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Load DeepL supported languages (from backend)
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchDeepLLanguages();
        const source = (data?.source || []).map((l) => normalizeLangCode(l.language));
        const target = (data?.target || []).map((l) => normalizeLangCode(l.language));

        // Keep a Europe-first allowlist to avoid surfacing Asian languages
        setDeeplLangs({
          source: source.filter((c) => EUROPE_LANGUAGE_ALLOWLIST.has(c) || c.startsWith('EN')), // keep EN variants
          target: target.filter((c) => EUROPE_LANGUAGE_ALLOWLIST.has(c) || c.startsWith('EN')),
        });
      } catch (e) {
        // fallback: still usable with presets
        console.warn('Failed to load DeepL languages:', e?.message);
        setDeeplLangs({
          source: Array.from(EUROPE_LANGUAGE_ALLOWLIST),
          target: Array.from(EUROPE_LANGUAGE_ALLOWLIST),
        });
      }
    })();
  }, []);

  const persistPair = async (next) => {
    setPair(next);
    try {
      await AsyncStorage.setItem(STORAGE_PAIR, JSON.stringify(next));
    } catch {
      // ignore
    }

    // update recents
    const key = `${normalizeLangCode(next.sourceLang)}->${normalizeLangCode(next.targetLang)}`;
    setRecentPairs((prev) => {
      const clean = Array.isArray(prev) ? prev : [];
      const without = clean.filter((p) => `${normalizeLangCode(p.sourceLang)}->${normalizeLangCode(p.targetLang)}` !== key);
      const updated = [{ ...next }, ...without].slice(0, 8);
      AsyncStorage.setItem(STORAGE_RECENTS, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  };

  const togglePin = async (p) => {
    const key = `${normalizeLangCode(p.sourceLang)}->${normalizeLangCode(p.targetLang)}`;
    setPinnedPairs((prev) => {
      const clean = Array.isArray(prev) ? prev : [];
      const exists = clean.some((x) => `${normalizeLangCode(x.sourceLang)}->${normalizeLangCode(x.targetLang)}` === key);
      const updated = exists ? clean.filter((x) => `${normalizeLangCode(x.sourceLang)}->${normalizeLangCode(x.targetLang)}` !== key) : [{ ...p }, ...clean].slice(0, 10);
      AsyncStorage.setItem(STORAGE_PINS, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  };

  const swapPair = () => {
    persistPair({ sourceLang: pair.targetLang, targetLang: pair.sourceLang });
  };

  const handleTranslate = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setIsAdded(false);

    try {
      const data = await translateWord(query, { sourceLang: pair.sourceLang, targetLang: pair.targetLang });

      if (data?.error) {
        setError(data.error); // "Цього слова немає у словнику"
        setResult(null);
        return;
      }

      setResult(data);
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

  const handleAddToList = async (listId) => {
    try {
      if (!result?.id) return;

      await addWordToList(listId, result.id);

      setShowModal(false);
      setIsAdded(true);
      const listName = (lists || []).find((l) => l.id === listId)?.name;
      showToast(listName ? t('lists.added_to_named', { name: listName }) : t('lists.added_to_list'));
    } catch (e) {
      console.warn('Add to list failed:', e?.message);

      // Language mix guard
      if (e?.status === 409 && e?.data?.code === 'LANG_MIX_CONFIRM') {
        setMixPayload({
          listId,
          listPair: e.data.list_pair,
          newPair: e.data.new_pair,
        });
        setMixConfirmVisible(true);
        return;
      }

      Alert.alert(t('common.error'), t('translate.add_to_list_failed'));
    }
  };

  const confirmMix = async ({ rememberChoice }) => {
    try {
      if (!mixPayload?.listId || !result?.id) return;
      await addWordToList(mixPayload.listId, result.id, { forceMix: true, rememberChoice: !!rememberChoice });
      setMixConfirmVisible(false);
      setMixPayload(null);
      setShowModal(false);
      setIsAdded(true);
      const listName = (lists || []).find((l) => l.id === mixPayload.listId)?.name;
      showToast(listName ? t('lists.added_to_named', { name: listName }) : t('lists.added_to_list'));
    } catch (e) {
      console.warn('Mix confirm add failed:', e?.message);
      setMixConfirmVisible(false);
      setMixPayload(null);
      Alert.alert(t('common.error'), t('translate.add_to_list_failed'));
    }
  };

  const handleCreateNewList = () => {
    // iOS: Alert.prompt доступний; Android — fallback
    const create = async (name) => {
      const listName = (name || '').trim() || t('lists.default_list_name');

      try {
        const newList = await createList({ name: listName });
        // оновлюємо списки і одразу додаємо слово в новий
        const updated = await fetchLists();
        setLists(Array.isArray(updated) ? updated : []);
        await handleAddToList(newList.id);
      } catch (e) {
        console.warn('Create list failed:', e?.message);
        Alert.alert(t('common.error'), t('lists.create_failed'));
      }
    };

    if (Platform.OS === 'ios' && Alert.prompt) {
      Alert.prompt(t('lists.new_list_title'), t('lists.new_list_prompt'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.create'), onPress: (value) => create(value) },
      ]);
    } else {
      // простий fallback
      create(t('lists.default_list_name'));
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
            <Text style={styles.subtitle}>{t('translate.subtitle')}</Text>
          </View>

          {/* Language bar */}
          <View style={styles.langBar}>
            <TouchableOpacity
              style={styles.langPill}
              onPress={() => setPickerVisible(true)}
              activeOpacity={0.75}
            >
              <Text style={styles.langPillText}>{pairLabel(pair.sourceLang, pair.targetLang)}</Text>
              <Text style={styles.langPillChevron}>▾</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.swapBtn} onPress={swapPair} activeOpacity={0.75}>
              <Text style={styles.swapIcon}>⇄</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputCard}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder={t("translate.placeholder")}
              placeholderTextColor={COLORS.textHint}
              returnKeyType="search"
              onSubmitEditing={handleTranslate}
              autoCorrect={false}
              autoCapitalize="none"
            />
            <View style={styles.inputFooter}>
              <Text style={styles.hint}>{t('translate.hint')}</Text>
              <TouchableOpacity
                style={[styles.translateButton, !canTranslate && styles.translateButtonDisabled]}
                onPress={handleTranslate}
                disabled={!canTranslate || loading}
                activeOpacity={0.7}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={[styles.translateButtonText, !canTranslate && styles.translateButtonTextDisabled]}>
                    {t('translate.button')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
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

          <View style={{ height: 40 }} />
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
          onSelect={handleAddToList}
          onClose={() => setShowModal(false)}
          onCreateNew={() => {
            // залишаємо модалку відкритою? на iOS prompt зручніше після закриття
            setShowModal(false);
            handleCreateNewList();
          }}
        />

        <LanguagePairPickerModal
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          sourceLanguages={deeplLangs.source}
          targetLanguages={deeplLangs.target}
          currentPair={pair}
          presets={presets}
          recentPairs={recentPairs}
          pinnedPairs={pinnedPairs}
          onSelectPair={(p) => {
            setPickerVisible(false);
            persistPair({ sourceLang: normalizeLangCode(p.sourceLang), targetLang: normalizeLangCode(p.targetLang) });
          }}
          onTogglePin={togglePin}
        />

        <LanguageMixConfirmModal
          visible={mixConfirmVisible}
          listPair={mixPayload?.listPair}
          newPair={mixPayload?.newPair}
          onCancel={() => {
            setMixConfirmVisible(false);
            setMixPayload(null);
          }}
          onConfirm={confirmMix}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
  },
  header: {
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  langBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    flex: 1,
    justifyContent: 'space-between',
  },
  langPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: 0.2,
  },
  langPillChevron: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  swapBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapIcon: {
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  title: {
    fontSize: 28,
    fontWeight: '400',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 4,
    letterSpacing: 0.2,
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
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '400',
    letterSpacing: -0.3,
    paddingVertical: 0,
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
});
