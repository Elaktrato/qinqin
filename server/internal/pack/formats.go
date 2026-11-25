package pack

// Pack formats: how a pack's data files are encoded.
const (
	FormatJSON      = "json"
	FormatCedict    = "cedict"
	FormatUnihan    = "unihan"
	FormatJMdict    = "jmdict"
	FormatKanjidic2 = "kanjidic2"

	// Frequency pack formats: a Yomitan dictionary (zip or directory of
	// term_meta_bank files) and a term,reading,rank CSV.
	FormatYomitanFreq = "yomitan-freq"
	FormatFreqCSV     = "freq-csv"

	// FormatAudioIndex is an audio pack: index.tsv plus clip files.
	FormatAudioIndex = "audio-index"
	// FormatComponentsTSV is a components pack: components.tsv plus an
	// optional parts.tsv (see internal/components).
	FormatComponentsTSV = "components-tsv"
	// FormatStrokesJSONLGz is a strokes pack: strokes.jsonl.gz with one
	// {"char", "data"} line per character (see internal/strokes).
	FormatStrokesJSONLGz = "hanzi-writer-jsonl-gz"
	// FormatThemesJSON is a theme pack: themes.json (docs/contracts/themes/).
	FormatThemesJSON = "themes-json"
	// FormatFontSlices is a font pack: faces.json plus slices/<sha256>.woff2
	// (docs/contracts/fonts/).
	FormatFontSlices = "font-slices"
	// FormatRulesJSON is a lemma-rules pack: rules.json, one lemmatizer rule
	// table (docs/contracts/lemma/).
	FormatRulesJSON = "rules-json"
)

// Formats is every valid manifest format, in the order the validation
// message lists them.
var Formats = []string{
	FormatJSON, FormatCedict, FormatUnihan, FormatJMdict, FormatKanjidic2,
	FormatYomitanFreq, FormatFreqCSV,
	FormatAudioIndex, FormatComponentsTSV, FormatStrokesJSONLGz, FormatThemesJSON, FormatFontSlices, FormatRulesJSON,
}
