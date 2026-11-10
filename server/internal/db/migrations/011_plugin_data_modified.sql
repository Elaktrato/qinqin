-- plugin_data.updated_at is the server's write stamp: the sync pull cursor
-- reads it. Last-write-wins needs a different clock — when the edit was
-- made. modified_at is that edit time: the client's, clamped to the server
-- clock when it arrived by sync push, and equal to updated_at for writes
-- made on the server itself. Rows written before this migration have NULL,
-- which readers treat as updated_at.

ALTER TABLE plugin_data ADD COLUMN modified_at TEXT;
