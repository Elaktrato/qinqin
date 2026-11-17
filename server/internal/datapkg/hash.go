package datapkg

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// contentHash is "sha256:" over a canonical stream of the package content,
// read back from the written package database pkg:
//
//	qinqin-package <type> <formatVersion>
//	table <name>                 per data table in schema order, then
//	[v1, v2, ...]                its rows ordered by TableDef.Order, as JSON arrays
//	table qq_sources             the sources by (type, pack_id), likewise
//	text <type>/<packId>/<name> <bytes>
//	<text>                       every licence text, sources and names in order
//	key <name> <bytes>
//	<value>                      every type-specific qq_package value (grammar levels_json)
//
// qq_package's revision, build time and instance id are not content, so it
// is not hashed. Row order comes from ORDER BY on the package database,
// which makes the hash independent of insertion order and SQLite version.
func contentHash(ctx context.Context, pkg *sql.DB, spec Spec, def typeDef, extras [][2]string) (string, error) {
	h := sha256.New()
	w := bufio.NewWriterSize(h, 64<<10)
	fmt.Fprintf(w, "qinqin-package %s %d\n", spec.Type, FormatVersion)
	tables := append([]TableDef(nil), def.tables...)
	tables = append(tables, TableDef{Name: "qq_sources", Order: []string{"type", "pack_id"},
		cols: []string{"type", "pack_id", "name", "version", "license", "attribution", "notice", "license_files"}})
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	for _, tb := range tables {
		fmt.Fprintf(w, "table %s\n", tb.Name)
		rows, err := pkg.QueryContext(ctx, "SELECT "+strings.Join(tb.cols, ", ")+" FROM "+tb.Name+" ORDER BY "+strings.Join(tb.Order, ", "))
		if err != nil {
			return "", err
		}
		vals := make([]any, len(tb.cols))
		ptrs := make([]any, len(tb.cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		for rows.Next() {
			if err := rows.Scan(ptrs...); err != nil {
				rows.Close()
				return "", err
			}
			for i, v := range vals {
				if b, ok := v.([]byte); ok { // a BLOB never comes from the writers; hash it as text
					vals[i] = string(b)
				}
			}
			if err := enc.Encode(vals); err != nil {
				rows.Close()
				return "", err
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return "", err
		}
		rows.Close()
	}
	for _, src := range sortedSources(spec.Sources) {
		for _, t := range src.Texts {
			fmt.Fprintf(w, "text %s/%s/%s %d\n%s\n", src.Type, src.PackID, t.Name, len(t.Text), t.Text)
		}
	}
	for _, kv := range extras {
		fmt.Fprintf(w, "key %s %d\n%s\n", kv[0], len(kv[1]), kv[1])
	}
	if err := w.Flush(); err != nil {
		return "", err
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil)), nil
}
