package grammar

import (
	"encoding/json"
	"regexp"
	"strings"
	"time"
)

// A finished lesson run is a study event of type EventType (#277,
// docs/contracts/grammar/runs.json): {point: "<packId>:<lessonId>", mode:
// "lesson", score, total}. The server stores it like any event and never
// reads it, except for the activity rule (stats/rules.go: one point per
// distinct point a day). Before #277 the progress was a table
// (migration 045, dropped by migration 056); a personal backup of
// that time carries it as keyed rows, which a restore turns into events
// here.

// EventType is the study event of a finished lesson run.
const EventType = "grammar"

// MaxExercises caps a run's number of exercises.
const MaxExercises = 1000

var packIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// LegacyKeyPrefix is the keyed form of one lesson's progress in a personal
// backup written before #277: grammar:progress:<packId>:<lessonId> with
// {completedAt, best, total}.
const LegacyKeyPrefix = "grammar:progress:"

// IsLegacyKeyed reports whether a backup row key is a lesson's progress of
// the old form.
func IsLegacyKeyed(key string) bool { return strings.HasPrefix(key, LegacyKeyPrefix) }

// Payload is the payload text of a lesson run, members in contract order.
func Payload(packID, lessonID string, score, total int) json.RawMessage {
	b, _ := json.Marshal(struct {
		Point string `json:"point"`
		Mode  string `json:"mode"`
		Score int    `json:"score"`
		Total int    `json:"total"`
	}{packID + ":" + lessonID, "lesson", score, total})
	return b
}

// LegacyEvent converts an old backup row of a lesson's progress into the one
// run it stands for (runs.json, legacy): its best score at its completedAt,
// in whole UTC seconds, or at updatedAt (the row's write time) when
// completedAt is no RFC 3339 time. ok is false for a row the rules refuse.
func LegacyEvent(key string, data json.RawMessage, updatedAt string) (ts time.Time, payload json.RawMessage, ok bool) {
	if !IsLegacyKeyed(key) {
		return time.Time{}, nil, false
	}
	pack, lesson, found := strings.Cut(strings.TrimPrefix(key, LegacyKeyPrefix), ":")
	if !found || !packIDPattern.MatchString(pack) || len(lesson) > 128 || !idPattern.MatchString(lesson) {
		return time.Time{}, nil, false
	}
	var v struct {
		CompletedAt any  `json:"completedAt"`
		Best        *int `json:"best"`
		Total       *int `json:"total"`
	}
	if json.Unmarshal(data, &v) != nil || v.Best == nil || v.Total == nil ||
		*v.Total < 0 || *v.Total > MaxExercises || *v.Best < 0 || *v.Best > *v.Total {
		return time.Time{}, nil, false
	}
	completed, _ := v.CompletedAt.(string)
	at, err := time.Parse(time.RFC3339Nano, completed)
	if err != nil {
		if at, err = time.Parse(time.RFC3339Nano, updatedAt); err != nil {
			return time.Time{}, nil, false
		}
	}
	if at.Before(time.Unix(0, 0)) {
		return time.Time{}, nil, false
	}
	return at.UTC().Truncate(time.Second), Payload(pack, lesson, *v.Best, *v.Total), true
}
