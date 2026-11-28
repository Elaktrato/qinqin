// Package courses is the course pack type (#221): a course's skeleton as the project writes it (sections, units,
// grammar points, hanzi or kanji, reading texts, checkpoint rules; CC BY 4.0, no level-list words), the
// deterministic fill rule that gives each unit its words from the installed level packs, the topic labels and the
// frequency ranks, the per-server cache of the filled courses, and the derivation of a learner's path state from
// the `course` events of the event log.
//
// Contracts: docs/contracts/courses/ (pack.json, fill.json, derive.json, changes.json).
package courses
