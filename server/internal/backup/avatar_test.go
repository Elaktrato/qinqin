package backup

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"qinqin/internal/avatar"
	"qinqin/internal/imaging"
)

func solidPNG(t *testing.T, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 40, 40))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = c.R, c.G, c.B, c.A
	}
	var b bytes.Buffer
	png.Encode(&b, img)
	return b.Bytes()
}

func avatars(w *baseWorld) avatar.Store {
	return avatar.Store{DB: w.DB, Dir: avatar.Dir(w.Data)}
}

func setPicture(t *testing.T, w *baseWorld, uid int64, c color.RGBA) string {
	t.Helper()
	img, err := avatar.Normalize(context.Background(), solidPNG(t, c))
	if err != nil {
		t.Fatal(err)
	}
	hash, err := avatars(w).Set(context.Background(), uid, img)
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

// centre is the colour in the middle of the user's current 256 px picture.
func centre(t *testing.T, w *baseWorld, uid int64) (r, g, b uint32) {
	t.Helper()
	st := avatars(w)
	hash, err := st.Current(context.Background(), uid)
	if err != nil || hash == "" {
		t.Fatalf("user %d has no picture (%v)", uid, err)
	}
	data, err := st.Read(context.Background(), uid, hash, avatar.LargeSize)
	if err != nil {
		t.Fatal(err)
	}
	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	r, g, b, _ = img.At(128, 128).RGBA()
	return r >> 8, g >> 8, b >> 8
}

func pictureFiles(t *testing.T, w *baseWorld, uid int64) []string {
	t.Helper()
	entries, _ := os.ReadDir(filepath.Join(avatar.Dir(w.Data), strconv.FormatInt(uid, 10)))
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	return out
}

func TestExportCarriesThePicture(t *testing.T) {
	w := newWorld(t)
	hash := setPicture(t, w, w.AliceUID, color.RGBA{200, 30, 30, 255})
	data, man := exportBytes(t, w, w.AliceUID)
	files, _ := unzipAll(t, data)
	want, _ := avatars(w).Read(context.Background(), w.AliceUID, hash, avatar.LargeSize)
	if got := files[NameAvatar]; !bytes.Equal(got, want) {
		t.Fatalf("%s holds %d bytes, want the 256 px file (%d bytes)", NameAvatar, len(got), len(want))
	}
	if man.Counts["avatar"] != 1 {
		t.Fatalf("manifest count avatar = %d, want 1", man.Counts["avatar"])
	}
	// Bob has none: no entry, count 0.
	data, man = exportBytes(t, w, w.BobID)
	files, _ = unzipAll(t, data)
	if _, ok := files[NameAvatar]; ok || man.Counts["avatar"] != 0 {
		t.Fatalf("bob's export carries a picture (count %d)", man.Counts["avatar"])
	}
}

func TestRestoreBringsThePictureBackAndOnlyTheUsers(t *testing.T) {
	w := newWorld(t)
	setPicture(t, w, w.AliceUID, color.RGBA{200, 30, 30, 255})
	bobHash := setPicture(t, w, w.BobID, color.RGBA{30, 200, 30, 255})
	a := openExport(t, w, w.AliceUID)
	// Alice changes her picture after the backup.
	later := setPicture(t, w, w.AliceUID, color.RGBA{30, 30, 200, 255})

	if _, rep, err := Restore(context.Background(), deps(w), w.AliceUID, 0, a, Options{}); err != nil {
		t.Fatalf("Restore: %v (%+v)", err, rep)
	}
	if r, g, b := centre(t, w, w.AliceUID); r < 170 || g > 70 || b > 70 {
		t.Fatalf("the restored picture is %d,%d,%d, want the red one of the backup", r, g, b)
	}
	hash, _ := avatars(w).Current(context.Background(), w.AliceUID)
	if hash == later {
		t.Fatal("the picture of after the backup is still current")
	}
	if got := pictureFiles(t, w, w.AliceUID); len(got) != 2 || got[0] != hash+"-256.jpg" || got[1] != hash+"-64.jpg" {
		t.Fatalf("alice's files after the restore: %v", got)
	}
	if cur, _ := avatars(w).Current(context.Background(), w.BobID); cur != bobHash || len(pictureFiles(t, w, w.BobID)) != 2 {
		t.Fatalf("bob's picture changed: %q %v", cur, pictureFiles(t, w, w.BobID))
	}
	// The safety export taken before the restore holds the picture it replaced.
	p, ok := LatestSafetyExport(w.Data, w.AliceUID)
	if !ok {
		t.Fatal("no safety export")
	}
	raw, _ := os.ReadFile(p)
	files, _ := unzipAll(t, raw)
	if len(files[NameAvatar]) == 0 {
		t.Fatal("the safety export lacks the picture it replaced")
	}
}

func TestRestoreWithoutAPictureRemovesTheCurrentOne(t *testing.T) {
	w := newWorld(t)
	a := openExport(t, w, w.AliceUID)
	setPicture(t, w, w.AliceUID, color.RGBA{30, 30, 200, 255})
	if _, rep, err := Restore(context.Background(), deps(w), w.AliceUID, 0, a, Options{}); err != nil {
		t.Fatalf("Restore: %v (%+v)", err, rep)
	}
	if cur, _ := avatars(w).Current(context.Background(), w.AliceUID); cur != "" {
		t.Fatalf("a restore of an archive without a picture kept %q", cur)
	}
	if got := pictureFiles(t, w, w.AliceUID); len(got) != 0 {
		t.Fatalf("files left: %v", got)
	}
}

func TestArchivePictureIsCheckedLikeAnUpload(t *testing.T) {
	good, err := avatar.Normalize(context.Background(), solidPNG(t, color.RGBA{1, 2, 3, 255}))
	if err != nil {
		t.Fatal(err)
	}
	withCount := func(n int) zopts {
		return zopts{manifest: func(m map[string]any) { m["counts"].(map[string]any)["avatar"] = n }}
	}
	files := sampleFiles(t)
	files[NameAvatar] = good.Large
	a, err := Open(writeZip(t, files, withCount(1)))
	if err != nil {
		t.Fatalf("a valid picture: %v", err)
	}
	if a.Avatar == nil {
		t.Fatal("the archive's picture was not kept")
	}
	a.Close()
	for name, c := range map[string]struct {
		data  []byte
		count int
	}{
		"svg":       {[]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 1},
		"text":      {[]byte("not a picture"), 1},
		"count off": {good.Large, 0},
		"too large": {append(append([]byte{}, good.Large...), make([]byte, avatar.MaxBytes)...), 1},
	} {
		files := sampleFiles(t)
		files[NameAvatar] = c.data
		var ie *InvalidError
		if _, err := Open(writeZip(t, files, withCount(c.count))); !errors.As(err, &ie) {
			t.Errorf("%s: err = %v, want an InvalidError", name, err)
		}
	}
	// A count without the entry is refused too.
	var ie *InvalidError
	if _, err := Open(writeZip(t, sampleFiles(t), withCount(1))); !errors.As(err, &ie) {
		t.Errorf("count 1 without a picture: %v", err)
	}
}

func TestServerBackupCarriesThePictures(t *testing.T) {
	w := newWorld(t)
	hash := setPicture(t, w, w.AliceUID, color.RGBA{200, 30, 30, 255})
	var buf bytes.Buffer
	if err := WriteServer(context.Background(), w.DB, w.Data, AllIncluded, &buf, testMeta); err != nil {
		t.Fatal(err)
	}
	files, _ := untar(t, buf.Bytes())
	for _, size := range []string{"256", "64"} {
		name := "avatars/" + strconv.FormatInt(w.AliceUID, 10) + "/" + hash + "-" + size + ".jpg"
		if len(files[name]) == 0 {
			t.Errorf("the server backup lacks %s", name)
		}
	}
	// Without the database part there are no pictures either (they travel with the rows).
	buf.Reset()
	if err := WriteServer(context.Background(), w.DB, w.Data, Include{Books: true}, &buf, testMeta); err != nil {
		t.Fatal(err)
	}
	files, _ = untar(t, buf.Bytes())
	for name := range files {
		if filepath.Dir(filepath.Dir(name)) == "avatars" {
			t.Errorf("%s is in a backup without the database", name)
		}
	}
}

// The archive's picture is decoded in one of the server's decode slots,
// shared with uploads, so restores of many users cannot decode unbounded.
func TestArchivePictureTakesADecodeSlot(t *testing.T) {
	good, err := avatar.Normalize(context.Background(), solidPNG(t, color.RGBA{1, 2, 3, 255}))
	if err != nil {
		t.Fatal(err)
	}
	files := sampleFiles(t)
	files[NameAvatar] = good.Large
	path := writeZip(t, files, zopts{manifest: func(m map[string]any) { m["counts"].(map[string]any)["avatar"] = 1 }})
	var releases []func()
	for range imaging.DecodeSlots {
		r, _ := imaging.AcquireDecode(context.Background())
		releases = append(releases, r)
	}
	done := make(chan error, 1)
	go func() {
		a, err := Open(path)
		if err == nil {
			a.Close()
		}
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("Open finished (%v) while every decode slot was taken", err)
	case <-time.After(200 * time.Millisecond):
	}
	for _, r := range releases {
		r()
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
