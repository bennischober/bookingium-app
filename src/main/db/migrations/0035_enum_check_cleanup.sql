-- #151: the next migration adds CHECK constraints and unique indexes; rows that would break
-- them are repaired here first, or the rebuild would stop the app from starting.
-- An event without a status (the old column default was '') counts as pending, which is
-- what every event created through the app starts as.
UPDATE `deal_memo` SET `status` = 'pending'
WHERE `status` NOT IN ('pending', 'confirmed', 'cancelled');
--> statement-breakpoint
-- A person linked to a venue twice keeps the first link
DELETE FROM `venue_member`
WHERE `id` NOT IN (SELECT MIN(`id`) FROM `venue_member` GROUP BY `venue_id`, `person_id`);
--> statement-breakpoint
-- Only one company issues invoices by default: the oldest of the marked ones, the one
-- `LIMIT 1` without an order picked so far
UPDATE `company` SET `is_default_for_invoicing` = 0
WHERE `is_default_for_invoicing` = 1
  AND `id` <> (SELECT MIN(`id`) FROM `company` WHERE `is_default_for_invoicing` = 1);
--> statement-breakpoint
-- The kinds below were always validated on input; a stray value falls back to the default
UPDATE `company` SET `kind` = 'company' WHERE `kind` NOT IN ('company', 'media');
--> statement-breakpoint
UPDATE `venue` SET `kind` = 'venue' WHERE `kind` NOT IN ('venue', 'festival');
--> statement-breakpoint
UPDATE `invoice_line_item` SET `position` = 1 WHERE `position` < 1;
