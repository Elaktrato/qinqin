-- A pack's notice: the caveat its manifest carries next to the licence
-- and attribution (plain text, paragraphs separated by a blank line,
-- links written [text](https://...)), which the Sources page shows under
-- the pack. The three registries an imported pack writes — dictionaries,
-- frequency packs and level schemes — each gain the column. Additive:
-- existing rows get '' (no notice) until the pack is imported again.

ALTER TABLE dictionaries ADD COLUMN notice TEXT NOT NULL DEFAULT '';
ALTER TABLE frequency_packs ADD COLUMN notice TEXT NOT NULL DEFAULT '';
ALTER TABLE schemes ADD COLUMN notice TEXT NOT NULL DEFAULT '';
