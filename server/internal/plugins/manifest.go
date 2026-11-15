package plugins

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strings"
)

// The SDK versions this host accepts. A manifest's sdk must lie in
// SDKMin..SDKMax.
const SDKMin, SDKMax = 1, 1

// The closed lists of the contract.
var (
	knownSurfaces    = []string{"home-widget", "page", "hook"}
	knownPermissions = []string{"owns-data", "read:entries", "read:study-events", "write:study-events"}
	knownHooks       = []string{"study-event"}
)

var (
	idPattern      = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	versionPattern = regexp.MustCompile(`^\d+\.\d+(\.\d+)?$`)
	eventPattern   = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
	unknownField   = regexp.MustCompile(`unknown field "[^"]*"`)
)

// EventDecl is one event type a plugin emits. Activity is the optional
// rule for counting it as activity, accepted as any JSON object here.
type EventDecl struct {
	Type     string          `json:"type"`
	Activity json.RawMessage `json:"activity,omitempty"`
}

// Manifest is a feature-plugin manifest of the SDK contract.
type Manifest struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Version     string      `json:"version"`
	Type        string      `json:"type"`
	SDK         int         `json:"sdk"`
	Description string      `json:"description,omitempty"`
	Surfaces    []string    `json:"surfaces"`
	Permissions []string    `json:"permissions"`
	Hooks       []string    `json:"hooks"`
	Events      []EventDecl `json:"events"`
}

// Has reports whether the manifest declares the permission.
func (m Manifest) Has(permission string) bool {
	return slices.Contains(m.Permissions, permission)
}

// ParseManifest decodes a manifest strictly (unknown fields are an
// error) and checks every rule of the contract. All problems are
// reported in one ErrInvalidManifest-wrapped error, in field order.
func ParseManifest(raw []byte) (Manifest, error) {
	var m Manifest
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		msg := err.Error()
		if f := unknownField.FindString(msg); f != "" {
			msg = f
		}
		return Manifest{}, fmt.Errorf("%w: %s", ErrInvalidManifest, msg)
	}
	// One object only: the registry stores the bytes verbatim and
	// GET /api/plugins serves them as JSON, so anything after the object
	// (garbage, a second object) would corrupt that response.
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return Manifest{}, fmt.Errorf("%w: unexpected data after the manifest object", ErrInvalidManifest)
	}

	var problems []string
	add := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }

	switch {
	case len(m.ID) > 64:
		add("id must be at most 64 characters")
	case !idPattern.MatchString(m.ID):
		add("id %q must match %s", m.ID, idPattern)
	}
	switch n := len([]rune(m.Name)); {
	case n == 0:
		add("name is required")
	case n > 80:
		add("name must be at most 80 characters")
	}
	if !versionPattern.MatchString(m.Version) {
		add("version %q must look like 1.0 or 1.0.0", m.Version)
	}
	if m.Type != "feature" {
		add(`type must be "feature"`)
	}
	if m.SDK < SDKMin || m.SDK > SDKMax {
		add("sdk %d is not supported (%d..%d)", m.SDK, SDKMin, SDKMax)
	}
	if len([]rune(m.Description)) > 200 {
		add("description must be at most 200 characters")
	}
	checkList := func(field string, values, known []string) {
		seen := map[string]bool{}
		for i, v := range values {
			switch {
			case !slices.Contains(known, v):
				add("%s[%d] %q is unknown", field, i, v)
			case seen[v]:
				add("%s[%d] %q is repeated", field, i, v)
			}
			seen[v] = true
		}
	}
	checkList("surfaces", m.Surfaces, knownSurfaces)
	checkList("permissions", m.Permissions, knownPermissions)
	checkList("hooks", m.Hooks, knownHooks)

	hasHookSurface := slices.Contains(m.Surfaces, "hook")
	if hasHookSurface && len(m.Hooks) == 0 {
		add(`hooks must not be empty with the "hook" surface`)
	}
	if !hasHookSurface && len(m.Hooks) > 0 {
		add(`hooks must be empty without the "hook" surface`)
	}

	seenEvents := map[string]bool{}
	for i, e := range m.Events {
		if !eventPattern.MatchString(e.Type) {
			add("events[%d].type %q must match %s", i, e.Type, eventPattern)
		} else if seenEvents[e.Type] {
			add("events[%d].type %q is repeated", i, e.Type)
		}
		seenEvents[e.Type] = true
		if len(e.Activity) > 0 && !isNull(e.Activity) && !isJSONObject(e.Activity) {
			add("events[%d].activity must be an object", i)
		}
	}
	if len(m.Events) > 0 && !m.Has("write:study-events") {
		add("events need the write:study-events permission")
	}

	if len(problems) > 0 {
		return Manifest{}, fmt.Errorf("%w: %s", ErrInvalidManifest, strings.Join(problems, "; "))
	}
	return m, nil
}

// isJSONObject reports whether raw is a JSON object (not null).
func isJSONObject(raw json.RawMessage) bool {
	return len(bytes.TrimSpace(raw)) > 0 && bytes.TrimSpace(raw)[0] == '{'
}

// isNull reports whether raw is the JSON literal null, which counts as
// an absent activity rule.
func isNull(raw json.RawMessage) bool {
	return string(bytes.TrimSpace(raw)) == "null"
}
