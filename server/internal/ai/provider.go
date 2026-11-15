package ai

// DefaultModel is the model a new key starts with.
const DefaultModel = "claude-opus-5-5"

// ModelInfo is a selectable model.
type ModelInfo struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// Models are the only model ids the server accepts, as plain strings.
var Models = []ModelInfo{
	{"claude-opus-5-5", "Claude Opus 5.5"},
	{"claude-sonnet-5-5", "Claude Sonnet 5.5"},
	{"claude-haiku-5-5", "Claude Haiku 5.5"},
}

// ValidModel reports whether id is one of Models.
func ValidModel(id string) bool {
	for _, m := range Models {
		if m.ID == id {
			return true
		}
	}
	return false
}
