package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"strconv"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/avatar"
)

// Profile pictures (#189, docs/contracts/auth/avatar.json).

const (
	avatarUploadsHour = 10
	// maxAvatarBody is the multipart body around one picture: the picture's
	// cap plus room for the part headers and the boundary.
	maxAvatarBody = avatar.MaxBytes + 16<<10
)

func (s *server) avatars() avatar.Store {
	return avatar.Store{DB: s.db, Dir: avatar.Dir(s.dataDir)}
}

func avatarTooLarge(w http.ResponseWriter) {
	writeError(w, http.StatusRequestEntityTooLarge, "photo_too_large", "That picture is larger than 5 MB.")
}

// readAvatarPart reads the multipart field "file" as it streams, at most
// avatar.MaxBytes; nothing is parsed to disk. ok false: an answer was written.
func readAvatarPart(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if ct, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || ct != "multipart/form-data" {
		writeError(w, http.StatusBadRequest, "bad_request", "A multipart/form-data body with the field \"file\" required.")
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarBody)
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "A multipart/form-data body with the field \"file\" required.")
		return nil, false
	}
	for {
		part, err := mr.NextPart()
		var big *http.MaxBytesError
		switch {
		case errors.As(err, &big):
			avatarTooLarge(w)
			return nil, false
		case err == io.EOF:
			writeError(w, http.StatusBadRequest, "bad_request", "Multipart field \"file\" with the picture required.")
			return nil, false
		case err != nil:
			writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
			return nil, false
		}
		if part.FormName() != "file" {
			part.Close()
			continue
		}
		data, err := io.ReadAll(io.LimitReader(part, avatar.MaxBytes+1))
		part.Close()
		switch {
		case errors.As(err, &big) || (err == nil && len(data) > avatar.MaxBytes):
			avatarTooLarge(w)
			return nil, false
		case err != nil:
			writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
			return nil, false
		}
		return data, true
	}
}

// handleUploadAvatar serves POST /api/account/avatar: the multipart field
// "file", a JPEG, PNG or WebP of at most 5 MB. The picture is decoded and
// stored as two fresh square JPEGs (internal/avatar); 200 {avatarUrl}.
func (s *server) handleUploadAvatar(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	data, ok := readAvatarPart(w, r)
	if !ok {
		return
	}
	// The hourly limit counts every picture that reaches the decoder.
	if ok, wait := s.avatarUse.take(u.ID, time.Now(), avatarUploadsHour); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(secondsCeil(wait)))
		writeError(w, http.StatusTooManyRequests, "rate_limited", "You have changed your picture "+strconv.Itoa(avatarUploadsHour)+" times this hour. Try again later.")
		return
	}
	img, err := avatar.Normalize(r.Context(), data) // in one of the shared decode slots
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		writeClientGone(w)
		return
	case errors.Is(err, avatar.ErrAnimated):
		writeError(w, http.StatusUnsupportedMediaType, "animated_image", "Animated pictures cannot be used. Choose a still JPEG, PNG or WebP.")
		return
	case errors.Is(err, avatar.ErrUnsupported):
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_image", "Choose a JPEG, PNG or WebP picture.")
		return
	case errors.Is(err, avatar.ErrTooLarge):
		writeError(w, http.StatusUnprocessableEntity, "image_too_large", "That picture is larger than 25 megapixels or 8192 pixels a side.")
		return
	case err != nil:
		log.Printf("avatar: normalise: %v", err)
		writeInternal(w, r)
		return
	}
	if s.avatarHook != nil {
		s.avatarHook()
	}
	var hash string
	err = s.users.WithUserLock(func() error {
		// The account may have been deleted or disabled while the picture was
		// decoded: under the lock a deletion holds, store only for a live one
		// (a personal restore checks the same).
		if _, e := auth.ActiveUser(r.Context(), s.db, u.ID); e != nil {
			return e
		}
		var e error
		hash, e = s.avatars().Set(r.Context(), u.ID, img)
		return e
	})
	if errors.Is(err, auth.ErrUserNotFound) {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Sign in to continue.")
		return
	}
	if err != nil {
		log.Printf("avatar: store: %v", err)
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"avatarUrl": avatar.URL(u.ID, hash)})
}

// handleRemoveAvatar serves DELETE /api/account/avatar: 204, also when there
// was no picture.
func (s *server) handleRemoveAvatar(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	err := s.users.WithUserLock(func() error {
		_, e := s.avatars().Remove(r.Context(), u.ID)
		return e
	})
	if err != nil {
		log.Printf("avatar: remove: %v", err)
		writeInternal(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleGetAvatar serves GET /api/avatars/{user}/{hash}[?size=64] to any
// signed-in user of this server: the 256 px file, or the 64 px one. Only the
// user's current picture is served; revalidated on every use (no-cache), so
// a removed picture stops showing.
func (s *server) handleGetAvatar(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	size := avatar.LargeSize
	switch r.URL.Query().Get("size") {
	case "", "256":
	case "64":
		size = avatar.SmallSize
	default:
		writeError(w, http.StatusBadRequest, "bad_request", "size is 64 or 256.")
		return
	}
	notFound := func() { writeError(w, http.StatusNotFound, "not_found", "No such picture.") }
	raw := r.PathValue("user")
	userID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || strconv.FormatInt(userID, 10) != raw {
		notFound()
		return
	}
	hash := r.PathValue("hash")
	data, err := s.avatars().Read(r.Context(), userID, hash, size)
	if errors.Is(err, avatar.ErrNotFound) {
		notFound()
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "image/jpeg")
	h.Set("Cache-Control", "private, no-cache")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("ETag", `"`+hash+"-"+strconv.Itoa(size)+`"`)
	serveContent(w, r, time.Time{}, bytes.NewReader(data))
}

// handleAdminRemoveAvatar serves DELETE /api/admin/users/{id}/avatar: an
// administrator removes a user's picture, audited as avatar_removed. 404
// when the user or the picture does not exist.
func (s *server) handleAdminRemoveAvatar(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	id, ok := userTarget(w, r)
	if !ok {
		return
	}
	err := s.users.RemoveAvatar(r.Context(), admin.ID, id, s.dataDir)
	switch {
	case errors.Is(err, auth.ErrNoAvatar):
		writeError(w, http.StatusNotFound, "not_found", "This user has no profile picture.")
	case err != nil:
		if !writeUserError(w, err) {
			writeInternal(w, r)
		}
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// avatarURLOf is the avatarUrl of a user for an answer (nil: none).
func (s *server) avatarURLOf(ctx context.Context, userID int64) (*string, error) {
	hash, err := s.avatars().Current(ctx, userID)
	if err != nil {
		return nil, err
	}
	return avatar.URLOf(userID, hash), nil
}
