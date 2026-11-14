-- #152: the comma-separated genre strings (venue.genres, company.genres, band.genre) become
-- rows. Split on ',' and ';' like splitGenres, trimmed, empty tags dropped; a name keeps
-- the spelling it first appears in, and case variants (ASCII, the NOCASE index) are one
-- genre. The next migration drops the old columns.
CREATE TABLE `__genre_tag` (
  `seq` integer PRIMARY KEY AUTOINCREMENT,
  `owner` text NOT NULL,
  `owner_id` integer NOT NULL,
  `position` integer NOT NULL,
  `name` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__genre_tag` (`owner`, `owner_id`, `position`, `name`)
WITH RECURSIVE `split` (`owner`, `owner_id`, `position`, `name`, `rest`) AS (
  SELECT 'venue', `id`, 0, '', replace(`genres`, ';', ',') || ',' FROM `venue`
  UNION ALL
  SELECT 'company', `id`, 0, '', replace(`genres`, ';', ',') || ',' FROM `company`
  UNION ALL
  SELECT 'band', `id`, 0, '', replace(`genre`, ';', ',') || ',' FROM `band`
  UNION ALL
  SELECT `owner`, `owner_id`, `position` + 1,
    trim(substr(`rest`, 1, instr(`rest`, ',') - 1)),
    substr(`rest`, instr(`rest`, ',') + 1)
  FROM `split` WHERE `rest` <> ''
)
SELECT `owner`, `owner_id`, `position`, `name` FROM `split` WHERE `name` <> ''
ORDER BY `owner` DESC, `owner_id`, `position`;
--> statement-breakpoint
INSERT OR IGNORE INTO `genre` (`name`) SELECT `name` FROM `__genre_tag` ORDER BY `seq`;
--> statement-breakpoint
INSERT OR IGNORE INTO `venue_genre` (`venue_id`, `genre_id`, `position`)
SELECT t.`owner_id`, g.`id`, t.`position` FROM `__genre_tag` t
JOIN `genre` g ON g.`name` = t.`name` COLLATE NOCASE
WHERE t.`owner` = 'venue' ORDER BY t.`seq`;
--> statement-breakpoint
INSERT OR IGNORE INTO `company_genre` (`company_id`, `genre_id`, `position`)
SELECT t.`owner_id`, g.`id`, t.`position` FROM `__genre_tag` t
JOIN `genre` g ON g.`name` = t.`name` COLLATE NOCASE
WHERE t.`owner` = 'company' ORDER BY t.`seq`;
--> statement-breakpoint
INSERT OR IGNORE INTO `band_genre` (`band_id`, `genre_id`, `position`)
SELECT t.`owner_id`, g.`id`, t.`position` FROM `__genre_tag` t
JOIN `genre` g ON g.`name` = t.`name` COLLATE NOCASE
WHERE t.`owner` = 'band' ORDER BY t.`seq`;
--> statement-breakpoint
DROP TABLE `__genre_tag`;
