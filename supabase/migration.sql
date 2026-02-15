-- ═══════════════════════════════════════════════════════════
-- LexiLevel — Міграція бази даних для Supabase
-- ═══════════════════════════════════════════════════════════
-- 
-- Як використовувати:
-- 1. Відкрийте ваш проєкт у Supabase Dashboard
-- 2. Перейдіть до SQL Editor (ліве меню)
-- 3. Створіть новий запит (New Query)
-- 4. Вставте весь цей код і натисніть Run
-- ═══════════════════════════════════════════════════════════

-- Таблиця слів (глобальна, спільна для всіх користувачів)
-- Коли хтось перекладає слово, результат зберігається тут
-- і використовується повторно (кеш)
CREATE TABLE IF NOT EXISTS words (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  original TEXT NOT NULL UNIQUE,          -- англійське слово
  translation TEXT NOT NULL,              -- український переклад
  transcription TEXT,                     -- IPA транскрипція
  difficulty_score INT DEFAULT 50         -- бал складності (1-100)
    CHECK (difficulty_score >= 1 AND difficulty_score <= 100),
  cefr_level TEXT DEFAULT 'B1'            -- рівень CEFR
    CHECK (cefr_level IN ('A1','A2','B1','B2','C1','C2')),
  difficulty_factors JSONB DEFAULT '{}',  -- деталі оцінки від AI
  example_sentence TEXT,                  -- приклад у реченні
  part_of_speech TEXT,                    -- частина мови (noun, verb, etc.)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Списки користувача
CREATE TABLE IF NOT EXISTS lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '📚',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Зв'язок слів зі списками (many-to-many)
-- Одне слово може бути в кількох списках
CREATE TABLE IF NOT EXISTS list_words (
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (list_id, word_id)
);

-- Прогрес повторення (SM-2 алгоритм)
-- Для кожного користувача зберігається прогрес по кожному слову
CREATE TABLE IF NOT EXISTS user_word_progress (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word_id UUID NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  ease_factor REAL DEFAULT 2.5,           -- фактор легкості (мін. 1.3)
  interval_days INT DEFAULT 0,            -- інтервал до наступного повторення
  repetitions INT DEFAULT 0,              -- кількість успішних повторень
  next_review TIMESTAMPTZ DEFAULT now(),  -- дата наступного повторення
  last_result TEXT DEFAULT 'new'          -- останній результат
    CHECK (last_result IN ('new','forgot','hard','good','easy')),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, word_id)
);

-- ═══ Індекси для швидкого пошуку ═══
CREATE INDEX IF NOT EXISTS idx_words_original ON words(original);
CREATE INDEX IF NOT EXISTS idx_lists_user_id ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_list_words_list_id ON list_words(list_id);
CREATE INDEX IF NOT EXISTS idx_list_words_word_id ON list_words(word_id);
CREATE INDEX IF NOT EXISTS idx_progress_user_id ON user_word_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_next_review ON user_word_progress(next_review);

-- ═══ Row Level Security (RLS) ═══
-- Захист: кожен користувач бачить тільки СВОЇ дані

ALTER TABLE words ENABLE ROW LEVEL SECURITY;
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_word_progress ENABLE ROW LEVEL SECURITY;

-- Слова доступні всім для читання (це кеш перекладів)
CREATE POLICY "Words are publicly readable"
  ON words FOR SELECT USING (true);

-- Вставляти слова може тільки authenticated користувач
CREATE POLICY "Authenticated users can insert words"
  ON words FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Списки: повний доступ тільки до своїх
CREATE POLICY "Users manage own lists"
  ON lists FOR ALL USING (auth.uid() = user_id);

-- Слова в списках: доступ через свої списки
CREATE POLICY "Users manage own list_words"
  ON list_words FOR ALL
  USING (list_id IN (SELECT id FROM lists WHERE user_id = auth.uid()));

-- Прогрес: тільки свій
CREATE POLICY "Users manage own progress"
  ON user_word_progress FOR ALL USING (auth.uid() = user_id);

-- ═══ Функція для автоматичного оновлення updated_at ═══
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_progress_updated_at
  BEFORE UPDATE ON user_word_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
