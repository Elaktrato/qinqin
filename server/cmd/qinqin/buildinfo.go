package main

import (
	"runtime/debug"

	"qinqin/internal/api"
	"qinqin/internal/update"
)

// commit and buildDate are set with -ldflags "-X main.commit=... -X
// main.buildDate=..." next to version (the Dockerfile ARGs, #154).
var (
	commit    string
	buildDate string
)

// buildInfo is the build metadata of this binary.
func buildInfo() api.Build {
	info, _ := debug.ReadBuildInfo()
	return resolveBuild(version, commit, buildDate, info)
}

// resolveBuild fills a missing commit and date from the VCS stamps Go puts
// into a binary built inside a checkout (go run, go build); an image build
// passes them as flags and never reads the stamps. A version that is not a
// semantic version (the default "dev") is reported as "dev".
func resolveBuild(version, commit, date string, info *debug.BuildInfo) api.Build {
	if info != nil {
		for _, s := range info.Settings {
			switch {
			case s.Key == "vcs.revision" && commit == "":
				commit = s.Value
			case s.Key == "vcs.time" && date == "":
				date = s.Value
			}
		}
	}
	if _, err := update.ParseVersion(version); err != nil {
		version = "dev"
	}
	return api.Build{Version: version, Commit: commit, BuildDate: date}
}
