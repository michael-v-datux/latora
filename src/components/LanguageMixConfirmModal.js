/**
 * LanguageMixConfirmModal.js — підтвердження змішування мов у списку
 * Fix: JSX structure simplified to avoid mismatched Pressable tags.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';

export default function LanguageMixConfirmModal({
    visible,
    onClose,
    onConfirm,
    listName,
    listPair,
    incomingPair,
}) {
    const { t } = useI18n();
    const [remember, setRemember] = useState(false);

    useEffect(() => {
        if (!visible) setRemember(false);
    }, [visible]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                {/* Backdrop */}
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

                {/* Dialog */}
                <View style={styles.modal}>
                    <Text style={styles.title}>{t('lists.mix_lang_title')}</Text>

                    <Text style={styles.text}>
                        {t('lists.mix_lang_message', { name: listName || t('lists.this_list') })}
                    </Text>

                    <View style={styles.pairs}>
                        <View style={styles.pairRow}>
                            <Text style={styles.pairLabel}>{t('lists.current_pair')}</Text>
                            <Text style={styles.pairValue}>{listPair}</Text>
                        </View>
                        <View style={styles.pairRow}>
                            <Text style={styles.pairLabel}>{t('lists.new_pair')}</Text>
                            <Text style={styles.pairValue}>{incomingPair}</Text>
                        </View>
                    </View>

                    <TouchableOpacity
                        style={styles.checkboxRow}
                        onPress={() => setRemember((v) => !v)}
                        activeOpacity={0.8}
                    >
                        <View style={[styles.checkbox, remember && styles.checkboxChecked]}>
                            {remember && <Text style={styles.checkboxTick}>✓</Text>}
                        </View>
                        <Text style={styles.checkboxText}>{t('lists.remember_for_list')}</Text>
                    </TouchableOpacity>

                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={[styles.btn, styles.btnGhost]}
                            onPress={onClose}
                            activeOpacity={0.8}
                        >
                            <Text style={[styles.btnText, styles.btnGhostText]}>{t('common.cancel')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.btn, styles.btnPrimary]}
                            onPress={() => onConfirm({ rememberForList: remember })}
                            activeOpacity={0.8}
                        >
                            <Text style={[styles.btnText, styles.btnPrimaryText]}>{t('lists.add_anyway')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'center',
        padding: SPACING.xl,
    },
    modal: {
        backgroundColor: COLORS.surface,
        borderRadius: BORDER_RADIUS.xl,
        padding: SPACING.xl,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    title: {
        fontSize: 16,
        fontWeight: '700',
        color: COLORS.primary,
        marginBottom: 10,
    },
    text: {
        fontSize: 14,
        color: COLORS.text,
        lineHeight: 20,
        marginBottom: 12,
    },
    pairs: {
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: BORDER_RADIUS.lg,
        padding: 12,
        marginBottom: 12,
        backgroundColor: COLORS.background,
    },
    pairRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    pairLabel: { fontSize: 12, color: COLORS.textMuted },
    pairValue: { fontSize: 12, color: COLORS.text, fontWeight: '600' },

    checkboxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
    checkbox: {
        width: 18,
        height: 18,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
        backgroundColor: COLORS.surface,
    },
    checkboxChecked: {
        borderColor: COLORS.primary,
        backgroundColor: COLORS.primary + '15',
    },
    checkboxTick: { fontSize: 12, color: COLORS.primary, fontWeight: '800', marginTop: -1 },
    checkboxText: { fontSize: 13, color: COLORS.text },

    actions: { flexDirection: 'row', justifyContent: 'flex-end' },
    btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: BORDER_RADIUS.lg, marginLeft: 10 },
    btnGhost: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border },
    btnGhostText: { color: COLORS.text },
    btnPrimary: { backgroundColor: COLORS.primary },
    btnPrimaryText: { color: '#fff' },
    btnText: { fontSize: 13, fontWeight: '700' },
});
