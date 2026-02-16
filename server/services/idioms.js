/**
 * server/services/idioms.js — Виявлення ідіом / сталих виразів через Claude
 *
 * Мета:
 * - НЕ ламати базову логіку перекладу (DeepL лишається primary)
 * - Якщо Claude підтверджує "це ідіома/сталий вираз" — повернути альтернативи перекладу
 *
 * Повертає JSON:
 * {
 *   is_idiom: boolean,
 *   idiomatic_translations: string[],
 *   note: string
 * }
 */

const Anthropic = require('@anthropic-ai/sdk');

function initClient() {
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) return null;
  try {
    return new Anthropic({ apiKey: key });
  } catch (e) {
    console.warn("⚠️ Anthropic init failed:", e?.message);
    return null;
  }
}

const anthropic = initClient();

function stripCodeFences(s) {
  if (!s) return "";
  // Removes ```json ... ``` or ``` ... ```
  return s.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
}

function safeJsonParse(s) {
  if (!s) return null;
  const cleaned = stripCodeFences(s);
  // try direct
  try { return JSON.parse(cleaned); } catch {}
  // try extract first {...} block
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

function normalizeLang(code) {
  return (code || "").trim().toUpperCase();
}

async function detectIdioms({
  original,
  sourceLang,
  targetLang,
  literalTranslation,
}) {
  if (!anthropic) {
    return { is_idiom: false, idiomatic_translations: [], note: "" };
  }

  const o = (original || "").trim();
  if (!o) return { is_idiom: false, idiomatic_translations: [], note: "" };

  // Cheap guard: only try for multi-word phrases or likely idioms
  const looksPhrase = /\s/.test(o) || /['’\-]/.test(o);
  if (!looksPhrase) return { is_idiom: false, idiomatic_translations: [], note: "" };

  const src = normalizeLang(sourceLang);
  const tgt = normalizeLang(targetLang);

  const system = "You are a precise linguist. Return ONLY valid JSON. No markdown. No code fences.";
  const prompt = `
Task: Determine if the user's input is an idiom / fixed expression in the SOURCE language.
If yes, provide 1-3 idiomatic translations into TARGET language that native speakers would use.
If no, set is_idiom=false and return empty idiomatic_translations.

SOURCE_LANG: ${src}
TARGET_LANG: ${tgt}
INPUT: "${o}"
DEEPL_LITERAL_TRANSLATION: "${(literalTranslation || "").trim()}"

Rules:
- Return ONLY JSON object with keys: is_idiom (boolean), idiomatic_translations (array of strings), note (string).
- note: short (<= 140 chars). Empty string if not idiom.
- idiomatic_translations: distinct, natural, no quotes in strings besides normal punctuation.
`;

  try {
    const resp = await anthropic.messages.create({
      // NOTE: "*-latest" aliases may be unavailable or removed.
      // Prefer a stable, versioned model id. Override via CLAUDE_MODEL_ID.
      // Anthropic recommends Haiku 4.5 as a replacement for deprecated Haiku 3.5.
      model: process.env.CLAUDE_MODEL_ID || "claude-haiku-4-5-20251001",
      max_tokens: 300,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: prompt }],
    });

    const text = resp?.content?.map((c) => c?.text || "").join("\n") || "";
    const obj = safeJsonParse(text);

    if (!obj || typeof obj.is_idiom !== "boolean") {
      return { is_idiom: false, idiomatic_translations: [], note: "" };
    }

    const idioms = Array.isArray(obj.idiomatic_translations)
      ? obj.idiomatic_translations
          .map((x) => (typeof x === "string" ? x.trim() : ""))
          .filter(Boolean)
          .slice(0, 3)
      : [];

    return {
      is_idiom: !!obj.is_idiom && idioms.length > 0,
      idiomatic_translations: idioms,
      note: typeof obj.note === "string" ? obj.note.trim().slice(0, 140) : "",
    };
  } catch (e) {
    // Non-fatal: we never want idiom detection to break translation.
    // Log a bit more context when available.
    const status = e?.status || e?.response?.status;
    const body = e?.response?.data || e?.response?.body;
    if (status) {
      console.warn(`⚠️ Idiom detect error: ${status}`, body ? JSON.stringify(body).slice(0, 300) : e?.message);
    } else {
      console.warn("⚠️ Idiom detect error:", e?.message);
    }
    return { is_idiom: false, idiomatic_translations: [], note: "" };
  }
}

module.exports = { detectIdioms };
