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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import WordCard from '../components/WordCard';
import AddToListModal from '../components/AddToListModal';
import LanguagePickerModal from '../components/LanguagePickerModal';
import { translateWord, suggestList, fetchLanguages } from '../services/translateService';
import { fetchLists, createList, addWordToList } from '../services/listsService';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';

export default function TranslateScreen() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  const canTranslate = useMemo(() => !!query.trim(), [query]);

  const handleTranslate = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setIsAdded(false);

    try {
      const data = await translateWord(query, sourceLang, targetLang);

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
      showToast(listName ? `✓ Додано у «${listName}»` : '✓ Додано у список');
    } catch (e) {
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
      placeholder={t('translate.placeholder')}
      placeholderTextColor={COLORS.textHint}
      returnKeyType="search"
      onSubmitEditing={handleTranslate}
      autoCorrect={false}
      autoCapitalize="none"
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
          onSelect={handleAddToList}
          onClose={() => setShowModal(false)}
          onCreateNew={() => {
            // залишаємо модалку відкритою? на iOS prompt зручніше після закриття
            setShowModal(false);
            handleCreateNewList();
          }}
        />
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
    height: 48,
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '400',
    letterSpacing: -0.3,
    paddingVertical: 10,
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

});
