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
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');
const path = require('path');

// Завантажуємо змінні з .env файлу
require('dotenv').config();
require("./lib/env");

const translateRoutes = require('./routes/translate');
const listsRoutes = require('./routes/lists');
const practiceRoutes = require('./routes/practice');
const languagesRoutes = require('./routes/languages');
const profileRoutes   = require('./routes/profile');

const errorHandler = require("./middleware/error");

const app = express();
const PORT = process.env.PORT || 3001;

// === Middleware (обробка кожного запиту) ===
app.use(cors());              // дозволяє запити з мобільного додатка
app.use(express.json());      // парсить JSON у тілі запитів

// === Request ID — кожен запит отримує унікальний ID для трасування ===
app.use((req, res, next) => {
  req.requestId = randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// === Latency logging ===
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const icon = res.statusCode >= 500 ? '❌' : res.statusCode >= 400 ? '⚠️' : '⏱';
    console.log(`${icon} [${req.requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// === Rate limit (protect paid APIs) ===
const translateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/translate', translateLimiter);

// === Маршрути (routes) ===
app.use('/api', translateRoutes);
app.use('/api', listsRoutes);
app.use('/api', practiceRoutes);
app.use('/api', languagesRoutes);
app.use('/api', profileRoutes);

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