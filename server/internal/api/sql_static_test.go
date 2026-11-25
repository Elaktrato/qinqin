package api

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// Record 0003 (docs/architecture/0003-domain-packages-own-their-sql.md):
// domain packages own their SQL; this package only decodes, authorises,
// calls the domain function and answers. TestNoSQLInAPI scans the source of
// every non-test file of the package for the two marks of SQL in a handler:
// a call of a database/sql query, exec, prepare or begin method, and a
// string literal that starts like an SQL statement. A finding is allowed only
// when sqlAllowed names its file and function with the reason.

// sqlCallMethods are the database/sql methods (of *sql.DB, *sql.Tx and
// *sql.Conn) that run SQL or open a transaction. The non-context forms are
// matched by shape in sqlCallFinding, since other types have methods of the
// same name (r.URL.Query(), a rate limiter's Begin, the mail store's
// Prepare).
var sqlCallMethods = map[string]bool{
	"QueryContext": true, "QueryRowContext": true, "ExecContext": true, "PrepareContext": true, "BeginTx": true,
}

// sqlStatement matches a string that starts like an SQL statement, in any
// letter case, once sqlLead is stripped: a statement keyword followed by
// what that statement needs next (SELECT a column list or a value, DELETE
// FROM, INSERT INTO, UPDATE ... SET, WITH name AS (, CREATE TABLE, ...). A
// route pattern such as "DELETE /api/workspaces/{id}" and prose such as
// "Select a language first." or "Delete it first." are not statements.
var sqlStatement = regexp.MustCompile(`(?is)^(` +
	`SELECT\s+(DISTINCT\b|ALL\b|\*|\d|'|\?|\(|EXISTS\b|COUNT\s*\(|[\w.]+\s*(,|\bFROM\b|\bAS\b|\())` +
	`|DELETE\s+FROM\b` +
	`|(INSERT|REPLACE)(\s+OR\s+\w+)?\s+INTO\b` +
	`|UPDATE(\s+OR\s+\w+)?\s+\S+\s+SET\b` +
	`|WITH\s+(RECURSIVE\s+)?\w+\s*(\([^)]*\))?\s*AS\s*(NOT\s+)?(MATERIALIZED\s+)?\(` +
	`|(CREATE|DROP|ALTER)\s+(UNIQUE\s+|TEMP\s+|TEMPORARY\s+|VIRTUAL\s+)*(TABLE|INDEX|VIEW|TRIGGER)\b` +
	`|PRAGMA\s+\w+|VACUUM(\s+INTO\b|\s*$)|ATTACH\s+(DATABASE\s+)?['"?]` +
	`)`)

// sqlLead is what may precede the statement: white space, block and line
// comments, opening parentheses.
var sqlLead = regexp.MustCompile(`^(\s+|/\*.*?\*/|--[^\n]*(\n|$)|\()+`)

// sqlText returns s without its lead when it starts like a statement, else "".
func sqlText(s string) string {
	s = sqlLead.ReplaceAllString(s, "")
	if sqlStatement.MatchString(s) {
		return s
	}
	return ""
}

// sqlAllowed lists the functions of this package that may still hold SQL,
// keyed "file.go function" (a method by its name, a package-level
// declaration as "<package>"), each with its reason. An entry without a
// finding is stale and fails the test, so the list only shrinks with the code.
var sqlAllowed = map[string]string{}

type sqlFinding struct {
	file, fn, what string
	line           int
}

func (f sqlFinding) key() string { return f.file + " " + f.fn }

// sqlFindings scans one file's source.
func sqlFindings(name, src string) ([]sqlFinding, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, name, src, 0)
	if err != nil {
		return nil, err
	}
	var out []sqlFinding
	add := func(fn string, pos token.Pos, what string) {
		out = append(out, sqlFinding{file: name, fn: fn, what: what, line: fset.Position(pos).Line})
	}
	for _, decl := range file.Decls {
		fn := "<package>"
		if fd, ok := decl.(*ast.FuncDecl); ok {
			fn = fd.Name.Name
		}
		calls := map[*ast.SelectorExpr]bool{} // selectors already reported as a call
		folded := map[ast.Node]bool{}         // literals and sub-chains already read as part of a + chain
		literal := func(pos token.Pos, text string) {
			if sql := sqlText(text); sql != "" {
				first := strings.Fields(sql)
				add(fn, pos, "SQL literal "+strings.Join(first[:min(3, len(first))], " "))
			}
		}
		ast.Inspect(decl, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.CallExpr:
				if what := sqlCallFinding(x); what != "" {
					add(fn, x.Pos(), what)
					if sel, ok := x.Fun.(*ast.SelectorExpr); ok {
						calls[sel] = true
					}
				}
			case *ast.SelectorExpr:
				// A method value (q := db.QueryRowContext) runs SQL later.
				if sqlCallMethods[x.Sel.Name] && !calls[x] {
					add(fn, x.Pos(), "method value "+x.Sel.Name)
				}
			case *ast.BinaryExpr:
				// A + chain of strings is read as one text, other operands as "?",
				// so a statement split over literals is still one statement.
				if x.Op != token.ADD || folded[x] {
					return true
				}
				if text, parts, ok := foldStrings(x); ok {
					for _, p := range parts {
						folded[p] = true
					}
					literal(x.Pos(), text)
				}
			case *ast.BasicLit:
				if x.Kind != token.STRING || folded[x] {
					return true
				}
				if s, err := strconv.Unquote(x.Value); err == nil {
					literal(x.Pos(), s)
				}
			}
			return true
		})
	}
	return out, nil
}

// sqlCallFinding names a call that runs SQL, or returns "".
func sqlCallFinding(call *ast.CallExpr) string {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	name := sel.Sel.Name
	switch {
	case sqlCallMethods[name]:
	case (name == "Query" || name == "QueryRow" || name == "Exec") && len(call.Args) > 0:
		// db.Query(q, args...); r.URL.Query() takes no argument.
	case name == "Prepare" && len(call.Args) == 1 && isStringExpr(call.Args[0]):
		// db.Prepare(q); the mail store's Prepare takes a context first.
	case name == "Begin" && len(call.Args) == 0:
		// db.Begin(); the rate limiter's Begin takes a key and a time.
	default:
		return ""
	}
	return "call " + name
}

func isStringExpr(e ast.Expr) bool {
	switch x := e.(type) {
	case *ast.BasicLit:
		return x.Kind == token.STRING
	case *ast.BinaryExpr:
		return isStringExpr(x.X) || isStringExpr(x.Y)
	}
	return false
}

// foldStrings flattens a + chain: the text of its string literals in order,
// with every other operand as "?", and the parts it read (its literals and
// inner chains). ok is false when the chain holds no string literal.
func foldStrings(e *ast.BinaryExpr) (text string, parts []ast.Node, ok bool) {
	var b strings.Builder
	lits, e0 := 0, e
	var walk func(ast.Expr)
	walk = func(e ast.Expr) {
		switch x := e.(type) {
		case *ast.BinaryExpr:
			if x.Op == token.ADD {
				if x != e0 {
					parts = append(parts, x)
				}
				walk(x.X)
				walk(x.Y)
				return
			}
		case *ast.ParenExpr:
			walk(x.X)
			return
		case *ast.BasicLit:
			if x.Kind == token.STRING {
				if s, err := strconv.Unquote(x.Value); err == nil {
					b.WriteString(s)
					parts = append(parts, x)
					lits++
					return
				}
			}
		}
		b.WriteString("?")
	}
	walk(e)
	return b.String(), parts, lits > 0
}

func TestSQLFindings(t *testing.T) {
	for _, c := range []struct {
		name, src string
		want      []string // "fn what"
	}{
		{"a query call", `package p
func h(s *server) { s.db.QueryContext(ctx, q, 1) }`, []string{"h call QueryContext"}},
		{"a transaction", `package p
func h(s *server) { tx, _ := s.db.BeginTx(ctx, nil); tx.ExecContext(ctx, q) }`, []string{"h call BeginTx", "h call ExecContext"}},
		{"the non-context forms", `package p
func h(s *server) { s.db.Query(q); s.db.QueryRow(q, 1); s.db.Exec(q); s.db.Prepare("SELECT 1"); s.db.Begin() }`,
			[]string{"h call Query", "h call QueryRow", "h call Exec", "h call Prepare", "h SQL literal SELECT 1", "h call Begin"}},
		{"a statement literal", "package p\nconst q = `\n\tSELECT id FROM workspaces`", []string{"<package> SQL literal SELECT id FROM"}},
		{"a concatenated statement", "package p\nfunc h(t string) string { return `DELETE FROM ` + t }", []string{"h SQL literal DELETE FROM ?"}},
		{"a method", `package p
func (s *server) m() { s.db.QueryRowContext(ctx, "UPDATE x SET y = 1") }`, []string{"m call QueryRowContext", "m SQL literal UPDATE x SET"}},
		{"a method value", `package p
func h(s *server) { q := s.db.QueryRowContext; q(ctx, "select id from users") }`, []string{"h method value QueryRowContext", "h SQL literal select id from"}},
		{"a method value passed on", `package p
func h(s *server) { run(s.db.ExecContext) }`, []string{"h method value ExecContext"}},
		{"a leading block comment", "package p\nconst q = `/* x */ DELETE FROM users`", []string{"<package> SQL literal DELETE FROM users"}},
		{"a leading line comment", "package p\nconst q = `-- why\n  INSERT INTO users (id) VALUES (1)`", []string{"<package> SQL literal INSERT INTO users"}},
		{"lower case", `package p
const q = "delete from users where id = ?"`, []string{"<package> SQL literal delete from users"}},
		{"a parenthesised select", `package p
const q = "(SELECT 1)"`, []string{"<package> SQL literal SELECT 1)"}},
		{"a split keyword", `package p
const q = "DEL" + "ETE FROM users"`, []string{"<package> SQL literal DELETE FROM users"}},
		{"a split statement around a name", "package p\nfunc h(t string) string { return \"UPD\" + \"ATE \" + t + \" SET a = 1\" }", []string{"h SQL literal UPDATE ? SET"}},
		{"a long chain is one finding", `package p
const q = "DELETE FROM users" + " WHERE id = " + "1" + ""`, []string{"<package> SQL literal DELETE FROM users"}},
		{"a with clause", "package p\nconst q = `WITH RECURSIVE langs(code) AS (SELECT 1) SELECT code FROM langs`", []string{"<package> SQL literal WITH RECURSIVE langs(code)"}},
		{"prose with SQL words", `package p
func h() {
	_ = "Select a language first."
	_ = "Update the app to continue."
	_ = "Delete it first, then try again."
	_ = "With a key you can sign in."
	_ = "Insert a card."
	_ = "Replace the key."
	_ = "Create a workspace for each language."
	_ = "(Select one.)"
	_ = "Sel" + "ect a deck."
}`, nil},
		{"look-alikes are not SQL", `package p
func h(r *http.Request, l *limiter, s *server) {
	r.URL.Query()
	l.Begin(pair, now)
	s.mail.Store.Prepare(ctx, in)
	_ = "DELETE /api/workspaces/{id}"
	_ = "Select a language first."
	_ = "UPDATE"
	// SELECT * FROM users
}`, nil},
	} {
		t.Run(c.name, func(t *testing.T) {
			fs, err := sqlFindings("x.go", c.src)
			if err != nil {
				t.Fatal(err)
			}
			var got []string
			for _, f := range fs {
				got = append(got, f.fn+" "+f.what)
			}
			if !slices.Equal(got, c.want) {
				t.Errorf("findings = %q, want %q", got, c.want)
			}
		})
	}
}

func TestNoSQLInAPI(t *testing.T) {
	names, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	var bad []string
	for _, name := range names {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		fs, err := sqlFindings(name, string(src))
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range fs {
			if _, ok := sqlAllowed[f.key()]; ok {
				seen[f.key()] = true
				continue
			}
			bad = append(bad, fmt.Sprintf("%s:%d %s: %s", f.file, f.line, f.fn, f.what))
		}
	}
	for _, b := range bad {
		t.Errorf("SQL in the api package (record 0003: move it into the domain package and call that): %s", b)
	}
	var stale []string
	for k, reason := range sqlAllowed {
		if reason == "" {
			t.Errorf("sqlAllowed %q has no reason", k)
		}
		if !seen[k] {
			stale = append(stale, k)
		}
	}
	sort.Strings(stale)
	for _, k := range stale {
		t.Errorf("sqlAllowed %q has no SQL any more: remove the entry", k)
	}
}
