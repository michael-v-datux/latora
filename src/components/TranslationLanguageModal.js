/**
 * TranslationLanguageModal.js — вибір мови джерела/цілі для перекладу
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, Pressable, View, Text, TouchableOpacity, StyleSheet, TextInput, FlatList,
} from 'react-native';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';
import { getLanguageLabel, normalizeLang, findDeepLName } from '../utils/languagePairs';

function LangRow({ item, selected, onPress, uiLocale }) {
  const code = normalizeLang(item.language);
  const label = getLanguageLabel(code, uiLocale, item.name);
  return (
    <TouchableOpacity style={[styles.row, selected && styles.rowSelected]} onPress={() => onPress(code)} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={styles.rowCode}>{code}</Text>
      </View>
      {selected && <Text style={styles.check}>✓</Text>}
    </TouchableOpacity>
  );
}

export default function TranslationLanguageModal({
  visible,
  onClose,
  languages, // {source:[], target:[]}
  uiLocale,
  sourceLang,
  targetLang,
  onChangeSource,
  onChangeTarget,
  onSwap,
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState('target'); // 'source' | 'target'
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!visible) {
      setTab('target');
      setQ('');
    }
  }, [visible]);

  const list = useMemo(() => {
    const arr = tab === 'source' ? (languages?.source || []) : (languages?.target || []);
    const query = q.trim().toLowerCase();
    if (!query) return arr;

    return arr.filter((x) => {
      const code = normalizeLang(x.language);
      const label = getLanguageLabel(code, uiLocale, x.name).toLowerCase();
      return code.toLowerCase().includes(query) || label.includes(query);
    });
  }, [languages, tab, q, uiLocale]);

  const sourceLabel = getLanguageLabel(sourceLang, uiLocale, findDeepLName(languages?.source, sourceLang));
  const targetLabel = getLanguageLabel(targetLang, uiLocale, findDeepLName(languages?.target, targetLang));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.modal} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('translate.language_picker_title')}</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.close}>✕</Text></TouchableOpacity>
          </View>

          <View style={styles.currentWrap}>
            <View style={styles.currentCol}>
              <Text style={styles.currentLabel}>{t('translate.source_language')}</Text>
              <Text style={styles.currentValue}>{sourceLabel}</Text>
            </View>
            <TouchableOpacity style={styles.swapBtn} onPress={onSwap} activeOpacity={0.7}>
              <Text style={styles.swapTxt}>⇄</Text>
            </TouchableOpacity>
            <View style={styles.currentCol}>
              <Text style={styles.currentLabel}>{t('translate.target_language')}</Text>
              <Text style={styles.currentValue}>{targetLabel}</Text>
            </View>
          </View>

          <View style={styles.tabs}>
            <TouchableOpacity onPress={() => setTab('source')} style={[styles.tab, tab === 'source' && styles.tabActive]}>
              <Text style={[styles.tabTxt, tab === 'source' && styles.tabTxtActive]}>{t('translate.source_tab')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setTab('target')} style={[styles.tab, tab === 'target' && styles.tabActive]}>
              <Text style={[styles.tabTxt, tab === 'target' && styles.tabTxtActive]}>{t('translate.target_tab')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchWrap}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={t('common.search')}
              placeholderTextColor={COLORS.textMuted}
              style={styles.search}
            />
          </View>

          <FlatList
            data={list}
            keyExtractor={(it) => normalizeLang(it.language)}
            renderItem={({ item }) => (
              <LangRow
                item={item}
                uiLocale={uiLocale}
                selected={normalizeLang(item.language) === normalizeLang(tab === 'source' ? sourceLang : targetLang)}
                onPress={(code) => (tab === 'source' ? onChangeSource(code) : onChangeTarget(code))}
              />
            )}
            style={styles.list}
            showsVerticalScrollIndicator={false}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: '600', color: COLORS.primary },
  close: { fontSize: 18, color: COLORS.textMuted, padding: 4 },

  currentWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  currentCol: { flex: 1 },
  currentLabel: { fontSize: 12, color: COLORS.textMuted, marginBottom: 2 },
  currentValue: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  swapBtn: {
    width: 38, height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 10,
    backgroundColor: COLORS.background,
  },
  swapTxt: { fontSize: 16, color: COLORS.text },

  tabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    marginBottom: 10,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: COLORS.background },
  tabActive: { backgroundColor: COLORS.primary + '12' },
  tabTxt: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },
  tabTxtActive: { color: COLORS.primary },

  searchWrap: { marginBottom: 10 },
  search: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.text,
  },
  list: { marginTop: 6 },
  row: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowSelected: {
    borderColor: COLORS.primary + '66',
    backgroundColor: COLORS.primary + '10',
  },
  rowLeft: { flex: 1, paddingRight: 10 },
  rowTitle: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  rowCode: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  check: { fontSize: 16, color: COLORS.primary, fontWeight: '700' },
});
