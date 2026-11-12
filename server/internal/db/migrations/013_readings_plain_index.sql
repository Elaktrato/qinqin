-- Japanese lookup finds kana-written words by their readings: JMdict
-- stores a word with a kanji form under that form only, its kana as
-- readings, so the tokenizer matches kana text against readings.plain.
CREATE INDEX IF NOT EXISTS idx_readings_plain ON readings (plain, entry_id);
