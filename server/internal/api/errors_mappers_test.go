package api

import (
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strconv"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/mail"
)

// The mappers that pass a computed code to writeError (dynamicCodeWriters in
// errors_static_test.go) are checked the other way round here: every code
// they can produce is in errors.json, written with the catalogue's status.

// mappedAnswer decodes a mapper's answer and checks code and status against
// the catalogue.
func mappedAnswer(t *testing.T, cat map[string]int, name string, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct{ Error, Message string }
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Message == "" {
		t.Errorf("%s: answer %q is not {error, message}", name, w.Body.String())
		return ""
	}
	st, ok := cat[body.Error]
	if !ok {
		t.Errorf("%s: code %q is not in errors.json", name, body.Error)
	} else if w.Code != st && !slices.Contains(documentedStatuses[body.Error], w.Code) {
		t.Errorf("%s: code %q written with %d, errors.json says %d", name, body.Error, w.Code, st)
	}
	return body.Error
}

func TestAIErrorCodesAreCatalogued(t *testing.T) {
	cat := errorCatalogue(t)
	for code := range aiMessages {
		if _, ok := cat[code]; !ok {
			t.Errorf("aiMessages has %q, which is not in errors.json", code)
		}
	}
	// Every error the AI service returns, through the one mapper.
	errs := map[string]error{
		"ErrNoKey": ai.ErrNoKey, "ErrKeyUndecryptable": ai.ErrKeyUndecryptable, "ErrKeyRejected": ai.ErrKeyRejected,
		"ErrQuota": ai.ErrQuota, "ErrBusy": ai.ErrBusy, "ErrModelUnavailable": ai.ErrModelUnavailable,
		"ErrRefused": ai.ErrRefused, "ErrTruncated": ai.ErrTruncated, "ErrBadReply": ai.ErrBadReply,
		"ErrBadRequest": ai.ErrBadRequest, "ErrNoAccess": ai.ErrNoAccess, "ErrUnknownProvider": ai.ErrUnknownProvider,
		"ErrProviderDisabled": ai.ErrProviderDisabled, "ErrEndpointBlocked": ai.ErrEndpointBlocked,
		"ErrNoSelection": ai.ErrNoSelection, "ErrInFlight": ai.ErrInFlight,
		"RateLimitedError": &ai.RateLimitedError{}, "BusyError": &ai.BusyError{},
		"errTooLong": errTooLong, "errInvalidModel": errInvalidModel, "errInvalidKey": errInvalidKey,
		"errForbidden": errForbidden, "errNoVision": errNoVision("m", "p"), "errInvalidEndpoint": errInvalidEndpoint("why"),
		"unknown": errors.New("boom"),
	}
	for name, err := range errs {
		w := httptest.NewRecorder()
		writeAIError(w, err)
		mappedAnswer(t, cat, name, w)
	}
	// Every code ai.Code can return and every apiError literal of this
	// package, read from the source, so a new one cannot skip the catalogue.
	fset := token.NewFileSet()
	files, _ := filepath.Glob(filepath.Join("..", "ai", "*.go"))
	local, _ := filepath.Glob("*.go")
	for _, f := range append(files, local...) {
		if filepath.Ext(f) != ".go" || len(f) > 8 && f[len(f)-8:] == "_test.go" {
			continue
		}
		file, err := parser.ParseFile(fset, f, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.FuncDecl:
				if x.Name.Name == "Code" && x.Recv == nil && file.Name.Name == "ai" {
					ast.Inspect(x.Body, func(m ast.Node) bool {
						if ret, ok := m.(*ast.ReturnStmt); ok && len(ret.Results) == 1 {
							if lit, ok := ret.Results[0].(*ast.BasicLit); ok {
								if code, _ := strconv.Unquote(lit.Value); code != "" {
									if _, ok := cat[code]; !ok {
										t.Errorf("ai.Code returns %q, which is not in errors.json", code)
									}
								}
							}
						}
						return true
					})
				}
			case *ast.CompositeLit:
				if id, ok := x.Type.(*ast.Ident); ok && id.Name == "apiError" && len(x.Elts) > 0 {
					if lit, ok := x.Elts[0].(*ast.BasicLit); ok {
						code, _ := strconv.Unquote(lit.Value)
						if _, ok := cat[code]; !ok {
							t.Errorf("%s: apiError code %q is not in errors.json", f, code)
						}
					}
				}
			}
			return true
		})
	}
}

func TestSMTPInputErrorCodesAreCatalogued(t *testing.T) {
	cat := errorCatalogue(t)
	for _, err := range []error{mail.ErrInvalidHost, mail.ErrHostBlocked, mail.ErrInvalidPort, mail.ErrInvalidTLS,
		mail.ErrCredentialsNeedTLS, mail.ErrPasswordRequired, mail.ErrInvalidFrom, mail.ErrInvalidPublicURL,
		mail.ErrReentryRequired, mail.ErrSecretUnavailable} {
		w := httptest.NewRecorder()
		if !writeSMTPInputError(w, err) {
			t.Errorf("%v: not mapped", err)
			continue
		}
		mappedAnswer(t, cat, err.Error(), w)
	}
	if writeSMTPInputError(httptest.NewRecorder(), errors.New("other")) {
		t.Error("an unknown error was mapped")
	}
}
