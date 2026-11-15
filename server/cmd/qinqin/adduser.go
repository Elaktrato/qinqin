package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"qinqin/internal/auth"
)

// adduserCmd runs `qinqin adduser --data <dir> --username <name>
// [--admin]`. The password comes from $QINQIN_PASSWORD when set, else
// from one line of stdin after a prompt on stderr. Stdin is read as-is,
// so a terminal echoes it; pipe the password in or use the environment
// variable to keep it off the screen.
func adduserCmd(args []string, stdin io.Reader, stderr io.Writer) error {
	fset := flag.NewFlagSet("adduser", flag.ContinueOnError)
	data := fset.String("data", defaultData(), "data directory holding the SQLite database (default $QINQIN_DATA or ./data)")
	username := fset.String("username", "", "name of the user to create (required)")
	admin := fset.Bool("admin", false, "make the user an instance admin")
	if err := fset.Parse(args); err != nil {
		return err
	}
	if *username == "" {
		return fmt.Errorf("%w: adduser needs --username", errUsage)
	}

	password := os.Getenv("QINQIN_PASSWORD")
	if password == "" {
		fmt.Fprintf(stderr, "Password for %s: ", *username)
		line, err := bufio.NewReader(stdin).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return fmt.Errorf("read password: %w", err)
		}
		password = strings.TrimRight(line, "\r\n")
	}
	if password == "" {
		return errors.New("adduser: password must not be empty")
	}

	if err := auth.CheckPassword(*username, password); err != nil {
		return fmt.Errorf("adduser: %s", auth.PolicyReason(err))
	}
	registerLanguages()
	sqlDB, err := openData(*data)
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	if err := auth.CheckNewUsername(context.Background(), sqlDB, *username); err != nil {
		if errors.Is(err, auth.ErrUsernameTaken) {
			return fmt.Errorf("adduser: username %q is taken", *username)
		}
		return fmt.Errorf("adduser: %s", auth.PolicyReason(err))
	}
	u, err := auth.CreateUser(context.Background(), sqlDB, *username, password, *admin)
	if errors.Is(err, auth.ErrUsernameTaken) {
		return fmt.Errorf("adduser: username %q is taken", *username)
	}
	if err != nil {
		return err
	}
	fmt.Fprintf(stderr, "created user %s (id %d, admin %t)\n", u.Username, u.ID, u.Admin)
	return nil
}
