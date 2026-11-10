// Package db opens the qinqin SQLite database and applies embedded,
// ordered schema migrations.
package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite" // registers the "sqlite" driver
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Open opens the SQLite database at path, creating the file if it does not
// exist, and applies every embedded migration that has not run yet. Applied
// migrations are recorded in schema_migrations by their filename-derived
// version (e.g. "001_init") and are never applied twice.
func Open(path string) (*sql.DB, error) {
	// busy_timeout(5000) makes concurrent writers wait for the lock instead
	// of failing immediately with SQLITE_BUSY (applied per pooled connection).
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)")
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
