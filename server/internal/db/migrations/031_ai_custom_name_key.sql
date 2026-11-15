-- Custom endpoint names must be unique under normalisation (case, width,
-- look-alike letters, spacing). name_key holds the normalised form the
-- application computes; the unique index makes the database, not a
-- read-then-insert check, the arbiter between two admins creating the same
-- name at once. Existing rows get their lower-cased name; a duplicate gets
-- its id appended so the index can be built.
ALTER TABLE ai_custom_providers ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
UPDATE ai_custom_providers SET name_key = lower(name) ||
    CASE WHEN rowid > (SELECT MIN(c.rowid) FROM ai_custom_providers c WHERE lower(c.name) = lower(ai_custom_providers.name))
         THEN '#' || id ELSE '' END;
CREATE UNIQUE INDEX ai_custom_providers_name_key ON ai_custom_providers (name_key);
