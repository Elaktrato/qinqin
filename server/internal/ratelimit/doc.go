// Package ratelimit holds the in-memory building blocks of sign-in
// throttling: a keyed token bucket, a failure backoff with a known-good
// mark, and a concurrency gate. It has no dependencies and takes the
// time as an argument so tests need no real clock. Keys are 16-byte
// HMACs (Keyer), so no table holds a username or an address.
package ratelimit
