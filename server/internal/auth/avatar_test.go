package auth_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/avatar"
)

func storedAvatar(t *testing.T, st avatar.Store, userID int64) string {
	t.Helper()
	var b bytes.Buffer
	png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 20, 20)))
	img, err := avatar.Normalize(context.Background(), b.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	hash, err := st.Set(context.Background(), userID, img)
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

func TestAdminUsersCarryTheAvatarURL(t *testing.T) {
	ctx := context.Background()
	sqlDB, users := usersFixture(t)
	admin := mkUser(t, sqlDB, "alice", true)
	bob := mkUser(t, sqlDB, "bob", false)
	st := avatar.Store{DB: sqlDB, Dir: avatar.Dir(t.TempDir())}
	hash := storedAvatar(t, st, bob)
	list, err := users.ListUsers(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range list {
		switch u.ID {
		case admin:
			if u.AvatarURL != nil {
				t.Errorf("alice has no picture, got %q", *u.AvatarURL)
			}
		case bob:
			if u.AvatarURL == nil || *u.AvatarURL != avatar.URL(bob, hash) {
				t.Errorf("bob's avatarUrl = %v, want %s", u.AvatarURL, avatar.URL(bob, hash))
			}
		}
	}
	one, err := users.GetUser(ctx, bob, false)
	if err != nil || one.AvatarURL == nil || *one.AvatarURL != avatar.URL(bob, hash) {
		t.Fatalf("GetUser avatarUrl = %v (%v)", one.AvatarURL, err)
	}
}

func TestAdminRemovesAPictureWithAnAuditRow(t *testing.T) {
	ctx := context.Background()
	sqlDB, users := usersFixture(t)
	admin := mkUser(t, sqlDB, "alice", true)
	bob := mkUser(t, sqlDB, "bob", false)
	carol := mkUser(t, sqlDB, "carol", false)
	data := t.TempDir()
	st := avatar.Store{DB: sqlDB, Dir: avatar.Dir(data)}
	storedAvatar(t, st, bob)
	carolHash := storedAvatar(t, st, carol)

	if err := users.RemoveAvatar(ctx, admin, bob, data); err != nil {
		t.Fatal(err)
	}
	if cur, _ := st.Current(ctx, bob); cur != "" {
		t.Fatalf("bob still has %q", cur)
	}
	if _, err := os.Stat(filepath.Join(data, "avatars", strconv.FormatInt(bob, 10))); !os.IsNotExist(err) {
		t.Fatalf("bob's files are still there: %v", err)
	}
	if cur, _ := st.Current(ctx, carol); cur != carolHash {
		t.Fatalf("carol's picture changed: %q", cur)
	}
	var action, actor, target, detail string
	if err := sqlDB.QueryRow(`SELECT action, actor_name, target_name, detail FROM auth_audit WHERE action = 'avatar_removed'`).
		Scan(&action, &actor, &target, &detail); err != nil {
		t.Fatalf("no audit row: %v", err)
	}
	if actor != "alice" || target != "bob" || detail != "{}" {
		t.Fatalf("audit row = %s by %s on %s %s", action, actor, target, detail)
	}
	if err := users.RemoveAvatar(ctx, admin, bob, data); !errors.Is(err, auth.ErrNoAvatar) {
		t.Fatalf("second removal: %v, want ErrNoAvatar", err)
	}
	if err := users.RemoveAvatar(ctx, admin, 9999, data); !errors.Is(err, auth.ErrUserNotFound) {
		t.Fatalf("unknown user: %v, want ErrUserNotFound", err)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'avatar_removed'`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d audit rows, want 1 (refusals write none)", n)
	}
}
