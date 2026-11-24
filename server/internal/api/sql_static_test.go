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

// sqlStatement matches a literal that starts like an SQL statement: an
// upper-case keyword, white space, then anything but a slash, so a route
// pattern such as "DELETE /api/workspaces/{id}" is not one.
var sqlStatement = regexp.MustCompile(`^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH|CREATE|DROP|ALTER|PRAGMA|VACUUM|ATTACH)\s+[^/\s]`)

// sqlAllowed lists the functions of this package that may still hold SQL,
// keyed "file.go function" (a method by its name, a package-level
// declaration as "<package>"), each with its reason. An entry without a
// finding is stale and fails the test, so the list only shrinks with the code.
var sqlAllowed = map[string]string{
	"entry_view.go dictionaryCredits":                       "debt of #194: moves into internal/dict (plan task 7)",
	"handlers_admin_audit.go handleAdminAudit":              "debt of #194: moves into internal/auth (plan task 8)",
	"handlers_admin_backup.go handleAdminBackupDownload":    "debt of #194: moves into internal/auth (plan task 8)",
	"handlers_ai.go handleDeleteAIKey":                      "debt of #194: moves into internal/ai (plan task 9)",
	"handlers_ai_custom.go handleDeleteCustomProvider":      "debt of #194: moves into internal/ai (plan task 9)",
	"handlers_auth.go handleAuthOptions":                    "debt of #194: moves into internal/auth (plan task 8)",
	"handlers_auth.go handleRegister":                       "debt of #194: moves into internal/auth (plan task 8)",
	"handlers_backup.go handleExportDownload":               "debt of #194: moves into internal/auth (plan task 8)",
	"handlers_backup_restore.go handleSafetyExportDownload": "debt of #194: moves into internal/auth (plan task 8)",
	"handlers_dict.go handleInstallDictionary":              "debt of #194: moves into internal/dict (plan task 7)",
	"handlers_dict.go handleListDictionaries":               "debt of #194: moves into internal/dict (plan task 7)",
	"handlers_dict.go handleUninstallDictionary":            "debt of #194: moves into internal/dict (plan task 7)",
	"handlers_levels.go handleUninstallScheme":              "debt of #194: moves into internal/levels (plan task 9)",
	"handlers_login_mfa.go handleEmailLoginVerify":          "debt of #194: moves into internal/auth (plan task 8)",
	"handlers_login_mfa.go mfaChallenge":                    "debt of #194: moves into internal/auth (plan task 8)",
	"handlers_mfa.go handleTOTPDisable":                     "debt of #194: moves into internal/auth (plan task 8)",
	"handlers_packs.go handleListSentencePacks":             "debt of #194: moves into internal/sentences (plan task 9)",
}

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
		ast.Inspect(decl, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.CallExpr:
				if what := sqlCallFinding(x); what != "" {
					add(fn, x.Pos(), what)
				}
			case *ast.BasicLit:
				if x.Kind != token.STRING {
					return true
				}
				s, err := strconv.Unquote(x.Value)
				if err == nil && sqlStatement.MatchString(s) {
					first := strings.Fields(s)
					add(fn, x.Pos(), "SQL literal "+strings.Join(first[:min(3, len(first))], " "))
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
		{"a concatenated statement", "package p\nfunc h(t string) string { return `DELETE FROM ` + t }", []string{"h SQL literal DELETE FROM"}},
		{"a method", `package p
func (s *server) m() { s.db.QueryRowContext(ctx, "UPDATE x SET y = 1") }`, []string{"m call QueryRowContext", "m SQL literal UPDATE x SET"}},
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
