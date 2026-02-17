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
import { fetchSessionCounts } from '../services/practiceService';
import { useI18n } from '../i18n';

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


export default function ListsScreen({ navigation }) {
  const { t } = useI18n();
  const [lists, setLists] = useState([]);
  const [selectedList, setSelectedList] = useState(null);
  const [selectedWords, setSelectedWords] = useState([]);
  const [idiomViewById, setIdiomViewById] = useState({});
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lifetimeSessions, setLifetimeSessions] = useState(null);

  // Bulk mode
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedWordIds, setSelectedWordIds] = useState(() => new Set());
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [moveTargetListId, setMoveTargetListId] = useState(null);

  // New list modal
  const [newListModalVisible, setNewListModalVisible] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [creatingList, setCreatingList] = useState(false);

  const totals = useMemo(() => {
    const totalWords = (lists || []).reduce((sum, l) => sum + (l.word_count || 0), 0);
    const totalLists = (lists || []).length;
    return { totalWords, totalLists };
  }, [lists]);

  const pluralize = (n, one, many) => (n === 1 ? one : many);
  const formatWords = (n) => `${n} ${pluralize(n, 'word', 'words')}`;
  const formatLists = (n) => `${n} ${pluralize(n, 'list', 'lists')}`;

  const loadLists = async (opts = { silent: false }) => {
    if (!opts.silent) setLoadingLists(true);
    try {
      const data = await fetchLists();
      setLists(Array.isArray(data) ? data : []);
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
    try {
      const [details, sessionData] = await Promise.all([
        fetchListDetails(list.id),
        fetchSessionCounts([list.id]).catch(() => ({ counts: {} })),
      ]);
      const words = (details?.words || []).map((w) => ({
        id: w.id,
        original: w.original,
        translation: w.translation,
        cefr: w.cefr_level,
        score: w.difficulty_score ?? 50,

        // language pair + idioms (if present)
        source_lang: w.source_lang,
        target_lang: w.target_lang,
        alt_translations: w.alt_translations,
        translation_notes: w.translation_notes,
        translation_kind: w.translation_kind,
        part_of_speech: w.part_of_speech,
      }));
      setSelectedWords(words);
      setLifetimeSessions(sessionData?.counts?.[list.id] || 0);
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
        cefr: w.cefr_level,
        score: w.difficulty_score ?? 50,

        // language pair + idioms (if present)
        source_lang: w.source_lang,
        target_lang: w.target_lang,
        alt_translations: w.alt_translations,
        translation_notes: w.translation_notes,
        translation_kind: w.translation_kind,
        part_of_speech: w.part_of_speech,
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
    const words = selectedWords || [];

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
              }}
            >
              <Text style={styles.backText}>← Back</Text>
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
              <Text style={styles.bulkToggleText}>{bulkMode ? 'Cancel' : 'Select'}</Text>
            </TouchableOpacity>
          </View>

          {/* Header */}
          <View style={styles.listHeader}>
            <Ionicons name="folder-outline" size={24} color={COLORS.textMuted} />
            <View>
              <Text style={styles.listTitle}>{selectedList.name}</Text>
              <Text style={styles.listSubtitle}>
                {loadingDetails ? 'Loading…' : formatWords(words.length)}
              </Text>
            </View>
          </View>

          {/* Practice info */}
          {!loadingDetails && (
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
              data={words}
              keyExtractor={(item) => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
              ListEmptyComponent={() => (
                <View style={styles.emptyState}>
                  <Ionicons name="add-circle-outline" size={28} color={COLORS.textMuted} />
                  <Text style={styles.emptyTitle}>No words yet</Text>
                  <Text style={styles.emptySubtitle}>
                    Add words from Translate to start building your vocabulary.
                  </Text>
                </View>
              )}
              renderItem={({ item }) => {
                const checked = selectedWordIds.has(item.id);

                const content = (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      if (bulkMode) toggleWordSelected(item.id);
                    }}
                    style={styles.wordItem}
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
                      </View>
                      <Text style={styles.wordTranslation}>{item.translation}</Text>
                      {(item.source_lang || item.target_lang) && (
                        <Text style={styles.wordLang}>{(item.source_lang || 'EN')} → {(item.target_lang || 'UK')}</Text>
                      )}
{(() => {
  if (!isIdiomatic(item)) return null;

  const meta = parseAltTranslations(item.alt_translations);
  const idiomaticList = meta.idiomatic || [];
  const hasIdiomatic = idiomaticList.length > 0;

  // Backward-compatible: older records may not have literal stored.
  // If we have idiomatic variants but no literal, fall back to current main translation as "literal".
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
        {/* On Lists screen: show the label only when there's NO idiomatic meaning */}
        {!hasIdiomatic && (
          <Text style={styles.wordAltLabel}>Буквально</Text>
        )}

        {showToggle && (
          <View style={styles.idiomToggle}>
            <TouchableOpacity
              onPress={() => setIdiomViewById((prev) => ({ ...prev, [item.id]: 'idiomatic' }))}
              style={[styles.idiomToggleBtn, effectiveView === 'idiomatic' && styles.idiomToggleBtnActive]}
            >
              <Text style={[styles.idiomToggleText, effectiveView === 'idiomatic' && styles.idiomToggleTextActive]}>
                Idiomatic
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setIdiomViewById((prev) => ({ ...prev, [item.id]: 'literal' }))}
              style={[styles.idiomToggleBtn, effectiveView === 'literal' && styles.idiomToggleBtnActive]}
            >
              <Text style={[styles.idiomToggleText, effectiveView === 'literal' && styles.idiomToggleTextActive]}>
                Literal
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {effectiveView === 'literal' && hasLiteral && (
        <Text style={styles.wordAltText}>• {literalText}</Text>
      )}

      {effectiveView === 'idiomatic' && idiomaticList.map((t, i) => (
        <Text key={`${item.id}-alt-${i}`} style={styles.wordAltText}>• {t}</Text>
      ))}

      {/* Hide idiom explanation on Literal */}
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
                        <Text style={styles.swipeDeleteText}>Delete</Text>
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
                  if (selectedWordIds.size === words.length) {
                    setSelectedWordIds(new Set());
                  } else {
                    setSelectedWordIds(new Set(words.map((w) => w.id)));
                  }
                }}
              >
                <Text style={styles.bulkBarText}>
                  {selectedWordIds.size === words.length ? 'Unselect all' : 'Select all'}
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
                <Text style={styles.bulkBarText}>Move</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.bulkBarBtnDanger, selectedCount === 0 && styles.bulkBarBtnDisabled]}
                onPress={handleBulkDelete}
                disabled={selectedCount === 0}
              >
                <Text style={styles.bulkBarTextDanger}>Delete</Text>
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

                <Text style={styles.modalSubtitle}>Select a target list</Text>

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
                  <Text style={styles.modalPrimaryText}>Continue</Text>
                </TouchableOpacity>
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
          <Text style={styles.subtitle}>
            {formatWords(totals.totalWords)} across {formatLists(totals.totalLists)}
          </Text>
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
                <Text style={styles.emptyTitle}>Create your first list</Text>
                <Text style={styles.emptySubtitle}>Start collecting words you want to remember.</Text>
                <TouchableOpacity
                  style={styles.newListButton}
                  activeOpacity={0.6}
                  onPress={() => setNewListModalVisible(true)}
                >
                  <Text style={styles.newListText}>+ New list</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {(lists || []).map((list) => {
                  const progress = list.progress ?? 45;

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
                            <Text style={styles.listCardCount}>{formatWords(list.word_count || 0)}</Text>
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
                          <Text style={styles.swipeDeleteText}>Delete</Text>
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
                  <Text style={styles.newListText}>+ New list</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        <View style={{ height: 40 }} />

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
                <Text style={styles.modalTitle}>New list</Text>
                <TouchableOpacity onPress={() => setNewListModalVisible(false)}>
                  <Text style={styles.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modalSubtitle}>Name</Text>
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
                <Text style={styles.modalPrimaryText}>{creatingList ? 'Creating…' : 'Create'}</Text>
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
  header: { paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  title: { fontSize: 28, fontWeight: '400', color: COLORS.primary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },

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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
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

});