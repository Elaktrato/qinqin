package api

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// apiSources parses every non-test Go file of this package.
func apiSources(t *testing.T) map[string]*ast.File {
	t.Helper()
	fset := token.NewFileSet()
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]*ast.File{}
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		f, err := parser.ParseFile(fset, name, src, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		out[name] = f
	}
	return out
}

// No handler may resolve a session itself: auth.Authenticate is called from
// handlers_auth.go only, where the gate helpers wrap it. A direct call
// anywhere else would skip the restriction check.
func TestOnlyTheGateAuthenticates(t *testing.T) {
	for name, f := range apiSources(t) {
		if name == "handlers_auth.go" {
			continue
		}
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if id, ok := sel.X.(*ast.Ident); ok && id.Name == "auth" && (sel.Sel.Name == "Authenticate" || sel.Sel.Name == "UserFromRequest") {
				t.Errorf("%s calls auth.%s: use requireUser, requireAdmin, requirePrincipal or optionalUser", name, sel.Sel.Name)
			}
			return true
		})
	}
}

// Routes are mounted from routes() only. A handler registered on the mux
// anywhere else would have no declared access policy and no walk.
func TestRoutesAreMountedOnlyFromTheTable(t *testing.T) {
	for name, f := range apiSources(t) {
		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok {
				continue
			}
			ast.Inspect(fn, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok || (sel.Sel.Name != "HandleFunc" && sel.Sel.Name != "Handle") {
					return true
				}
				if name == "api.go" && fn.Name.Name == "handler" {
					return true
				}
				t.Errorf("%s: %s registers a route outside routes()", name, fn.Name.Name)
				return true
			})
		}
	}
}
