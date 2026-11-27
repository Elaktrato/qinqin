package api

import "qinqin/internal/update"

// ContractVersion is the version of the client contracts in docs/contracts/.
// It goes up by one in the change that adds a CHANGELOG entry a client must
// follow (docs/contracts/version/README.md).
const ContractVersion = 20

// BridgeLevel and BridgeFeatures say what this server's web app uses from a
// native shell (docs/contracts/version/README.md): features it uses when the
// shell has them, not ones it requires (sorted, as bridge-compat.json lists them):
//   - files: lib/native/files.ts saves a backup or the recovery codes through QinqinFiles;
//   - haptics: lib/native/haptics.ts buzzes on grading through QinqinShell.vibrate;
//   - keep-awake: lib/native/awake.ts keeps the screen on during a study session (QinqinShell.keepAwake);
//   - local-notifications: lib/native/notifications.ts (QinqinNotifications; groundwork for reminders);
//   - share: lib/native/share.ts and incoming.ts (QinqinShare: share out, shared and selected text in);
//   - status-bar: lib/native/bars.ts sends the theme's chrome colour to QinqinShell.setBars;
//   - tts: lib/native/speech.ts speaks the device voice through QinqinSpeech.
const BridgeLevel = 1

var bridgeFeatures = []string{"files", "haptics", "keep-awake", "local-notifications", "share", "status-bar", "tts"}

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
