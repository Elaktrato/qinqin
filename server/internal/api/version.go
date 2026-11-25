package api

import "qinqin/internal/update"

// ContractVersion is the version of the client contracts in docs/contracts/.
// It goes up by one in the change that adds a CHANGELOG entry a client must
// follow (docs/contracts/version/README.md).
const ContractVersion = 1

// BridgeLevel and BridgeFeatures say what this server's web app uses from a
// native shell (docs/contracts/version/README.md). Today the web app calls no
// optional shell feature.
const BridgeLevel = 1

var bridgeFeatures = []string{}

// Build is what the binary knows about itself (set with -ldflags in the image).
type Build struct {
	Version   string // the release without its v, or "dev"
	Commit    string
	BuildDate string
}

// WithBuild sets the build metadata the version routes report.
func WithBuild(b Build) Option { return func(s *server) { s.build = b } }

// WithUpdateChecker sets the release checker; nil leaves the check "unchecked".
func WithUpdateChecker(c *update.Checker) Option { return func(s *server) { s.updates = c } }
