package backup

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash/crc32"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// sampleFiles reads the sample archive (everything but the manifest).
func sampleFiles(t *testing.T) map[string][]byte {
	t.Helper()
	out := map[string][]byte{}
	err := filepath.Walk(sampleDir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(sampleDir, p)
		rel = filepath.ToSlash(rel)
		if rel == NameManifest {
			return nil
		}
		b, err := os.ReadFile(p)
		out[rel] = b
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

type zopts struct {
	manifest func(m map[string]any) // edit the manifest before it is written
	noMan    bool
	extra    []zip.FileHeader // entries written verbatim after the rest (with data in rawData)
	flags    map[string]uint16
	method   map[string]uint16
	dupOf    string
}

// writeZip writes files plus a manifest that matches them (unless edited).
func writeZip(t *testing.T, files map[string][]byte, o zopts) string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	var listed []map[string]any
	for _, n := range names {
		b := files[n]
		fh := &zip.FileHeader{Name: n, Method: zip.Deflate}
		if f, ok := o.flags[n]; ok {
			fh.Flags = f
		}
		w, err := zw.CreateHeader(fh)
		if err != nil {
			t.Fatal(err)
		}
		w.Write(b)
		sum := sha256.Sum256(b)
		listed = append(listed, map[string]any{"name": n, "bytes": len(b), "sha256": hex.EncodeToString(sum[:])})
	}
	if o.dupOf != "" {
		w, _ := zw.CreateHeader(&zip.FileHeader{Name: o.dupOf, Method: zip.Deflate})
		w.Write(files[o.dupOf])
	}
	for _, fh := range o.extra {
		fh := fh
		w, _ := zw.CreateHeader(&fh)
		w.Write([]byte("[]"))
	}
	if !o.noMan {
		var m map[string]any
		json.Unmarshal(readSample(t, NameManifest), &m)
		m["files"] = listed
		if o.manifest != nil {
			o.manifest(m)
		}
		mb, _ := json.Marshal(m)
		w, _ := zw.Create(NameManifest)
		w.Write(mb)
	}
	zw.Close()
	p := filepath.Join(t.TempDir(), "a.zip")
	os.WriteFile(p, buf.Bytes(), 0o644)
	return p
}

func mut(t *testing.T, name string, f func([]byte) []byte, o zopts) string {
	files := sampleFiles(t)
	files[name] = f(files[name])
	return writeZip(t, files, o)
}

func TestOpenAcceptsTheSampleArchive(t *testing.T) {
	a, err := Open(writeZip(t, sampleFiles(t), zopts{}))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if len(a.Workspaces) != 2 || len(a.Books) != 1 || !a.HasBookFile(3) || a.Account.Username != "alice" {
		t.Errorf("archive %+v", a.Manifest)
	}
	n := 0
	a.Events(func(Event) error { n++; return nil })
	rows := 0
	a.PluginRows(func(r PluginRow) error {
		if r.WorkspaceID == nil {
			rows++
		}
		return nil
	})
	if n != 6 || rows != 1 {
		t.Errorf("events %d, global rows %d", n, rows)
	}
	rc, err := a.OpenBook(3)
	if err != nil {
		t.Fatal(err)
	}
	b := new(bytes.Buffer)
	b.ReadFrom(rc)
	rc.Close()
	if !strings.Contains(b.String(), "你好") {
		t.Errorf("book %q", b.String())
	}
}

type rejectCase struct {
	Name    string           `json:"name"`
	Builder string           `json:"builder"`
	Code    string           `json:"code"`
	Note    string           `json:"note"`
	Caps    map[string]int64 `json:"caps"`
}

func deflateRaw(t *testing.T, data []byte) []byte {
	var b bytes.Buffer
	fw, _ := flate.NewWriter(&b, flate.BestCompression)
	fw.Write(data)
	fw.Close()
	return b.Bytes()
}

// builders construct each hostile archive of reject.json.
var builders = map[string]func(t *testing.T) string{
	"version_0": func(t *testing.T) string {
		return writeZip(t, sampleFiles(t), zopts{manifest: func(m map[string]any) { m["formatVersion"] = 0 }})
	},
	"version_2": func(t *testing.T) string {
		return writeZip(t, sampleFiles(t), zopts{manifest: func(m map[string]any) { m["formatVersion"] = 2 }})
	},
	"version_string": func(t *testing.T) string {
		return writeZip(t, sampleFiles(t), zopts{manifest: func(m map[string]any) { m["formatVersion"] = "1" }})
	},
	"wrong_format_name": func(t *testing.T) string {
		return writeZip(t, sampleFiles(t), zopts{manifest: func(m map[string]any) { m["format"] = "something-else" }})
	},
	"missing_manifest": func(t *testing.T) string { return writeZip(t, sampleFiles(t), zopts{noMan: true}) },
	"sha_mismatch": func(t *testing.T) string {
		files := sampleFiles(t)
		p := writeZip(t, files, zopts{})
		// rewrite with one file changed but the old manifest
		files2 := sampleFiles(t)
		files2[PartName(NameOverlays, 1)] = []byte(strings.Replace(string(files2[PartName(NameOverlays, 1)]), "你好吗", "你好呢", 1))
		old := writeZipWithManifestFrom(t, files2, p)
		return old
	},
	"count_mismatch": func(t *testing.T) string {
		return writeZip(t, sampleFiles(t), zopts{manifest: func(m map[string]any) { m["counts"].(map[string]any)["events"] = 7 }})
	},
	"unknown_count_key": func(t *testing.T) string {
		return writeZip(t, sampleFiles(t), zopts{manifest: func(m map[string]any) { m["counts"].(map[string]any)["secrets"] = 1 }})
	},
	"duplicate_names": func(t *testing.T) string { return writeZip(t, sampleFiles(t), zopts{dupOf: PartName(NameOverlays, 1)}) },
	"zip_slip_name": func(t *testing.T) string {
		files := sampleFiles(t)
		files["../../etc/passwd"] = []byte("x")
		return writeZip(t, files, zopts{})
	},
	"absolute_name": func(t *testing.T) string {
		files := sampleFiles(t)
		files["/etc/cron.d/x"] = []byte("x")
		return writeZip(t, files, zopts{})
	},
	"book_path_traversal": func(t *testing.T) string {
		files := sampleFiles(t)
		files["library/books/../x.json"] = []byte("[]")
		return writeZip(t, files, zopts{})
	},
	"book_file_for_unlisted_id": func(t *testing.T) string {
		files := sampleFiles(t)
		files["library/books/99.json"] = []byte("[]")
		return writeZip(t, files, zopts{})
	},
	"book_not_an_array": func(t *testing.T) string {
		return mut(t, "library/books/3.json", func([]byte) []byte { return []byte(`{"a":1}`) }, zopts{})
	},
	"book_truncated_json": func(t *testing.T) string {
		return mut(t, "library/books/3.json", func([]byte) []byte { return []byte(`[{"title":"x"`) }, zopts{})
	},
	"encrypted_flag": func(t *testing.T) string {
		return writeZip(t, sampleFiles(t), zopts{flags: map[string]uint16{PartName(NameOverlays, 1): 0x1}})
	},
	"unknown_compression_method": func(t *testing.T) string {
		files := sampleFiles(t)
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		data := files[PartName(NameOverlays, 1)]
		w, err := zw.CreateRaw(&zip.FileHeader{Name: PartName(NameOverlays, 1), Method: 12, CRC32: crc32.ChecksumIEEE(data),
			CompressedSize64: uint64(len(data)), UncompressedSize64: uint64(len(data))})
		if err != nil {
			t.Fatal(err)
		}
		w.Write(data)
		zw.Close()
		p := filepath.Join(t.TempDir(), "m.zip")
		os.WriteFile(p, buf.Bytes(), 0o644)
		return p
	},
	"too_many_entries": func(t *testing.T) string { return writeZip(t, sampleFiles(t), zopts{}) },
	"line_too_long": func(t *testing.T) string {
		return mut(t, PartName(NameOverlays, 1), func([]byte) []byte {
			return []byte(`{"entryId":1,"written":"` + strings.Repeat("a", 3000) + `","readings":null,"updatedAt":"t"}` + "\n")
		}, zopts{})
	},
	"two_mib_line": func(t *testing.T) string {
		return mut(t, PartName(NameOverlays, 1), func([]byte) []byte {
			return []byte(`{"entryId":1,"written":"` + strings.Repeat("a", 2<<20) + `","readings":null,"updatedAt":"t"}` + "\n")
		}, zopts{})
	},
	"expands_beyond_total": func(t *testing.T) string {
		// ~4 MiB of valid, highly compressible lines: tiny on disk
		var b strings.Builder
		for i := 0; i < 40000; i++ {
			b.WriteString(`{"entryId":` + itoa(i+1) + `,"written":"` + strings.Repeat("z", 90) + `","readings":null,"updatedAt":"t"}` + "\n")
		}
		return mut(t, PartName(NameOverlays, 1), func([]byte) []byte { return []byte(b.String()) }, zopts{})
	},
	"forged_small_declared_size": func(t *testing.T) string {
		// deflate stream of 3 MiB of 'a' declared as 10 bytes
		big := bytes.Repeat([]byte("a"), 3<<20)
		comp := deflateRaw(t, big)
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		w, err := zw.CreateRaw(&zip.FileHeader{Name: PartName(NameOverlays, 1), Method: zip.Deflate, CRC32: crc32.ChecksumIEEE(big),
			CompressedSize64: uint64(len(comp)), UncompressedSize64: 10})
		if err != nil {
			t.Fatal(err)
		}
		w.Write(comp)
		zw.Close()
		p := filepath.Join(t.TempDir(), "f.zip")
		os.WriteFile(p, buf.Bytes(), 0o644)
		return p
	},
	"invalid_ulid": func(t *testing.T) string {
		return mut(t, EventsName(1), func(b []byte) []byte {
			return []byte(strings.Replace(string(b), "01JD000000000000000000001A", "not-a-ulid", 1))
		}, zopts{})
	},
	"event_unknown_workspace": func(t *testing.T) string {
		return mut(t, EventsName(1), func(b []byte) []byte {
			return []byte(strings.Replace(string(b), `"workspaceId":8`, `"workspaceId":999`, 1))
		}, zopts{})
	},
	"event_bad_timestamp": func(t *testing.T) string {
		return mut(t, EventsName(1), func(b []byte) []byte {
			return []byte(strings.Replace(string(b), "2026-11-12T08:00:00Z", "yesterday", 1))
		}, zopts{})
	},
	"plugin_value_too_big": func(t *testing.T) string {
		return mut(t, PartName(NamePluginData, 1), func(b []byte) []byte {
			row := `{"pluginId":"p","workspaceId":null,"key":"big","data":"` + strings.Repeat("a", MaxPluginValue+10) +
				`","version":1,"updatedAt":"t","modifiedAt":null}` + "\n"
			return append(b, row...)
		}, zopts{manifest: func(m map[string]any) { m["counts"].(map[string]any)["pluginData"] = 5 }})
	},
	"plugin_row_twice": func(t *testing.T) string {
		return mut(t, PartName(NamePluginData, 1), func(b []byte) []byte {
			l := strings.SplitN(string(b), "\n", 2)[0] + "\n"
			return append(b, l...)
		}, zopts{manifest: func(m map[string]any) { m["counts"].(map[string]any)["pluginData"] = 5 }})
	},
	"plugin_row_unknown_workspace": func(t *testing.T) string {
		return mut(t, PartName(NamePluginData, 1), func(b []byte) []byte {
			return []byte(strings.Replace(string(b), `"workspaceId":7`, `"workspaceId":77`, 1))
		}, zopts{})
	},
	"unknown_field_in_row": func(t *testing.T) string {
		return mut(t, PartName(NameOverlays, 1), func(b []byte) []byte {
			return []byte(strings.Replace(string(b), `"entryId"`, `"extra":1,"entryId"`, 1))
		}, zopts{})
	},
	"trailing_garbage_after_json": func(t *testing.T) string {
		return mut(t, NameAccount, func(b []byte) []byte { return append(b, []byte(`{"x":1}`)...) }, zopts{})
	},
	"bookmark_for_unlisted_book": func(t *testing.T) string {
		return mut(t, PartName(NameBookmarks, 1), func(b []byte) []byte {
			return []byte(strings.Replace(string(b), `"bookId":3`, `"bookId":4`, 1))
		}, zopts{})
	},
	"unknown_time_zone": func(t *testing.T) string {
		return mut(t, NameAccount, func(b []byte) []byte {
			return []byte(strings.Replace(string(b), "Europe/Berlin", "Mars/Olympus", 1))
		}, zopts{})
	},
	"unlisted_entry": func(t *testing.T) string {
		files := sampleFiles(t)
		return writeZip(t, files, zopts{manifest: func(m map[string]any) {
			l := m["files"].([]map[string]any)
			m["files"] = l[1:]
		}})
	},
	"manifest_too_big": func(t *testing.T) string {
		return writeZip(t, sampleFiles(t), zopts{manifest: func(m map[string]any) { m["appVersion"] = strings.Repeat("v", 5000) }})
	},
	"truncated_archive": func(t *testing.T) string {
		p := writeZip(t, sampleFiles(t), zopts{})
		b, _ := os.ReadFile(p)
		os.WriteFile(p, b[:len(b)/2], 0o644)
		return p
	},
	"not_a_zip": func(t *testing.T) string {
		p := filepath.Join(t.TempDir(), "x.zip")
		os.WriteFile(p, []byte("this is not a zip file at all"), 0o644)
		return p
	},
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

// writeZipWithManifestFrom writes files with the manifest of the archive at p
// (so the manifest's hashes describe other bytes).
func writeZipWithManifestFrom(t *testing.T, files map[string][]byte, p string) string {
	t.Helper()
	zr, err := zip.OpenReader(p)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	var man []byte
	for _, f := range zr.File {
		if f.Name == NameManifest {
			rc, _ := f.Open()
			var b bytes.Buffer
			b.ReadFrom(rc)
			rc.Close()
			man = b.Bytes()
		}
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for n, b := range files {
		w, _ := zw.Create(n)
		w.Write(b)
	}
	w, _ := zw.Create(NameManifest)
	w.Write(man)
	zw.Close()
	out := filepath.Join(t.TempDir(), "s.zip")
	os.WriteFile(out, buf.Bytes(), 0o644)
	return out
}

func TestRejectCases(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/backup/reject.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Doc     string       `json:"_doc"`
		Version int          `json:"version"`
		Rule    string       `json:"rule"`
		Cases   []rejectCase `json:"cases"`
	}
	strictDecode(t, raw, &fx)
	listed := map[string]bool{}
	for _, c := range fx.Cases {
		listed[c.Builder] = true
		c := c
		t.Run(c.Name, func(t *testing.T) {
			build, ok := builders[c.Builder]
			if !ok {
				t.Fatalf("no builder %q", c.Builder)
			}
			oldM, oldL, oldT, oldE := capManifest, capLine, capTotal, capEntries
			defer func() { capManifest, capLine, capTotal, capEntries = oldM, oldL, oldT, oldE }()
			if v, ok := c.Caps["manifest"]; ok {
				capManifest = v
			}
			if v, ok := c.Caps["line"]; ok {
				capLine = int(v)
			}
			if v, ok := c.Caps["total"]; ok {
				capTotal = v
			}
			if v, ok := c.Caps["entries"]; ok {
				capEntries = int(v)
			}
			a, err := Open(build(t))
			if err == nil {
				a.Close()
				t.Fatalf("accepted (%s)", c.Note)
			}
			var ie *InvalidError
			if !errors.As(err, &ie) {
				t.Fatalf("error %v is not an *InvalidError", err)
			}
			if ie.Code != c.Code {
				t.Errorf("code = %s (%s), want %s", ie.Code, ie.Detail, c.Code)
			}
			if c.Code == CodeVersion && !errors.Is(err, ErrVersion) {
				t.Error("version error does not match ErrVersion")
			}
			// the detail never echoes archive content
			if strings.Contains(ie.Detail, "passwd") || strings.Contains(ie.Detail, "etc/") {
				t.Errorf("detail echoes the hostile name: %s", ie.Detail)
			}
		})
	}
	for name := range builders {
		if !listed[name] {
			t.Errorf("builder %s is not in reject.json", name)
		}
	}
}
