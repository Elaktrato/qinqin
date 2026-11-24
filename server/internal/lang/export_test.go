package lang

import (
	"context"
	"database/sql"
)

// InstalledPlanForTest returns the query plan of Installed, one detail
// line per step.
func InstalledPlanForTest(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, `EXPLAIN QUERY PLAN `+installedSQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var plan []string
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			return nil, err
		}
		plan = append(plan, detail)
	}
	return plan, rows.Err()
}
