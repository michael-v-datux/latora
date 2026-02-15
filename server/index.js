/**
 * server/index.js — Бекенд-сервер LexiLevel
 * 
 * Express-сервер, який обробляє запити від мобільного додатка:
 * - /api/translate — переклад слова + оцінка складності
 * - /api/lists — управління списками
 * - /api/practice — дані для повторення
 * 
 * Запуск: node server/index.js
 * Або:   npm run server
 */

const express = require('express');
const cors = require('cors');

// Завантажуємо змінні з .env файлу
require('dotenv').config();
require("./lib/env");

const translateRoutes = require('./routes/translate');
const listsRoutes = require('./routes/lists');
const practiceRoutes = require('./routes/practice');

const errorHandler = require("./middleware/error");

const app = express();
const PORT = process.env.PORT || 3001;

// === Middleware (обробка кожного запиту) ===
app.use(cors());              // дозволяє запити з мобільного додатка
app.use(express.json());      // парсить JSON у тілі запитів

// === Маршрути (routes) ===
app.use('/api', translateRoutes);
app.use('/api', listsRoutes);
app.use('/api', practiceRoutes);

// === Health check (перевірка що сервер працює) ===
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

// === Запуск сервера ===
app.listen(PORT, () => {
  console.log(`🚀 LexiLevel server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
});