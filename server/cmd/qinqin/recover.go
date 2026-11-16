package main

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"qinqin/internal/auth"
)

// recoverCmd runs `qinqin recover --data <dir> --username <name>
// [--enable] [--admin] [--reset-mfa]`: the way back in for an instance whose
// only administrator lost the password. The new password comes from
// $QINQIN_PASSWORD or one line of stdin; the user must change it at the
// next sign-in and every session of theirs ends.
func recoverCmd(args []string, stdin io.Reader, stderr io.Writer) error {
	fset := flag.NewFlagSet("recover", flag.ContinueOnError)
	data := fset.String("data", defaultData(), "data directory holding the SQLite database (default $QINQIN_DATA or ./data)")
	username := fset.String("username", "", "the account to recover (required)")
	enable := fset.Bool("enable", false, "also re-enable a disabled account")
	admin := fset.Bool("admin", false, "also make the account an administrator")
	resetMFA := fset.Bool("reset-mfa", false, "also remove two-factor authentication")
	if err := fset.Parse(args); err != nil {
		return err
	}
	if *username == "" {
		return fmt.Errorf("%w: recover needs --username", errUsage)
	}
	password := os.Getenv("QINQIN_PASSWORD")
	if password == "" {
		if isTerminal(stdin) {
			// golang.org/x/term is not a dependency of this module, so a
			// typed password is echoed (adduser has the same limit): say so.
			fmt.Fprintln(stderr, "Warning: this terminal echoes what you type. Set QINQIN_PASSWORD or pipe the password in to keep it off the screen.")
		}
		fmt.Fprintf(stderr, "New temporary password for %s: ", *username)
		line, err := bufio.NewReader(stdin).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return fmt.Errorf("read password: %w", err)
		}
		password = strings.TrimRight(line, "\r\n")
	}
	if password == "" {
		return errors.New("recover: password must not be empty")
	}
	if err := auth.CheckPassword(*username, password); err != nil {
		return fmt.Errorf("recover: %s", auth.PolicyReason(err))
	}
	sqlDB, err := openData(*data)
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	id, err := auth.RecoverAccount(context.Background(), sqlDB, auth.RecoverOptions{
		Username: *username, Hash: auth.Hash(password), Enable: *enable, Admin: *admin, ResetMFA: *resetMFA})
	if errors.Is(err, auth.ErrRecoverDisabledAdmin) {
		return fmt.Errorf("recover: %q is disabled; --admin would make an administrator who cannot sign in. Add --enable (nothing was changed)", *username)
	}
	if errors.Is(err, auth.ErrUserNotFound) {
		return fmt.Errorf("recover: no user named %q", *username)
	}
	if err != nil {
		return err
	}
	fmt.Fprintf(stderr, "recovered %s (id %d): new temporary password set, signed out everywhere, must change it at the next sign-in\n", *username, id)
	if !*enable {
		var off sql.NullString
		if sqlDB.QueryRow(`SELECT disabled_at FROM users WHERE username = ?`, *username).Scan(&off) == nil && off.Valid {
			fmt.Fprintf(stderr, "note: %s is still disabled and cannot sign in; run again with --enable to allow it\n", *username)
		}
	}
	if *resetMFA {
		fmt.Fprintf(stderr, "--reset-mfa: the authenticator, recovery codes and email codes of %s were removed\n", *username)
	}
	return nil
}

// isTerminal reports whether r is an interactive terminal (a character
// device), as opposed to a pipe or a file.
func isTerminal(r io.Reader) bool {
	f, ok := r.(*os.File)
	if !ok {
		return false
	}
	st, err := f.Stat()
	return err == nil && st.Mode()&os.ModeCharDevice != 0
}
