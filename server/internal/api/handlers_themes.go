package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"

	"qinqin/internal/themes"
)

// themeBody is one theme as GET /api/themes lists it: the theme file's
// members (accents in file order, family "" when none), its pack and
// whether it is built in.
type themeBody struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Family        string         `json:"family"`
	Scheme        string         `json:"scheme"`
	Colors        themes.Colors  `json:"colors"`
	Accents       orderedAccents `json:"accents"`
	DefaultAccent string         `json:"defaultAccent"`
	PackID        string         `json:"packId"`
	Builtin       bool           `json:"builtin"`
}

// orderedAccents writes accents as a JSON object in file order.
type orderedAccents []themes.Accent

func (a orderedAccents) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, x := range a {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(x.Key)
		v, _ := json.Marshal(x.Color)
		b.Write(k)
		b.WriteByte(':')
		b.Write(v)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

type themesBody struct {
	Themes []themeBody   `json:"themes"`
	Packs  []themes.Pack `json:"packs"`
}

func newThemeBody(t themes.Theme, packID string, builtin bool) themeBody {
	return themeBody{ID: t.ID, Name: t.Name, Family: t.Family, Scheme: t.Scheme, Colors: t.Colors,
		Accents: orderedAccents(t.Accents), DefaultAccent: t.DefaultAccent, PackID: packID, Builtin: builtin}
}

// handleListThemes serves GET /api/themes: every theme a client may paint
// with, with its colours, and every theme pack's credits for the Sources
// page (docs/contracts/themes/README.md). Built-in packs come first in
// their fixed order, then the installed packs by name; a theme id an
// installed pack shares with a built-in theme (possible only after a newer
// binary added it) is left out — the built-in one wins. Public: the
// sign-in page paints with a theme too, and nothing here is personal.
// Strong ETag with no-cache: clients revalidate and get 304 when nothing
// changed.
func (s *server) handleListThemes(w http.ResponseWriter, r *http.Request) {
	out := themesBody{Themes: []themeBody{}, Packs: []themes.Pack{}}
	builtinIDs := map[string]bool{}
	for _, p := range themes.Builtin() {
		ids := make([]string, 0, len(p.Themes))
		for _, t := range p.Themes {
			out.Themes = append(out.Themes, newThemeBody(t, p.Manifest.ID, true))
			ids = append(ids, t.ID)
			builtinIDs[t.ID] = true
		}
		m := p.Manifest
		out.Packs = append(out.Packs, themes.Pack{PackID: m.ID, Name: m.Name, Version: m.Version, License: m.License,
			Attribution: m.Attribution, Notice: m.Notice, LicenseText: p.License, Builtin: true, Themes: ids})
	}
	installed, err := themes.Installed(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	packs, err := themes.Packs(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	shown := map[string]bool{}
	for _, it := range installed {
		if builtinIDs[it.Theme.ID] {
			continue
		}
		shown[it.Theme.ID] = true
		out.Themes = append(out.Themes, newThemeBody(it.Theme, it.PackID, false))
	}
	for _, p := range packs {
		ids := []string{}
		for _, id := range p.Themes {
			if shown[id] {
				ids = append(ids, id)
			}
		}
		p.Themes = ids
		out.Packs = append(out.Packs, p)
	}
	body, err := json.Marshal(out)
	if err != nil {
		writeInternal(w, r)
		return
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	h := w.Header()
	h.Set("ETag", etag)
	h.Set("Cache-Control", "no-cache")
	if etagListed(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", "application/json")
	w.Write(body)
}
