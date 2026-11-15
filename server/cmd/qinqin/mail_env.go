package main

import (
	"database/sql"

	"qinqin/internal/mail"
	"qinqin/internal/netguard"
	"qinqin/internal/secretbox"
)

// mailFromEnv builds the mail service: the SMTP settings live in the
// database; QINQIN_SECRET seals the password and QINQIN_SMTP_ALLOW_PRIVATE
// lets the server reach loopback and private networks (a relay container, a
// LAN host). It never fails: without a usable secret a password simply cannot
// be stored. It logs state words only.
func mailFromEnv(sqlDB *sql.DB, getenv func(string) string, logf func(string, ...any)) *mail.Service {
	policy := netguard.GuardPolicy{AllowPrivate: truthy(getenv("QINQIN_SMTP_ALLOW_PRIVATE"))}
	store := &mail.Store{DB: sqlDB, Policy: policy}
	secret, state := secretbox.ParseSecret(getenv("QINQIN_SECRET"))
	if state == secretbox.SecretOK {
		store.Current = secretbox.NewSealer(secret)
		if raw := getenv("QINQIN_SECRET_PREVIOUS"); raw != "" {
			if prev, pstate := secretbox.ParseSecret(raw); pstate == secretbox.SecretOK {
				store.Previous = secretbox.NewSealer(prev)
			}
		}
	}
	if policy.AllowPrivate {
		logf("mail: SMTP servers may be on private addresses")
	}
	return &mail.Service{Store: store, Secret: state, Policy: policy, Logf: logf}
}
