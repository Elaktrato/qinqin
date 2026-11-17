-- Interface language (#73): the account's chosen interface language, '' to
-- follow the browser/device. Syntax-checked by the server (a canonical
-- language tag, never checked for support); read by clients from
-- GET /api/auth/me and by the mailer to pick a mail's language.
ALTER TABLE users ADD COLUMN interface_language TEXT NOT NULL DEFAULT '';
