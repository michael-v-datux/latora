import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  FlatList,
} from 'react-native';

import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import { langLabel, normalizeLangCode, pairLabel } from '../utils/languages';
import { useI18n } from '../i18n';

/**
 * Props:
 * - visible
 * - onClose
 * - sourceLanguages: string[]
 * - targetLanguages: string[]
 * - currentPair: {sourceLang, targetLang}
 * - presets: Array<{sourceLang, targetLang}>
 * - recentPairs: Array<{sourceLang, targetLang}>
 * - pinnedPairs: Array<{sourceLang, targetLang}>
 * - onSelectPair(pair)
 * - onTogglePin(pair)
 */
export default function LanguagePairPickerModal({
  visible,
  onClose,
  sourceLanguages = [],
  targetLanguages = [],
  currentPair,
  presets = [],
  recentPairs = [],
  pinnedPairs = [],
  onSelectPair,
  onTogglePin,
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  const sourceSet = useMemo(() => new Set(sourceLanguages.map(normalizeLangCode)), [sourceLanguages]);
  const targetSet = useMemo(() => new Set(targetLanguages.map(normalizeLangCode)), [targetLanguages]);

  const canUsePair = (p) => sourceSet.has(normalizeLangCode(p.sourceLang)) && targetSet.has(normalizeLangCode(p.targetLang));

  const pinnedKeys = useMemo(() => new Set((pinnedPairs || []).map((p) => `${normalizeLangCode(p.sourceLang)}->${normalizeLangCode(p.targetLang)}`)), [pinnedPairs]);
  const isPinned = (p) => pinnedKeys.has(`${normalizeLangCode(p.sourceLang)}->${normalizeLangCode(p.targetLang)}`);

  const allTargetsFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (targetLanguages || []).map(normalizeLangCode);
    if (!q) return Array.from(new Set(list));
    return Array.from(new Set(list)).filter((code) => langLabel(code).toLowerCase().includes(q) || code.toLowerCase().includes(q));
  }, [targetLanguages, query]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.modal} onPress={() => {}}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{t('translate.lang_picker_title')}</Text>
              <Text style={styles.subtitle}>{t('translate.lang_picker_subtitle')}</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Presets */}
          <Section title={t('translate.lang_presets')}>
            <View style={styles.pillsWrap}>
              {(presets || []).filter(canUsePair).map((p) => (
                <PairPill
                  key={pairLabel(p.sourceLang, p.targetLang)}
                  label={pairLabel(p.sourceLang, p.targetLang)}
                  active={normalizeLangCode(currentPair?.sourceLang) === normalizeLangCode(p.sourceLang)
                    && normalizeLangCode(currentPair?.targetLang) === normalizeLangCode(p.targetLang)}
                  pinned={isPinned(p)}
                  onPress={() => onSelectPair?.(p)}
                  onPin={() => onTogglePin?.(p)}
                />
              ))}
            </View>
          </Section>

          {/* Recent */}
          {(recentPairs || []).length > 0 && (
            <Section title={t('translate.lang_recent')}>
              <View style={styles.pillsWrap}>
                {(recentPairs || []).filter(canUsePair).map((p) => (
                  <PairPill
                    key={`recent-${pairLabel(p.sourceLang, p.targetLang)}`}
                    label={pairLabel(p.sourceLang, p.targetLang)}
                    active={normalizeLangCode(currentPair?.sourceLang) === normalizeLangCode(p.sourceLang)
                      && normalizeLangCode(currentPair?.targetLang) === normalizeLangCode(p.targetLang)}
                    pinned={isPinned(p)}
                    onPress={() => onSelectPair?.(p)}
                    onPin={() => onTogglePin?.(p)}
                  />
                ))}
              </View>
            </Section>
          )}

          {/* Pinned */}
          {(pinnedPairs || []).length > 0 && (
            <Section title={t('translate.lang_pinned')}>
              <View style={styles.pillsWrap}>
                {(pinnedPairs || []).filter(canUsePair).map((p) => (
                  <PairPill
                    key={`pin-${pairLabel(p.sourceLang, p.targetLang)}`}
                    label={pairLabel(p.sourceLang, p.targetLang)}
                    active={normalizeLangCode(currentPair?.sourceLang) === normalizeLangCode(p.sourceLang)
                      && normalizeLangCode(currentPair?.targetLang) === normalizeLangCode(p.targetLang)}
                    pinned
                    onPress={() => onSelectPair?.(p)}
                    onPin={() => onTogglePin?.(p)}
                  />
                ))}
              </View>
            </Section>
          )}

          {/* Target list (simple + fast UX): choose target, keep same source */}
          <Section title={t('translate.lang_all_targets')}>
            <TextInput
              style={styles.search}
              placeholder={t('translate.lang_search')}
              placeholderTextColor={COLORS.textHint}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
            <FlatList
              data={allTargetsFiltered}
              keyExtractor={(item) => item}
              style={styles.list}
              renderItem={({ item }) => {
                const nextPair = { sourceLang: currentPair?.sourceLang || 'EN', targetLang: item };
                const disabled = !canUsePair(nextPair);
                return (
                  <TouchableOpacity
                    style={[styles.langRow, disabled && styles.langRowDisabled]}
                    onPress={() => !disabled && onSelectPair?.(nextPair)}
                    activeOpacity={0.7}
                    disabled={disabled}
                  >
                    <Text style={styles.langName}>{langLabel(item)}</Text>
                    <Text style={styles.langCode}>{normalizeLangCode(item)}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </Section>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PairPill({ label, active, pinned, onPress, onPin }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
      <TouchableOpacity onPress={onPin} style={styles.pinBtn} activeOpacity={0.7}>
        <Text style={[styles.pinIcon, pinned && styles.pinIconActive]}>{pinned ? '★' : '☆'}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    maxHeight: '82%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.primary,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMuted,
  },
  close: {
    fontSize: 18,
    color: COLORS.textMuted,
    padding: 4,
  },
  section: {
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 11,
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    fontWeight: '500',
    marginBottom: 8,
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fafbfc',
  },
  pillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textPrimary,
    letterSpacing: 0.2,
  },
  pillTextActive: {
    color: '#fff',
  },
  pinBtn: {
    marginLeft: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  pinIcon: {
    fontSize: 13,
    color: 'rgba(2,6,23,0.35)',
  },
  pinIconActive: {
    color: '#f59e0b',
  },
  search: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.textPrimary,
    backgroundColor: '#ffffff',
    marginBottom: 8,
  },
  list: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    overflow: 'hidden',
    maxHeight: 260,
  },
  langRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.25)',
    backgroundColor: '#fff',
  },
  langRowDisabled: {
    opacity: 0.45,
  },
  langName: {
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  langCode: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
});
