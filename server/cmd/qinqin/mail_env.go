package main

import (
	"database/sql"

	"qinqin/internal/mail"
	"qinqin/internal/netguard"
)

// mailFromEnv builds the mail service: the SMTP settings live in the
// database; QINQIN_SECRET seals the password and QINQIN_SMTP_ALLOW_PRIVATE
// lets the server reach loopback and private networks (a relay container, a
// LAN host). It never fails: without a usable secret a password simply cannot
// be stored. It logs state words only.
func mailFromEnv(sqlDB *sql.DB, sec secrets, getenv func(string) string, logf func(string, ...any)) *mail.Service {
	policy := netguard.GuardPolicy{AllowPrivate: truthy(getenv("QINQIN_SMTP_ALLOW_PRIVATE"))}
	store := &mail.Store{DB: sqlDB, Policy: policy, Current: sec.Current, Previous: sec.Previous}
	if policy.AllowPrivate {
		logf("mail: SMTP servers may be on private addresses")
	}
	return &mail.Service{Store: store, Secret: sec.State, Policy: policy, Logf: logf}
}
