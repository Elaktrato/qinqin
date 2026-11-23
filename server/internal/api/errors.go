package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
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
