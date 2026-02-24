/**
 * RecommendationsResultsScreen.js — Screen 2: Show & act on recommendations
 *
 * Shown as a full-screen Modal from ListsScreen (stacked on top of SetupScreen).
 *
 * Props:
 *   visible     - boolean
 *   onClose     - () => void — closes both this screen and setup
 *   onBack      - () => void — goes back to Setup
 *   results     - { runId, items, strategy, quotaUsed, quotaMax, quotaLeft, plan }
 *   lists       - user's word lists (for "add to list" picker)
 *   onWordsAdded - (addedCount) => void — called when user adds words (to refresh lists)
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../i18n';
import { COLORS, BORDER_RADIUS, SPACING, CEFR_COLORS } from '../utils/constants';
import { recordRecommendationAction } from '../services/recommendationsService';

// ─── CEFR badge ───────────────────────────────────────────────────────────────
function CefrTag({ level }) {
  if (!level) return null;
  const color = CEFR_COLORS[level] || COLORS.textMuted;
  return (
    <View style={[styles.cefrTag, { borderColor: color }]}>
      <Text style={[styles.cefrTagText, { color }]}>{level}</Text>
    </View>
  );
}

// ─── Single recommendation card ───────────────────────────────────────────────
function RecCard({ item, lists, onAction, actionState }) {
  const { t } = useI18n();
  const [listPickerOpen, setListPickerOpen] = useState(false);

  const isDone = actionState === 'added' || actionState === 'hidden';
  const isAdded = actionState === 'added';
  const isHidden = actionState === 'hidden';

  const handleAddPress = () => {
    if (lists.length === 1) {
      // Only one list — add directly
      onAction(item.id, 'added', lists[0].id, lists[0].name);
    } else {
      setListPickerOpen(true);
    }
  };

  return (
    <View style={[styles.card, isDone && styles.cardDone]}>
      {/* Word header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <Text style={[styles.original, isDone && styles.textFaded]}>{item.original}</Text>
          {item.phraseFlag ? (
            <View style={styles.phraseTag}>
              <Text style={styles.phraseTagText}>phrase</Text>
            </View>
          ) : null}
        </View>
        <CefrTag level={item.cefrLevel} />
      </View>

      {/* Translation */}
      <Text style={[styles.translation, isDone && styles.textFaded]}>{item.translation}</Text>

      {/* Transcription */}
      {item.transcription ? (
        <Text style={[styles.transcription, isDone && styles.textFaded]}>{item.transcription}</Text>
      ) : null}

      {/* Example sentence */}
      {item.exampleSentence ? (
        <Text style={[styles.example, isDone && styles.textFaded]} numberOfLines={2}>
          {item.exampleSentence}
        </Text>
      ) : null}

      {/* Reason badge */}
      <View style={styles.reasonRow}>
        <Ionicons name="information-circle-outline" size={13} color={COLORS.textMuted} />
        <Text style={styles.reasonText}>{item.reasonLabel || t(`rec.reason_${item.reasonCode}`)}</Text>
      </View>

      {/* Actions */}
      {!isDone ? (
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnHide]}
            onPress={() => onAction(item.id, 'hidden', null, null)}
            activeOpacity={0.7}
          >
            <Ionicons name="eye-off-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.actionBtnHideText}>{t('rec.action_hide')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnAdd]}
            onPress={handleAddPress}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={14} color="#fff" />
            <Text style={styles.actionBtnAddText}>{t('rec.action_add')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.doneRow}>
          {isAdded && (
            <>
              <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
              <Text style={styles.doneText}>{t('rec.action_added')}</Text>
            </>
          )}
          {isHidden && (
            <>
              <Ionicons name="eye-off-outline" size={14} color={COLORS.textMuted} />
              <Text style={[styles.doneText, { color: COLORS.textMuted }]}>{t('rec.action_hidden')}</Text>
            </>
          )}
        </View>
      )}

      {/* List picker (inline, no modal within modal complexity) */}
      {listPickerOpen && (
        <View style={styles.listPicker}>
          <Text style={styles.listPickerTitle}>{t('lists.add_to_list_title')}</Text>
          {lists.map(list => (
            <TouchableOpacity
              key={list.id}
              style={styles.listPickerRow}
              onPress={() => {
                setListPickerOpen(false);
                onAction(item.id, 'added', list.id, list.name);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.listPickerEmoji}>{list.emoji || '📚'}</Text>
              <Text style={styles.listPickerName}>{list.name}</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.listPickerCancel} onPress={() => setListPickerOpen(false)}>
            <Text style={styles.listPickerCancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function RecommendationsResultsScreen({
  visible,
  onClose,
  onBack,
  results,
  lists = [],
  onWordsAdded,
}) {
  const { t } = useI18n();

  // Track per-item action state: itemId → 'pending'|'adding'|'added'|'hidden'
  const [itemActions, setItemActions] = useState({});

  // Reset on new results
  const items = useMemo(() => results?.items || [], [results]);

  const pendingCount = useMemo(
    () => items.filter(i => !['added', 'hidden'].includes(itemActions[i.id] || 'pending')).length,
    [items, itemActions]
  );

  const addedCount = useMemo(
    () => Object.values(itemActions).filter(a => a === 'added').length,
    [itemActions]
  );

  const handleAction = useCallback(async (itemId, action, listId, listName) => {
    setItemActions(prev => ({ ...prev, [itemId]: action === 'hidden' ? 'hidden' : 'adding' }));

    try {
      // recordRecommendationAction handles everything server-side:
      // - For LLM words (rec_word_id): promotes to global `words` table, then adds to list
      // - For SQL words (word_id): adds directly to list
      // - For hide/skip: just records the action
      await recordRecommendationAction(itemId, action, listId);

      setItemActions(prev => ({ ...prev, [itemId]: action }));

      if (action === 'added' && onWordsAdded) {
        onWordsAdded(1);
      }
    } catch (e) {
      setItemActions(prev => ({ ...prev, [itemId]: 'pending' }));
      Alert.alert(t('common.error'), t('rec.error_action'));
    }
  }, [onWordsAdded, t]);

  const strategy = results?.strategy;
  const strategyIcon = strategy === 'llm' ? 'sparkles-outline'
    : strategy === 'hybrid' ? 'git-merge-outline'
    : 'layers-outline';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onBack}>
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.headerBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={22} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('rec.results_title')}</Text>
          <TouchableOpacity onPress={onClose} style={styles.headerClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Strategy + quota info */}
        {results && (
          <View style={styles.metaBanner}>
            <View style={styles.metaLeft}>
              <Ionicons name={strategyIcon} size={13} color={COLORS.textSecondary} />
              <Text style={styles.metaText}>
                {items.length} {t('lists.words', { count: items.length })}
                {strategy === 'llm' ? ' · AI' : strategy === 'hybrid' ? ' · Hybrid' : ''}
              </Text>
            </View>
            {results.quotaLeft !== undefined && (
              <Text style={styles.metaQuota}>
                {t('rec.entry_quota', { left: results.quotaLeft, max: results.quotaMax })}
              </Text>
            )}
          </View>
        )}

        {/* Results list */}
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>{t('rec.results_empty')}</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={item => item.id || item.original}
            renderItem={({ item }) => (
              <RecCard
                item={item}
                lists={lists}
                onAction={handleAction}
                actionState={itemActions[item.id] || 'pending'}
              />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Footer: added count + done button */}
        {items.length > 0 && (
          <View style={styles.footer}>
            {addedCount > 0 && (
              <Text style={styles.footerAdded}>
                {t('rec.batch_added', { count: addedCount })}
              </Text>
            )}
            <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.doneBtnText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerBack: {
    width: 40,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  headerClose: {
    width: 40,
    alignItems: 'flex-end',
  },
  metaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  metaQuota: {
    fontSize: 12,
    color: COLORS.accent,
    fontWeight: '500',
  },
  listContent: {
    padding: SPACING.md,
    gap: 12,
    paddingBottom: 100,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: SPACING.xl,
  },
  emptyTitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  cardDone: {
    opacity: 0.65,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
  },
  original: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  textFaded: {
    opacity: 0.55,
  },
  phraseTag: {
    backgroundColor: '#f0fdf4',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#86efac',
  },
  phraseTagText: {
    fontSize: 10,
    color: '#16a34a',
    fontWeight: '600',
  },
  cefrTag: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1.5,
  },
  cefrTagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  translation: {
    fontSize: 15,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  transcription: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  example: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
    fontStyle: 'italic',
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  reasonText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BORDER_RADIUS.md,
    flex: 1,
    justifyContent: 'center',
  },
  actionBtnHide: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionBtnHideText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  actionBtnAdd: {
    backgroundColor: COLORS.accent,
    flex: 1.5,
  },
  actionBtnAddText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  doneText: {
    fontSize: 13,
    color: COLORS.success,
    fontWeight: '500',
  },
  listPicker: {
    marginTop: 10,
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  listPickerTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  listPickerEmoji: {
    fontSize: 18,
    marginRight: 10,
  },
  listPickerName: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  listPickerCancel: {
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  listPickerCancelText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.md,
    paddingBottom: 32,
    paddingTop: 12,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 8,
  },
  footerAdded: {
    textAlign: 'center',
    fontSize: 13,
    color: COLORS.success,
    fontWeight: '500',
  },
  doneBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
