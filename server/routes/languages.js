/**
 * server/routes/languages.js — Мови перекладу (DeepL)
 *
 * GET /api/languages
 * Повертає source/target мовні коди + назви (з DeepL), відфільтровані під продукт.
 */

const express = require('express');
const router = express.Router();
const { getLanguages } = require('../services/deepl');

// Білий список мов продукту (Європа + EN). Можна розширювати без зміни клієнта.
const ALLOWED = new Set([
  'EN', 'EN-GB', 'EN-US',
  'UK',
  'PL',
  'IT',
  'FR',
  'DE',
  'RO',
  'CS',
  'ES', 'ES-419',
  'LT',
  'LV',
  'HU',
  'ET',
  'SV',
]);

function filterAllowed(arr) {
  return (arr || []).filter((x) => ALLOWED.has(String(x.language || '').toUpperCase()));
}

router.get('/languages', async (req, res) => {
  try {
    const [source, target] = await Promise.all([
      getLanguages('source'),
      getLanguages('target'),
    ]);

    // DeepL інколи повертає лише EN/ES без регіональних кодів як source,
    // а регіональні (EN-GB/EN-US/ES-419) — як target. Ми просто відфільтровуємо по ALLOWED.
    return res.json({
      source: filterAllowed(source),
      target: filterAllowed(target),
      // корисно для клієнта
      allowed: Array.from(ALLOWED),
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Languages route error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
