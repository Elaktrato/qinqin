-- Per-sentence credit of a pack sentence (Tatoeba, CC BY 2.0 FR: the author
-- must be cited). A pack sentence carries the id of its page on Tatoeba and
-- its owner, and the same for the translation it was paired with, so the
-- entry page can say who wrote what is shown. 0 / '' for a sentence without
-- a credit (a user's own, an AI example, an older pack).
ALTER TABLE sentences ADD COLUMN credit_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentences ADD COLUMN credit_owner TEXT NOT NULL DEFAULT '';
ALTER TABLE sentences ADD COLUMN credit_tr_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sentences ADD COLUMN credit_tr_owner TEXT NOT NULL DEFAULT '';
