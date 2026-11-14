-- The delta sync pulls each lexicon table by updated_at >= cursor; without
-- these indexes every pull scans a full dictionary's worth of rows.
CREATE INDEX IF NOT EXISTS idx_lx_entries_updated ON lx_entries (updated_at);
CREATE INDEX IF NOT EXISTS idx_lx_senses_updated ON lx_senses (updated_at);
CREATE INDEX IF NOT EXISTS idx_lx_links_updated ON lx_links (updated_at);
