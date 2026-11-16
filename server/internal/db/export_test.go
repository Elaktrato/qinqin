package db

import "database/sql"

// Exported for the external migration tests that need the ai package, which
// itself imports db (an in-package test would be an import cycle).
func MigrateThrough(sqlDB *sql.DB, last string) error { return migrateThrough(sqlDB, last) }
func Migrate(sqlDB *sql.DB) error                     { return migrate(sqlDB) }

// GoStepVersionsForTest lists the keys of goSteps.
func GoStepVersionsForTest() []string {
	var out []string
	for k := range goSteps {
		out = append(out, k)
	}
	return out
}

// SetGoStepForTest swaps one Go step and returns a restore func.
func SetGoStepForTest(version string, f func(*sql.Tx) error) (restore func()) {
	old, had := goSteps[version]
	goSteps[version] = f
	return func() {
		if had {
			goSteps[version] = old
		} else {
			delete(goSteps, version)
		}
	}
}
