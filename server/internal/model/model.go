// Package model holds the domain types shared across the qinqin backend.
package model

// User is an authenticated account. The first user registered on a fresh
// database becomes the instance admin.
type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Admin    bool   `json:"admin"`
}
