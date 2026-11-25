package reminders

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"qinqin/internal/keyed"
)

// EmailOff switches the email channel off in the user's `reminders` row,
// keeping every other key (and a newer version) as it is; with no row it
// creates a disabled one. It is what the unsubscribe link does.
func EmailOff(ctx context.Context, db *sql.DB, userID int64) error {
	m := map[string]json.RawMessage{}
	r, err := keyed.Get(ctx, db, userID, nil, Key)
	switch {
	case err == nil:
		if json.Unmarshal(r.Data, &m) != nil || m == nil {
			m = map[string]json.RawMessage{}
		}
	case !errors.Is(err, keyed.ErrNotFound):
		return fmt.Errorf("reminders: read settings: %w", err)
	}
	var version float64
	if json.Unmarshal(m["version"], &version) != nil || version < 1 || version != float64(int64(version)) {
		m["version"] = json.RawMessage("1")
	}
	if _, ok := m["enabled"]; !ok {
		m["enabled"] = json.RawMessage("false")
	}
	ch := map[string]json.RawMessage{}
	_ = json.Unmarshal(m["channels"], &ch)
	if ch == nil {
		ch = map[string]json.RawMessage{}
	}
	ch["email"] = json.RawMessage("false")
	m["channels"], _ = json.Marshal(ch)
	out, err := json.Marshal(m)
	if err != nil {
		return err
	}
	if _, err := keyed.Put(ctx, db, userID, nil, Key, out, nil); err != nil {
		return fmt.Errorf("reminders: write settings: %w", err)
	}
	return nil
}
