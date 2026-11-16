// Package db opens the qinqin SQLite database and applies embedded,
// ordered schema migrations.
package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite" // registers the "sqlite" driver
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Open opens the SQLite database at path with synchronous=FULL, the
// durable default for serving: committed transactions survive an OS or
// power failure.
func Open(path string) (*sql.DB, error) {
	return open(path, "FULL")
}

// OpenForSeed opens the database like Open but with synchronous=NORMAL,
// the WAL bulk-import setting: no fsync per commit. Seeding is
// idempotent, so a crash costs a re-run, never corruption or stale
// user data. Only seed uses this.
func OpenForSeed(path string) (*sql.DB, error) {
	return open(path, "NORMAL")
}

// OpenReadOnly opens an existing database read-only and WITHOUT applying
// migrations, so a command such as `qinqin backup` can run beside the server
// (or against an older database) and never changes it. A missing file is an
// error, not a new database.
func OpenReadOnly(path string) (*sql.DB, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("open database %s: %w", path, err)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("open database %s: %w", path, err)
	}
	// A URI: characters such as ? # % and spaces in the path must be escaped.
	u := url.URL{Scheme: "file", Path: abs}
	sqlDB, err := sql.Open("sqlite", u.String()+"?mode=ro&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open database %s: %w", path, err)
	}
	if err := sqlDB.Ping(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("open database %s read-only: %w", path, err)
	}
	return sqlDB, nil
}

func open(path, synchronous string) (*sql.DB, error) {
	// busy_timeout(5000) makes concurrent writers wait for the lock instead
	// of failing immediately with SQLITE_BUSY (applied per pooled connection).
	// journal_mode(WAL) lets the server keep reading while another process
	// (qinqin seed via docker compose exec) writes; with the default
	// rollback journal those reads would block until the busy timeout.
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous("+synchronous+")")
	if err != nil {
		return nil, fmt.Errorf("open database %s: %w", path, err)
	}
	if err := migrate(sqlDB); err != nil {
		sqlDB.Close()
		return nil, err
	}
	return sqlDB, nil
}

// migrate applies each migrations/00N_*.sql file once, in filename order.
func migrate(sqlDB *sql.DB) error {
	return migrateThrough(sqlDB, "")
}

// migrateThrough applies the pending migrations up to and including
// version last ("" for all), so tests can populate a database at an
// older schema before the next migration runs.
//
// Each migration runs in one transaction on a pooled connection with
// SQLite's default foreign_keys=OFF (the DSN never enables it), which
// is what lets a migration rebuild a referenced table (create, copy,
// drop, rename) without the drop cascading into its children.
//
// Decision (#1): foreign keys stay declarative at runtime too. No path
// deletes users, and an orphaned session row is inert (the session
// lookup joins users); enabling the pragma would mean reworking every
// table-rebuilding migration.
func migrateThrough(sqlDB *sql.DB, last string) error {
	// secure_delete zeroes the pages a migration frees, so the plaintext
	// session tokens of the pre-032 table do not linger in the file. It is
	// per connection, so the pool is held to one connection while migrating
	// and the pragma is switched off again afterwards (a pack uninstall or an
	// import must not pay for it).
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.SetMaxOpenConns(0)
	if _, err := sqlDB.Exec(`PRAGMA secure_delete = ON`); err != nil {
		return fmt.Errorf("secure_delete on: %w", err)
	}
	defer sqlDB.Exec(`PRAGMA secure_delete = OFF`)
	if _, err := sqlDB.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		updated_at TEXT NOT NULL
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	applied, err := appliedMigrations(sqlDB)
	if err != nil {
		return err
	}

	names, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	sort.Strings(names)

	for _, name := range names {
		version := versionOf(name)
		if last != "" && version > last {
			break
		}
		if applied[version] {
			continue
		}
		body, err := migrationsFS.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		if err := applyMigration(sqlDB, version, body); err != nil {
			return err
		}
	}
	return nil
}

// appliedMigrations returns the set of migration versions already recorded.
func appliedMigrations(sqlDB *sql.DB) (map[string]bool, error) {
	rows, err := sqlDB.Query(`SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("read schema_migrations: %w", err)
	}
	defer rows.Close()

	applied := map[string]bool{}
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("scan schema_migrations: %w", err)
		}
		applied[version] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan schema_migrations: %w", err)
	}
	return applied, nil
}

// versionOf derives the migration version from its embedded file path:
// "migrations/001_init.sql" -> "001_init".
func versionOf(name string) string {
	return strings.TrimSuffix(strings.TrimPrefix(name, "migrations/"), ".sql")
}

// applyMigration runs one migration and records it in schema_migrations
// within a single transaction, so a failed migration is never recorded.
// The version's Go step (goSteps), if any, runs after its SQL in the same
// transaction.
func applyMigration(sqlDB *sql.DB, version string, body []byte) error {
	tx, err := sqlDB.Begin()
	if err != nil {
		return fmt.Errorf("begin migration %s: %w", version, err)
	}
	defer tx.Rollback()

	if stmt := strings.TrimSpace(string(body)); stmt != "" {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("apply migration %s: %w", version, err)
		}
	}
	if step := goSteps[version]; step != nil {
		if err := step(tx); err != nil {
			return fmt.Errorf("go step of migration %s: %w", version, err)
		}
	}
	if _, err := tx.Exec(
		`INSERT INTO schema_migrations (version, updated_at) VALUES (?, ?)`,
		version, time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		return fmt.Errorf("record migration %s: %w", version, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %s: %w", version, err)
	}
	return nil
}
