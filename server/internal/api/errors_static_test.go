package api

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// The error contract, checked on the source (spec 2026-11-23-error-contract-
// design.md, section 4): every error answer of this package goes through
// writeError with a catalogue code. The route walk (errors_walk_test.go)
// checks the answers themselves; this test sees branches the walk cannot
// reach (a full disk, a source outage).

// errorCatalogue reads docs/contracts/auth/errors.json: code -> status.
func errorCatalogue(t *testing.T) map[string]int {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "auth", "errors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cat map[string]json.RawMessage
	if err := json.Unmarshal(raw, &cat); err != nil {
		t.Fatal(err)
	}
	out := map[string]int{}
	for code, r := range cat {
		if strings.HasPrefix(code, "_") {
			continue
		}
		var e struct {
			Status int `json:"status"`
		}
		if err := json.Unmarshal(r, &e); err != nil || e.Status == 0 {
			t.Fatalf("errors.json %q: %v", code, err)
		}
		out[code] = e.Status
	}
	return out
}

// statusNames maps the net/http constants the handlers use to their value.
var statusNames = map[string]int{
	"StatusBadRequest": 400, "StatusUnauthorized": 401, "StatusForbidden": 403, "StatusNotFound": 404,
	"StatusMethodNotAllowed": 405, "StatusConflict": 409, "StatusGone": 410, "StatusPreconditionFailed": 412,
	"StatusRequestEntityTooLarge": 413, "StatusUnsupportedMediaType": 415, "StatusRequestedRangeNotSatisfiable": 416,
	"StatusUnprocessableEntity": 422, "StatusTooManyRequests": 429, "StatusInternalServerError": 500,
	"StatusNotImplemented": 501, "StatusBadGateway": 502, "StatusServiceUnavailable": 503,
	"StatusInsufficientStorage": 507,
}

// dynamicCodeWriters are the functions that pass a computed code to
// writeError, each with every code it can produce. A computed code anywhere
// else fails: name the code at the call site.
var dynamicCodeWriters = map[string][]string{
	// The AI error mapper (handlers_ai.go): the codes of ai.Error.
	"writeAIError": {"bad_request", "busy", "rate_limited", "no_key", "no_selection", "provider_disabled", "ai_disabled",
		"key_undecryptable", "in_flight", "no_vision", "unknown_provider", "invalid_model", "invalid_key",
		"invalid_endpoint", "endpoint_blocked", "key_rejected", "quota", "model_unavailable", "no_access", "refused",
		"truncated", "bad_reply", "too_long", "empty", "forbidden"},
	// The mail settings validator (handlers_admin_smtp.go) and the test mail.
	"writeSMTPInputError": {"invalid_host", "smtp_host_blocked", "invalid_port", "invalid_tls", "credentials_need_tls",
		"password_required", "invalid_email", "invalid_public_url", "password_reentry_required", "secret_unavailable"},
	"handleTestSMTP": {"invalid_email", "recipient_required"},
	// The restricted-session refusal (restrictionError) of the gates.
	"requirePrincipal":      {"password_change_required", "mfa_enrollment_required"},
	"requireAdminPrincipal": {"password_change_required", "mfa_enrollment_required"},
	"tokenGate":             {"password_change_required", "mfa_enrollment_required"},
	// Backup: the export/restore exclusion and backup.CodeTooLarge.
	"handleExportDownload": {"export_running", "restore_running"},
	"handleRestoreUpload":  {"backup_too_large"},
}

// documentedStatuses are the other statuses errors.json's meaning gives a
// code (code_invalid and challenge_expired are 401 on the anonymous sign-in
// steps; the AI routes answer bad_request with 422).
var documentedStatuses = map[string][]int{
	"code_invalid":      {401},
	"challenge_expired": {401},
	"bad_request":       {422},
}

type errorViolation struct{ file, what string }

func scanErrorWrites(t *testing.T, cat map[string]int) (violations []errorViolation, literalSites int) {
	t.Helper()
	files, _ := filepath.Glob("*.go")
	fset := token.NewFileSet()
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, f, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		bad := func(n ast.Node, what string) {
			violations = append(violations, errorViolation{f, fset.Position(n.Pos()).String() + ": " + what})
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				switch fun := call.Fun.(type) {
				case *ast.SelectorExpr:
					if x, ok := fun.X.(*ast.Ident); ok && x.Name == "http" && (fun.Sel.Name == "Error" || fun.Sel.Name == "NotFound") {
						bad(call, "http."+fun.Sel.Name+" answers text/plain: use writeError")
					}
					if x, ok := fun.X.(*ast.Ident); ok && x.Name == "http" && fun.Sel.Name == "ServeContent" && fn.Name.Name != "serveContent" {
						bad(call, "http.ServeContent answers its errors in text: use serveContent")
					}
					if fun.Sel.Name == "WriteHeader" && len(call.Args) == 1 {
						if sel, ok := call.Args[0].(*ast.SelectorExpr); ok && statusNames[sel.Sel.Name] >= 400 {
							bad(call, "WriteHeader("+sel.Sel.Name+") answers an error without a body: use writeError")
						}
					}
				case *ast.Ident:
					switch fun.Name {
					case "writeAuthError", "jsonError", "writeJournalError":
						bad(call, fun.Name+" is gone: use writeError")
					case "writeJSON":
						if len(call.Args) == 3 && hasErrorKey(call.Args[2]) {
							bad(call, `writeJSON with an "error" member: use writeError`)
						}
					case "writeError":
						if len(call.Args) < 4 {
							bad(call, "writeError needs status, code and message")
							return true
						}
						lit, ok := call.Args[2].(*ast.BasicLit)
						if !ok {
							codes, listed := dynamicCodeWriters[fn.Name.Name]
							if fn.Name.Name == "writeError" || fn.Name.Name == "badBody" {
								return true
							}
							if !listed {
								bad(call, "writeError with a computed code outside dynamicCodeWriters ("+fn.Name.Name+")")
							}
							for _, c := range codes {
								if _, ok := cat[c]; !ok {
									bad(call, "dynamicCodeWriters["+fn.Name.Name+"] lists "+c+", which is not in errors.json")
								}
							}
							return true
						}
						literalSites++
						code, _ := strconv.Unquote(lit.Value)
						st, ok := cat[code]
						if !ok {
							bad(call, "error code "+strconv.Quote(code)+" is not in errors.json")
							return true
						}
						if sel, ok := call.Args[1].(*ast.SelectorExpr); ok && isHTTPConst(sel) {
							want, known := statusNames[sel.Sel.Name]
							if !known {
								bad(call, "unknown status constant "+sel.Sel.Name+" (add it to statusNames)")
							} else if want != st && !slices.Contains(documentedStatuses[code], want) {
								bad(call, strconv.Quote(code)+" written with "+strconv.Itoa(want)+", errors.json says "+strconv.Itoa(st))
							}
						}
						if msg, ok := call.Args[3].(*ast.BasicLit); ok {
							m, _ := strconv.Unquote(msg.Value)
							if strings.TrimSpace(m) == "" {
								bad(call, "writeError with an empty message")
							}
						}
					}
				}
				return true
			})
		}
	}
	return violations, literalSites
}

// isHTTPConst reports a net/http status constant (http.StatusX).
func isHTTPConst(sel *ast.SelectorExpr) bool {
	x, ok := sel.X.(*ast.Ident)
	return ok && x.Name == "http"
}

// hasErrorKey reports a map composite literal with an "error" key.
func hasErrorKey(e ast.Expr) bool {
	cl, ok := e.(*ast.CompositeLit)
	if !ok {
		return false
	}
	for _, el := range cl.Elts {
		kv, ok := el.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if k, ok := kv.Key.(*ast.BasicLit); ok && k.Value == `"error"` {
			return true
		}
	}
	return false
}

func TestEveryErrorGoesThroughWriteError(t *testing.T) {
	cat := errorCatalogue(t)
	violations, sites := scanErrorWrites(t, cat)
	for _, v := range violations {
		t.Error(v.what)
	}
	if sites < 100 {
		t.Errorf("only %d writeError call sites with a literal code; the scan is broken", sites)
	}
}
