package study

// Leftovers: qinqin-flashcards plugin_data rows of a typed family that a
// migrated server may still hold (migration 038 could not read them, or a
// downgraded binary wrote them). They are inert (#198): the plugin-data
// routes answer 404 for their keys, the pull and push leave them out, and a
// backup never carries them.

// LegacyKeySQL is a SQL condition on a plugin_data key column named key
// that holds exactly for the keys rows.FamilyOf assigns to a typed family
// (GLOB is case-sensitive, like FamilyOf). Callers add pack_id = Namespace.
const LegacyKeySQL = `(key GLOB 'card:*' OR key GLOB 'deck:*' OR key GLOB 'deckcfg:*' OR key = 'limits:workspace' ` +
	`OR key GLOB 'limits:deck:*' OR key GLOB 'fsrs:set:*' OR key = 'fsrs:active')`
