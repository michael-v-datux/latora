/**
 * src/i18n/index.js
 *
 * Lightweight i18n (no extra deps):
 * - JSON dictionaries
 * - persisted locale in AsyncStorage
 * - t(key, vars) with nested keys + {{interpolation}}
 * - plural forms via key suffixes: _one/_few/_many/_other
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import en from "./locales/en.json";
import uk from "./locales/uk.json";

const STORAGE_KEY = "APP_LOCALE";

const DICTS = { en, uk };

const DEFAULT_LOCALE = (() => {
    try {
        const deviceLocale = Intl.DateTimeFormat().resolvedOptions().locale || "en";
        return deviceLocale.toLowerCase().startsWith("uk") ? "uk" : "en";
    } catch {
        return "en";
    }
})();

function getNested(obj, path) {
    if (!obj) return undefined;
    const parts = String(path).split(".");
    let cur = obj;
    for (const p of parts) {
        if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
        else return undefined;
    }
    return cur;
}

function interpolate(template, vars) {
    if (!vars) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
        const v = vars[k];
        return v === undefined || v === null ? "" : String(v);
    });
}

function pluralForm(locale, count) {
    const n = Math.abs(Number(count));
    if (locale === "uk") {
        const mod10 = n % 10;
        const mod100 = n % 100;
        if (mod10 === 1 && mod100 !== 11) return "one";
        if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "few";
        return "many";
    }
    // default/en
    return n === 1 ? "one" : "other";
}

const I18nContext = createContext({
    locale: "en",
    setLocale: async () => {},
    t: (key, vars) => key,
    availableLocales: ["en", "uk"],
    localeLabel: (code) => code,
});

export function I18nProvider({ children }) {
    const [locale, setLocaleState] = useState(DEFAULT_LOCALE);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const saved = await AsyncStorage.getItem(STORAGE_KEY);
                if (mounted && saved && DICTS[saved]) setLocaleState(saved);
            } catch {
                // ignore
            } finally {
                if (mounted) setReady(true);
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    const setLocale = useCallback(async (code) => {
        const next = DICTS[code] ? code : "en";
        setLocaleState(next);
        try {
            await AsyncStorage.setItem(STORAGE_KEY, next);
        } catch {
            // ignore
        }
    }, []);

    const t = useCallback(
        (key, vars) => {
            const dict = DICTS[locale] || DICTS.en;
            const fallback = DICTS.en;

            // plural support when vars.count provided and key_* exists
            const count = vars && Object.prototype.hasOwnProperty.call(vars, "count") ? vars.count : undefined;
            if (count !== undefined) {
                const form = pluralForm(locale, count);
                const pluralKey = `${key}_${form}`;
                const valPlural = getNested(dict, pluralKey) ?? getNested(fallback, pluralKey);
                if (typeof valPlural === "string") return interpolate(valPlural, { ...vars, count });
                // fall through to base key
            }

            const val = getNested(dict, key) ?? getNested(fallback, key);
            if (typeof val === "string") return interpolate(val, vars);

            // dev hint: return key if missing
            return String(key);
        },
        [locale]
    );

    const localeLabel = useCallback((code) => {
        switch (code) {
            case "uk":
                return "Українська";
            case "en":
                return "English";
            default:
                return code;
        }
    }, []);

    const value = useMemo(
        () => ({
            locale,
            setLocale,
            t,
            availableLocales: Object.keys(DICTS),
            localeLabel,
            ready,
        }),
        [locale, setLocale, t, localeLabel]
    );

    // Avoid UI flash while loading saved locale
    if (!ready) return children;

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
    return useContext(I18nContext);
}
