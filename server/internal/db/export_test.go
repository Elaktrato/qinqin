package db

import "database/sql"

// Exported for the external migration tests that need the ai package, which
// itself imports db (an in-package test would be an import cycle).
func MigrateThrough(sqlDB *sql.DB, last string) error { return migrateThrough(sqlDB, last) }
func Migrate(sqlDB *sql.DB) error                     { return migrate(sqlDB) }
