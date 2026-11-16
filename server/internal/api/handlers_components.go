package api

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"

	"qinqin/internal/components"
)

// componentsFormat versions the GET /api/components body inside its ETag.
const componentsFormat = 1

// componentsBody is GET /api/components: the union of the language's
// active components packs (see components.Index) and the packs it is built
// from, by pack id.
type componentsBody struct {
	Language string              `json:"language"`
	Packs    []componentCredit   `json:"packs"`
	Parts    []components.Part   `json:"parts"`
	Chars    map[string][]string `json:"chars"`
}

// componentCredit is one pack the index is built from, with the credit a
// client shows next to the parts (the full credits: /api/component-packs).
type componentCredit struct {
	ID          string `json:"id"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
}

// componentPackBody is one installed components pack as served by
// GET /api/component-packs, with the credits the Sources page shows.
type componentPackBody struct {
	PackID      string `json:"packId"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Language    string `json:"language"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
}

// componentsPayloads keeps the /api/components payload per language that
// has packs; a language without packs is built (empty) and not cached.
type componentsPayloads struct{ payloadCache }

func (c *componentsPayloads) get(ctx context.Context, sqlDB *sql.DB, language string) (*charactersPayload, error) {
	version, err := components.Version(ctx, sqlDB, language)
	if err != nil {
		return nil, err
	}
	return c.payloadCache.get(language, version != components.NoPacks,
		func() (string, error) { return components.Version(ctx, sqlDB, language) },
		func(version string) (*charactersPayload, error) {
			idx, err := components.Index(ctx, sqlDB, language)
			if err != nil {
				return nil, err
			}
			packs, err := components.List(ctx, sqlDB)
			if err != nil {
				return nil, err
			}
			credits := []componentCredit{}
			for _, p := range packs {
				if p.Language == language {
					credits = append(credits, componentCredit{ID: p.PackID, License: p.License, Attribution: p.Attribution})
				}
			}
			body := componentsBody{Language: language, Packs: credits, Parts: idx.Parts, Chars: idx.Chars}
			return encodePayload(body, version, fmt.Sprintf(`W/"comp%d-%s-%d-%s"`, componentsFormat, language, len(idx.Chars), version))
		})
}

// handleListComponents serves GET /api/components?language=: for each
// character of the language's installed components packs the parts it
// contains, and every part with its stroke count and use count, for the
// radical and part lookup. It is public shared data, the same for every
// caller. A missing or malformed language is 400; a language without
// packs gets an empty index. Validators and gzip as GET /api/characters.
func (s *server) handleListComponents(w http.ResponseWriter, r *http.Request) {
	language := r.URL.Query().Get("language")
	if language == "" || !validLanguageParam(language) {
		http.Error(w, "invalid language", http.StatusBadRequest)
		return
	}
	p, err := s.comps.get(r.Context(), s.db, language)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	servePayload(w, r, p)
}

// handleListComponentPacks serves GET /api/component-packs with every
// installed components pack's credits, by pack id.
func (s *server) handleListComponentPacks(w http.ResponseWriter, r *http.Request) {
	packs, err := components.List(r.Context(), s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	list := make([]componentPackBody, 0, len(packs))
	for _, p := range packs {
		list = append(list, componentPackBody{PackID: p.PackID, Name: p.Name, Version: p.Version,
			Language: p.Language, License: p.License, Attribution: p.Attribution, Notice: p.Notice})
	}
	writeJSON(w, http.StatusOK, list)
}
