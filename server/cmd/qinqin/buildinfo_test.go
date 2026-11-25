package main

import (
	"runtime/debug"
	"testing"

	"qinqin/internal/api"
)

func TestResolveBuild(t *testing.T) {
	vcs := &debug.BuildInfo{Settings: []debug.BuildSetting{{Key: "vcs.revision", Value: "deadbeef"}, {Key: "vcs.time", Value: "2026-01-02T03:04:05Z"}}}
	cases := []struct {
		name                string
		version, commit, dt string
		info                *debug.BuildInfo
		want                api.Build
	}{
		{"flags win", "0.7.0", "abc", "2026-11-25T00:00:00Z", vcs, api.Build{Version: "0.7.0", Commit: "abc", BuildDate: "2026-11-25T00:00:00Z"}},
		{"vcs fills the gaps", "dev", "", "", vcs, api.Build{Version: "dev", Commit: "deadbeef", BuildDate: "2026-01-02T03:04:05Z"}},
		{"nothing known", "dev", "", "", nil, api.Build{Version: "dev"}},
		{"release candidate", "0.7.0-rc1", "abc", "", nil, api.Build{Version: "0.7.0-rc1", Commit: "abc"}},
		{"garbage version", "main", "", "", nil, api.Build{Version: "dev"}},
		{"empty version", "", "", "", nil, api.Build{Version: "dev"}},
	}
	for _, tc := range cases {
		if got := resolveBuild(tc.version, tc.commit, tc.dt, tc.info); got != tc.want {
			t.Errorf("%s: %+v, want %+v", tc.name, got, tc.want)
		}
	}
}
