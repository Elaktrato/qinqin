package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

// writeError is the one way the API answers an error (docs/contracts/auth/
// errors.json, spec 2026-11-23-error-contract-design.md): status, then the
// JSON body {"error": code, "message": message}. code is a catalogue code;
// message is an English sentence for developers and logs that never carries
// a path, SQL or a lower layer's error text. extra adds members beside the
// two fixed ones (attemptsLeft, existingId, ...); it never replaces them.
func writeError(w http.ResponseWriter, status int, code, message string, extra ...map[string]any) {
	body := map[string]any{}
	for _, e := range extra {
		for k, v := range e {
			body[k] = v
		}
	}
	body["error"] = code
	body["message"] = message
	w.Header().Set("X-Content-Type-Options", "nosniff") // as http.Error did
	writeJSON(w, status, body)
}

// writeTooLarge answers 413 too_large: the request body is above the
// route's cap.
func writeTooLarge(w http.ResponseWriter) {
	writeError(w, http.StatusRequestEntityTooLarge, "too_large", "Request body too large.")
}

// writeMalformed answers 400 bad_request for a body that is not the JSON
// the route reads.
func writeMalformed(w http.ResponseWriter) {
	writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
}

// badBody answers a request body that failed to decode: 413 too_large when
// it exceeded its cap, 400 bad_request when it was malformed.
func badBody(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		writeTooLarge(w)
		return
	}
	writeMalformed(w)
}

// readBody reads the whole request body, at most limit bytes. Beyond
// the cap it stops reading, answers 413 itself and reports false; another
// read failure is a 400.
func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, bool) {
	body, err := readBodyErr(w, r, limit)
	if err != nil {
		badBody(w, err)
		return nil, false
	}
	return body, true
}

// decodeBody reads at most limit bytes of the request body and decodes the
// JSON in it into v. Over the cap it answers 413 too_large, otherwise any
// failure is 400 bad_request. strict also refuses unknown fields and
// anything after the first JSON value; lenient routes ignore both, as
// they always have. It reports whether v was decoded.
func decodeBody(w http.ResponseWriter, r *http.Request, v any, limit int64, strict bool) bool {
	body, ok := readBody(w, r, limit)
	if !ok {
		return false
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	if strict {
		dec.DisallowUnknownFields()
	}
	if err := dec.Decode(v); err != nil {
		writeMalformed(w)
		return false
	}
	if strict {
		if extra := dec.Decode(&json.RawMessage{}); extra != io.EOF {
			writeMalformed(w)
			return false
		}
	}
	return true
}

// codedErrors passes a response through until its status is an error: then
// it swallows the status and body the wrapped writer (the mux's 404 and 405,
// http.ServeContent's 416 and 412) would send in text, so the caller can
// answer with writeError instead. Headers set before (Allow, Content-Range)
// stay.
type codedErrors struct {
	http.ResponseWriter
	status int // the swallowed error status; 0: none
}

func (c *codedErrors) WriteHeader(status int) {
	if status >= 400 {
		c.status = status
		return
	}
	c.ResponseWriter.WriteHeader(status)
}

func (c *codedErrors) Write(b []byte) (int, error) {
	if c.status != 0 {
		return len(b), nil
	}
	return c.ResponseWriter.Write(b)
}

// answer writes the coded error for a swallowed status; false: there was none.
func (c *codedErrors) answer() bool {
	if c.status == 0 {
		return false
	}
	h := c.ResponseWriter.Header()
	h.Del("Content-Length")
	h.Del("Content-Encoding")
	h.Del("X-Content-Type-Options")
	switch c.status {
	case http.StatusNotFound:
		writeError(c.ResponseWriter, c.status, "not_found", "No such API route.")
	case http.StatusMethodNotAllowed:
		writeError(c.ResponseWriter, c.status, "method_not_allowed", "This API route does not take this method.")
	case http.StatusRequestedRangeNotSatisfiable:
		writeError(c.ResponseWriter, c.status, "range_not_satisfiable", "The requested range lies outside the file.")
	case http.StatusPreconditionFailed:
		writeError(c.ResponseWriter, c.status, "precondition_failed", "The file does not meet the request's precondition.")
	default:
		if c.status >= 500 {
			writeError(c.ResponseWriter, c.status, "internal", "Internal server error.")
		} else {
			writeError(c.ResponseWriter, c.status, "bad_request", "The request cannot be served.")
		}
	}
	return true
}

// serveContent is http.ServeContent (Range, If-Range, conditional
// requests) with its error answers coded (spec section 2).
func serveContent(w http.ResponseWriter, r *http.Request, modtime time.Time, content io.ReadSeeker) {
	cw := &codedErrors{ResponseWriter: w}
	http.ServeContent(cw, r, "", modtime, content)
	cw.answer()
}

// codedUnmatched answers a request no route matches with 404 not_found or
// 405 method_not_allowed as JSON; matched requests go straight to the mux.
func codedUnmatched(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, pattern := mux.Handler(r); pattern != "" {
			mux.ServeHTTP(w, r)
			return
		}
		cw := &codedErrors{ResponseWriter: w}
		mux.ServeHTTP(cw, r)
		cw.answer()
	})
}
