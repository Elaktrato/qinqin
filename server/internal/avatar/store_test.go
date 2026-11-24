package avatar

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"qinqin/internal/dbtest"
)

func images(t *testing.T, w, h int) Images {
	t.Helper()
	img, err := Normalize(context.Background(), pngOf(t, picture(w, h)))
	if err != nil {
		t.Fatal(err)
	}
	return img
}

func newStore(t *testing.T) (Store, int64, int64) {
	t.Helper()
	sqlDB := dbtest.Open(t)
	return Store{DB: sqlDB, Dir: filepath.Join(t.TempDir(), "avatars")},
		dbtest.User(t, sqlDB, "alice"), dbtest.User(t, sqlDB, "bob")
}

func files(t *testing.T, s Store, user int64) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(s.Dir, itoa(user)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	return out
}

func TestSetStoresBothFilesUnderAContentHash(t *testing.T) {
	ctx := context.Background()
	s, alice, _ := newStore(t)
	img := images(t, 50, 40)
	hash, err := s.Set(ctx, alice, img)
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(hash) || hash != Hash(img.Large) {
		t.Fatalf("hash %q is not the content hash", hash)
	}
	if got, _ := s.Current(ctx, alice); got != hash {
		t.Fatalf("Current = %q, want %q", got, hash)
	}
	if u := URL(alice, hash); u != "/api/avatars/"+itoa(alice)+"/"+hash {
		t.Fatalf("URL = %q", u)
	}
	for size, want := range map[int][]byte{LargeSize: img.Large, SmallSize: img.Small} {
		got, err := s.Read(ctx, alice, hash, size)
		if err != nil || string(got) != string(want) {
			t.Fatalf("Read %d: %v", size, err)
		}
	}
	for _, f := range files(t, s, alice) {
		st, _ := os.Stat(filepath.Join(s.Dir, itoa(alice), f))
		if st.Mode().Perm() != 0o600 {
			t.Errorf("%s has mode %v, want 0600", f, st.Mode().Perm())
		}
	}
	st, _ := os.Stat(filepath.Join(s.Dir, itoa(alice)))
	if st.Mode().Perm() != 0o700 {
		t.Errorf("the user's folder has mode %v, want 0700", st.Mode().Perm())
	}
	if _, err := s.Read(ctx, alice, hash, 128); !errors.Is(err, ErrNotFound) {
		t.Errorf("Read of another size: %v", err)
	}
}

func TestReplaceGivesANewURLAndRemovesTheOldFiles(t *testing.T) {
	ctx := context.Background()
	s, alice, _ := newStore(t)
	first, _ := s.Set(ctx, alice, images(t, 50, 40))
	second, err := s.Set(ctx, alice, images(t, 60, 60))
	if err != nil || second == first {
		t.Fatalf("second hash %q (err %v) equals the first", second, err)
	}
	if _, err := s.Read(ctx, alice, first, LargeSize); !errors.Is(err, ErrNotFound) {
		t.Fatalf("the old picture is still served: %v", err)
	}
	if got := files(t, s, alice); len(got) != 2 {
		t.Fatalf("files after a replace: %v, want the two of the new picture", got)
	}
	// The same picture again keeps its hash and its files.
	again, _ := s.Set(ctx, alice, images(t, 60, 60))
	if again != second || len(files(t, s, alice)) != 2 {
		t.Fatalf("setting the same picture: %q, files %v", again, files(t, s, alice))
	}
}

func TestRemoveDeletesRowAndFiles(t *testing.T) {
	ctx := context.Background()
	s, alice, bob := newStore(t)
	hash, _ := s.Set(ctx, alice, images(t, 30, 30))
	bobHash, _ := s.Set(ctx, bob, images(t, 31, 30))
	gone, err := s.Remove(ctx, alice)
	if err != nil || !gone {
		t.Fatalf("Remove = %v, %v", gone, err)
	}
	if cur, _ := s.Current(ctx, alice); cur != "" {
		t.Fatalf("Current after remove = %q", cur)
	}
	if _, err := s.Read(ctx, alice, hash, LargeSize); !errors.Is(err, ErrNotFound) {
		t.Fatal("removed picture still served")
	}
	if got := files(t, s, alice); len(got) != 0 {
		t.Fatalf("files left: %v", got)
	}
	if gone, err := s.Remove(ctx, alice); err != nil || gone {
		t.Fatalf("second Remove = %v, %v", gone, err)
	}
	// The other user's picture is untouched.
	if cur, _ := s.Current(ctx, bob); cur != bobHash || len(files(t, s, bob)) != 2 {
		t.Fatalf("bob's picture changed: %q %v", cur, files(t, s, bob))
	}
}

func TestReadNeedsTheCurrentHashOfThatUser(t *testing.T) {
	ctx := context.Background()
	s, alice, bob := newStore(t)
	hash, _ := s.Set(ctx, alice, images(t, 30, 30))
	for name, c := range map[string]struct {
		user int64
		hash string
	}{
		"other user":   {bob, hash},
		"wrong hash":   {alice, "0123456789abcdef0123456789abcdef"},
		"path in hash": {alice, "../../etc/passwd"},
		"empty":        {alice, ""},
	} {
		if _, err := s.Read(ctx, c.user, c.hash, LargeSize); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: err = %v, want ErrNotFound", name, err)
		}
	}
}

func TestPruneKeepsOnlyTheCurrentPicture(t *testing.T) {
	ctx := context.Background()
	s, alice, _ := newStore(t)
	hash, _ := s.Set(ctx, alice, images(t, 30, 30))
	dir := filepath.Join(s.Dir, itoa(alice))
	for _, stray := range []string{"0123456789abcdef0123456789abcdef-256.jpg", "junk.txt"} {
		os.WriteFile(filepath.Join(dir, stray), []byte("x"), 0o600)
	}
	if err := s.Prune(ctx, alice); err != nil {
		t.Fatal(err)
	}
	got := files(t, s, alice)
	if len(got) != 2 || got[0] != hash+"-256.jpg" || got[1] != hash+"-64.jpg" {
		t.Fatalf("after prune: %v", got)
	}
}

func TestDeleteTxRemovesTheRowInsideATransaction(t *testing.T) {
	ctx := context.Background()
	s, alice, _ := newStore(t)
	s.Set(ctx, alice, images(t, 30, 30))
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	had, err := DeleteTx(ctx, tx, alice)
	if err != nil || !had {
		t.Fatalf("DeleteTx = %v, %v", had, err)
	}
	tx.Rollback()
	if cur, _ := s.Current(ctx, alice); cur == "" {
		t.Fatal("a rolled back DeleteTx removed the row")
	}
}

// Once the files are written, the row and the pruning finish even when the
// request is gone: a cancel there would leave a false error and stray files.
func TestSetFinishesAfterTheFilesAreWritten(t *testing.T) {
	s, alice, _ := newStore(t)
	s.Set(context.Background(), alice, images(t, 30, 30))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	hash, err := s.Set(ctx, alice, images(t, 31, 30))
	if err != nil {
		t.Fatalf("Set with a cancelled context after the write: %v", err)
	}
	if cur, _ := s.Current(context.Background(), alice); cur != hash {
		t.Fatalf("Current = %q, want %q", cur, hash)
	}
	if got := files(t, s, alice); len(got) != 2 {
		t.Fatalf("files: %v, want the new picture's two", got)
	}
}
