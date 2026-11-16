package mail

import (
	"errors"
	"net/smtp"
)

// loginAuth is AUTH LOGIN (Microsoft 365 and some hosts offer no PLAIN). Like
// smtp.PlainAuth it refuses to run on a connection without TLS.
type loginAuth struct{ username, password string }

func (a loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS {
		return "", nil, errors.New("mail: AUTH LOGIN needs TLS")
	}
	return "LOGIN", nil, nil
}

func (a loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch string(fromServer) {
	case "Username:", "username:", "User Name:":
		return []byte(a.username), nil
	case "Password:", "password:":
		return []byte(a.password), nil
	}
	return nil, errors.New("mail: unexpected AUTH LOGIN prompt")
}
