-- Release check settings (#154). One row: whether an administrator's opening of
-- Settings, Admin, Updates may ask GitHub Releases for the newest release, and
-- whether pre-releases count. On by default; the request is lazy (never in the
-- background). The optional GitHub token is the QINQIN_UPDATE_TOKEN variable,
-- never a row.

CREATE TABLE update_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    prereleases INTEGER NOT NULL DEFAULT 0 CHECK (prereleases IN (0, 1))
);
INSERT INTO update_settings (id) VALUES (1);
