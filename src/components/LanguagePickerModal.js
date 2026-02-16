import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, BORDER_RADIUS } from "../utils/constants";
import { useI18n } from "../i18n";

function normalizeToSource(code) {
  return String(code || "").toUpperCase().split("-")[0];
}

export default function LanguagePickerModal({
  visible,
  onClose,
  mode = "source", // "source" | "target"
  languagesSource = [],
  languagesTarget = [],
  selectedSource,
  selectedTarget,
  pinned = [],
  recent = [],
  onTogglePin,
  onSelect,
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");

  const list = mode === "source" ? languagesSource : languagesTarget;
  const title = mode === "source" ? t("translate.source_language") : t("translate.target_language");

  const pinnedSet = useMemo(() => new Set((pinned || []).map((x) => String(x).toUpperCase())), [pinned]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return list;
    return (list || []).filter((l) => {
      const code = String(l.language || "").toLowerCase();
      const name = String(l.name || "").toLowerCase();
      return code.includes(query) || name.includes(query);
    });
  }, [list, q]);

  const pinnedItems = useMemo(() => {
    if (!pinned?.length) return [];
    const map = new Map((list || []).map((l) => [String(l.language).toUpperCase(), l]));
    return pinned
      .map((c) => map.get(String(c).toUpperCase()))
      .filter(Boolean);
  }, [pinned, list]);

  const recentItems = useMemo(() => {
    if (!recent?.length) return [];
    const map = new Map((list || []).map((l) => [String(l.language).toUpperCase(), l]));
    return recent
      .map((c) => map.get(String(c).toUpperCase()))
      .filter(Boolean)
      .filter((l) => !pinnedSet.has(String(l.language).toUpperCase()))
      .slice(0, 8);
  }, [recent, list, pinnedSet]);

  const renderRow = ({ item }) => {
    const code = String(item.language || "").toUpperCase();
    const name = item.name || code;

    const isSelected =
      (mode === "source" ? normalizeToSource(selectedSource) : String(selectedTarget).toUpperCase()) ===
      (mode === "source" ? normalizeToSource(code) : String(code).toUpperCase());

    const isPinned = pinnedSet.has(code);

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => onSelect(code)}
        style={[styles.row, isSelected && styles.rowSelected]}
      >
        <View style={styles.rowLeft}>
          <Text style={styles.rowName}>{name}</Text>
          <Text style={styles.rowCode}>{code}</Text>
        </View>

        <TouchableOpacity
          onPress={() => onTogglePin(code)}
          hitSlop={10}
          style={styles.pinBtn}
        >
          <Ionicons
            name={isPinned ? "star" : "star-outline"}
            size={18}
            color={isPinned ? COLORS.primary : COLORS.textHint}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const Section = ({ label, data }) => {
    if (!data?.length) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{label}</Text>
        <FlatList
          data={data}
          keyExtractor={(it) => String(it.language)}
          renderItem={renderRow}
          scrollEnabled={false}
        />
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={COLORS.textHint} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder={t("translate.lang_search")}
              placeholderTextColor={COLORS.textHint}
              style={styles.search}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Pinned — always first */}
          <Section label={t("translate.lang_pinned")} data={pinnedItems} />
          <Section label={t("translate.lang_recent")} data={recentItems} />

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("translate.lang_all")}</Text>
            <FlatList
              data={filtered}
              keyExtractor={(it) => String(it.language)}
              renderItem={renderRow}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 380 }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.surface,
    padding: SPACING.lg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.primary,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    gap: 8,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.surface,
  },
  search: {
    flex: 1,
    color: COLORS.primary,
    fontSize: 14,
  },
  section: {
    marginTop: SPACING.md,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textHint,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    marginBottom: 8,
  },
  rowSelected: {
    borderColor: COLORS.primary,
  },
  rowLeft: { flex: 1 },
  rowName: {
    color: COLORS.primary,
    fontWeight: "600",
    fontSize: 14,
  },
  rowCode: {
    color: COLORS.textHint,
    fontSize: 12,
    marginTop: 2,
  },
  pinBtn: {
    paddingLeft: 10,
    paddingVertical: 6,
  },
});
