package lang

// Word classes of the Japanese rule table (server/internal/lemma/tables/
// ja.json, "classes"), which maps each to its JMdict part-of-speech tags.
const (
	ClassV1   = "v1"    // ichidan verb: v1, v1-s
	ClassV5   = "v5"    // godan verb: any v5* (v5r, v5k-s, v5aru, v5r-i, …)
	ClassVs   = "vs"    // する verb: vs, vs-i, vs-s, vs-c
	ClassVk   = "vk"    // 来る: vk
	ClassAdjI = "adj-i" // i-adjective: adj-i, adj-ix
)
