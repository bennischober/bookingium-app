-- #149: deleting a person, company, venue or hotel left its address and contact rows behind.
-- The repositories now delete them (repositories/companions.ts); this removes the ones left
-- by earlier versions. A row still referenced by any owner stays, shared ones included.
-- contact_email rows of a deleted contact go with it (ON DELETE CASCADE) - but foreign keys
-- are off while migrations run, so they are deleted explicitly first.
DELETE FROM `contact_email` WHERE `contact_id` IN (
  SELECT `id` FROM `contact`
  WHERE `id` NOT IN (SELECT `contact_id` FROM `person` WHERE `contact_id` IS NOT NULL)
    AND `id` NOT IN (SELECT `contact_id` FROM `company` WHERE `contact_id` IS NOT NULL)
    AND `id` NOT IN (SELECT `contact_id` FROM `venue` WHERE `contact_id` IS NOT NULL)
    AND `id` NOT IN (SELECT `contact_id` FROM `hotel` WHERE `contact_id` IS NOT NULL)
);
--> statement-breakpoint
DELETE FROM `contact`
WHERE `id` NOT IN (SELECT `contact_id` FROM `person` WHERE `contact_id` IS NOT NULL)
  AND `id` NOT IN (SELECT `contact_id` FROM `company` WHERE `contact_id` IS NOT NULL)
  AND `id` NOT IN (SELECT `contact_id` FROM `venue` WHERE `contact_id` IS NOT NULL)
  AND `id` NOT IN (SELECT `contact_id` FROM `hotel` WHERE `contact_id` IS NOT NULL);
--> statement-breakpoint
DELETE FROM `address`
WHERE `id` NOT IN (SELECT `address_id` FROM `person` WHERE `address_id` IS NOT NULL)
  AND `id` NOT IN (SELECT `address_id` FROM `company` WHERE `address_id` IS NOT NULL)
  AND `id` NOT IN (SELECT `address_id` FROM `venue` WHERE `address_id` IS NOT NULL)
  AND `id` NOT IN (SELECT `address_id` FROM `hotel` WHERE `address_id` IS NOT NULL);
