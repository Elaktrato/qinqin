// Command fakeai serves fake OpenAI-compatible and Gemini APIs with canned
// replies, for checking qinqin against a custom endpoint without any real AI
// service. A key containing "bad" is answered 401 and the markers
// [[fake:401]], [[fake:quota]], [[fake:busy]] and [[fake:refusal]] in a
// request pick canned failures, like ai.Fake. It logs the method, the path
// and whether a key was sent, never the key.
//
//	go run ./tools/fakeai -addr :9000
//
// OpenAI-compatible base URL: http://host:9000/v1; Gemini: http://host:9000/v1beta.
package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"qinqin/internal/ai/aitest"
)

func handler(logw io.Writer) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/v1beta/", &aitest.Gemini{})
	mux.Handle("/", &aitest.OpenAI{})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := "no"
		if r.Header.Get("Authorization") != "" || r.Header.Get("x-goog-api-key") != "" {
			auth = "yes"
		}
		fmt.Fprintf(logw, "%s %s auth=%s\n", r.Method, r.URL.Path, auth)
		mux.ServeHTTP(w, r)
	})
}

func main() {
	addr := flag.String("addr", ":9000", "listen address")
	flag.Parse()
	log.SetFlags(log.LstdFlags)
	log.Printf("fakeai listening on %s (no real AI service is contacted)", *addr)
	logw := writerFunc(func(p []byte) (int, error) {
		log.Print(strings.TrimRight(string(p), "\n"))
		return len(p), nil
	})
	if err := http.ListenAndServe(*addr, handler(logw)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

type writerFunc func([]byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }
