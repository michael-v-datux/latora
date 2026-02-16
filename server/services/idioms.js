/**
 * server/services/idioms.js — Idiom / phrase enrichment via Claude
 *
 * Goal:
 * - Detect when a phrase likely has an idiomatic meaning
 * - Provide idiomatic translations (1-3) + short note
 *
 * This is an OPTIONAL enrichment step.
 * If Claude is unavailable or fails, we simply return null and keep the base DeepL translation.
 */

const Anthropic = require('@anthropic-ai/sdk');

let anthropic;
try {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
} catch {
  anthropic = null;
}

function parseClaudeJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Claude returned empty response');
  }

  let text = rawText.trim();

  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '');
    text = text.replace(/\s*```\s*$/i, '');
    text = text.trim();
  }

  try {
    return JSON.parse(text);
  } catch (e1) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const candidate = text.slice(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // fallthrough
      }
    }
    const preview = text.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`Claude response is not valid JSON: ${e1.message}. Preview: "${preview}"`);
  }
}

function isPhrase(original) {
  const s = String(original || '').trim();
  // We treat multi-word, hyphenated or with apostrophe as a phrase candidate
  return /\s/.test(s) || /[-–—]/.test(s) || /['’]/.test(s);
}

/**
 * @param {Object} args
 * @param {string} args.original
 * @param {string} args.baseTranslation
 * @param {string} args.sourceLang
 * @param {string} args.targetLang
 * @returns {null|{kind: 'idiomatic'|'literal'|'mixed', note: string|null, alternatives: Array<{type:'idiomatic'|'literal'|'variant', text:string, confidence:number}>}}
 */
async function enrichIdioms({ original, baseTranslation, sourceLang, targetLang }) {
  if (!anthropic) return null;
  if (!original || !baseTranslation) return null;
  if (!isPhrase(original)) return null;

  const o = String(original).trim();
  const bt = String(baseTranslation).trim();
  const sl = String(sourceLang || '').toUpperCase();
  const tl = String(targetLang || '').toUpperCase();

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 450,
      messages: [
        {
          role: 'user',
          content: `You are a professional translator and language teacher.

We translated a source phrase using DeepL.

SOURCE_LANG: ${sl}
TARGET_LANG: ${tl}
SOURCE: "${o}"
DEEPL_TRANSLATION: "${bt}"

Task:
1) Decide if the SOURCE is an idiom / set phrase where a literal translation may miss the intended meaning.
2) If it IS idiomatic, provide 1-3 idiomatic translations in the TARGET language (short and natural).
3) Provide a short note in TARGET language explaining the meaning/usage in one sentence.

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "is_idiom": true,
  "kind": "mixed",
  "note": "...",
  "idiomatic_translations": [
    {"text": "...", "confidence": 0.86},
    {"text": "...", "confidence": 0.78}
  ]
}

Rules:
- If not idiomatic, return: {"is_idiom": false}
- kind: one of "literal", "idiomatic", "mixed"
- confidence: 0.0 to 1.0
- Do NOT include the literal DeepL translation in idiomatic_translations.
`,
        },
      ],
    });

    const responseText = message.content?.[0]?.text?.trim() || '';
    const parsed = parseClaudeJson(responseText);

    if (!parsed || parsed.is_idiom !== true) return null;

    const alts = Array.isArray(parsed.idiomatic_translations) ? parsed.idiomatic_translations : [];
    const cleaned = alts
      .map((x) => ({
        type: 'idiomatic',
        text: String(x?.text || '').trim(),
        confidence: Number(x?.confidence ?? 0.7),
      }))
      .filter((x) => x.text.length > 0)
      .slice(0, 3);

    if (cleaned.length === 0) return null;

    return {
      kind: (parsed.kind === 'idiomatic' || parsed.kind === 'literal' || parsed.kind === 'mixed') ? parsed.kind : 'mixed',
      note: parsed.note ? String(parsed.note).trim() : null,
      alternatives: cleaned,
    };
  } catch (e) {
    console.warn('Idioms enrichment error:', e.message);
    return null;
  }
}

module.exports = {
  enrichIdioms,
};
