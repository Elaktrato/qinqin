package mail

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/db"
	"qinqin/internal/mail/mailtest"
	"qinqin/internal/netguard"
)

type logSink struct {
	mu sync.Mutex
	l  []string
}

func (l *logSink) logf(f string, a ...any) {
	l.mu.Lock()
	l.l = append(l.l, fmt.Sprintf(f, a...))
	l.mu.Unlock()
}
func (l *logSink) all() string { l.mu.Lock(); defer l.mu.Unlock(); return strings.Join(l.l, "\n") }

func svcFor(t *testing.T, fake *mailtest.Server, sink *logSink) *Service {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	store := &Store{DB: sqlDB, Policy: netguard.GuardPolicy{AllowPrivate: true}}
	p, err := store.Prepare(context.Background(), Input{Config: Config{Host: fake.Host, Port: fake.Port, TLS: ModeStartTLS,
		FromAddress: "q@example.org", PublicURL: "https://words.example.org"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(context.Background(), p, 0); err != nil {
		t.Fatal(err)
	}
	return &Service{Store: store, Policy: netguard.GuardPolicy{AllowPrivate: true}, RootCAs: fake.RootCAs(), Timeout: 300 * time.Millisecond, Logf: sink.logf}
}

func wait(t *testing.T, cond func() bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition not reached")
}

func TestQueueSendsAndLogsKindAndUserOnly(t *testing.T) {
	fake, _ := mailtest.New(mailtest.Options{})
	defer fake.Close()
	sink := &logSink{}
	s := svcFor(t, fake, sink)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx)
	if !s.Enqueue(Job{Kind: KindLoginCode, UserID: 12, To: "bob@example.com", Data: TemplateData{Code: "123456"}}) {
		t.Fatal("enqueue refused")
	}
	wait(t, func() bool { return len(fake.Messages()) == 1 })
	wait(t, func() bool { return strings.Contains(sink.all(), "mail: sent kind=login_code user=12") })
	if strings.Contains(sink.all(), "bob@") || strings.Contains(sink.all(), "123456") {
		t.Errorf("log leaks: %s", sink.all())
	}
	if !strings.Contains(fake.Messages()[0].Data, "123456") {
		t.Error("code missing from the mail body")
	}
}

func TestEnqueueReturnsImmediatelyWithAStallingServer(t *testing.T) {
	fake, _ := mailtest.New(mailtest.Options{Stall: true})
	defer fake.Close()
	sink := &logSink{}
	s := svcFor(t, fake, sink)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx)
	begin := time.Now()
	for i := 0; i < 5; i++ {
		s.Enqueue(Job{Kind: KindLoginCode, UserID: int64(i), To: "bob@example.com"})
	}
	if d := time.Since(begin); d > 100*time.Millisecond {
		t.Fatalf("enqueue took %v", d)
	}
	wait(t, func() bool { return strings.Contains(sink.all(), "category=timeout") })
	if strings.Contains(sink.all(), "bob@example.com") {
		t.Errorf("address in log: %s", sink.all())
	}
}

func TestFullQueueDropsAndLogsWithoutAddress(t *testing.T) {
	fake, _ := mailtest.New(mailtest.Options{})
	defer fake.Close()
	sink := &logSink{}
	s := svcFor(t, fake, sink) // no worker: the buffer fills
	for i := 0; i < queueSize; i++ {
		if !s.Enqueue(Job{Kind: KindReset, UserID: 1, To: "bob@example.com"}) {
			t.Fatalf("job %d refused early", i)
		}
	}
	if s.Enqueue(Job{Kind: KindReset, UserID: 7, To: "secret-person@example.com"}) {
		t.Fatal("a full queue accepted a job")
	}
	got := sink.all()
	if !strings.Contains(got, "mail: dropped kind=reset user=7") || strings.Contains(got, "secret-person") {
		t.Errorf("log = %q", got)
	}
}

func TestGlobalHourlyCap(t *testing.T) {
	fake, _ := mailtest.New(mailtest.Options{})
	defer fake.Close()
	sink := &logSink{}
	s := svcFor(t, fake, sink)
	s.GlobalPerHour = 2
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx)
	for i := 0; i < 3; i++ {
		s.Enqueue(Job{Kind: KindMFACode, UserID: int64(i), To: "bob@example.com"})
	}
	wait(t, func() bool { return strings.Contains(sink.all(), "reason=hourly_cap") })
	if n := len(fake.Messages()); n != 2 {
		t.Errorf("sent %d, want 2", n)
	}
}

func TestBuildHookRunsOnTheWorkerAndMaySkip(t *testing.T) {
	fake, _ := mailtest.New(mailtest.Options{})
	defer fake.Close()
	s := svcFor(t, fake, &logSink{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx)
	var ran sql.NullBool
	s.Enqueue(Job{Kind: KindReset, UserID: 1, To: "bob@example.com", Build: func(context.Context, Config) (TemplateData, bool) {
		ran = sql.NullBool{Bool: true, Valid: true}
		return TemplateData{}, false
	}})
	s.Enqueue(Job{Kind: KindReset, UserID: 2, To: "bob@example.com", Build: func(context.Context, Config) (TemplateData, bool) {
		return TemplateData{Link: "https://words.example.org/reset#t=abc"}, true
	}})
	wait(t, func() bool { return len(fake.Messages()) == 1 })
	if !ran.Valid || !strings.Contains(fake.Messages()[0].Data, "reset#t=3Dabc") && !strings.Contains(fake.Messages()[0].Data, "reset#t=abc") {
		t.Errorf("build hook: ran=%v data=%q", ran, fake.Messages()[0].Data)
	}
}

func TestAnonymousTriggeredMailsCannotExhaustTheGlobalCap(t *testing.T) {
	fake, _ := mailtest.New(mailtest.Options{})
	defer fake.Close()
	sink := &logSink{}
	s := svcFor(t, fake, sink)
	s.GlobalPerHour = 4 // anonymous kinds may use 3 of them
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx)
	for i := 0; i < 6; i++ {
		s.Enqueue(Job{Kind: KindReset, UserID: int64(i), To: "bob@example.com"})
	}
	wait(t, func() bool { return strings.Contains(sink.all(), "reason=hourly_cap") })
	s.Enqueue(Job{Kind: KindMFACode, UserID: 99, To: "bob@example.com", Data: TemplateData{Code: "123456"}})
	wait(t, func() bool { return strings.Contains(sink.all(), "sent kind=mfa_code user=99") })
	if n := len(fake.Messages()); n != 4 {
		t.Errorf("sent %d, want 3 anonymous + 1 reserved", n)
	}
}
