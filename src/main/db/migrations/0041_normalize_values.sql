-- #153, data before the next migration rebuilds the tables.
--
-- 1. One VAT id field. vat_id takes the first of vat_number and ust_number that is a VAT
--    id with a country prefix (the test of einvoice/codes.ts vatIdOf: spaces, dots and
--    dashes ignored, two letters, 2-13 more characters), else vat_number as it was. The
--    other value is a tax number when it is no VAT id, so it fills an empty tax_number;
--    a company keeps what fits nowhere in its notes. The next migration drops both
--    old columns.
CREATE TABLE `__vat` (
  `owner` text NOT NULL,
  `id` integer NOT NULL,
  `vat_id` text NOT NULL,
  `rest` text NOT NULL,
  `rest_is_vat_id` integer NOT NULL,
  PRIMARY KEY (`owner`, `id`)
);
--> statement-breakpoint
INSERT INTO `__vat` (`owner`, `id`, `vat_id`, `rest`, `rest_is_vat_id`)
SELECT `owner`, `id`,
  CASE WHEN `vat_ok` OR NOT `ust_ok` THEN `vat` ELSE `ust` END,
  CASE WHEN `vat_ok` OR NOT `ust_ok` THEN `ust` ELSE `vat` END,
  CASE WHEN `vat_ok` OR NOT `ust_ok` THEN `ust_ok` ELSE `vat_ok` END
FROM (
  SELECT `owner`, `id`, `vat`, `ust`,
    length(`vat_c`) BETWEEN 4 AND 15 AND `vat_c` GLOB '[A-Z][A-Z]*'
      AND substr(`vat_c`, 3) NOT GLOB '*[^0-9A-Z+*]*' AS `vat_ok`,
    length(`ust_c`) BETWEEN 4 AND 15 AND `ust_c` GLOB '[A-Z][A-Z]*'
      AND substr(`ust_c`, 3) NOT GLOB '*[^0-9A-Z+*]*' AS `ust_ok`
  FROM (
    SELECT 'company' AS `owner`, `id`, trim(`vat_number`) AS `vat`, trim(`ust_number`) AS `ust`,
      upper(replace(replace(replace(`vat_number`, ' ', ''), '.', ''), '-', '')) AS `vat_c`,
      upper(replace(replace(replace(`ust_number`, ' ', ''), '.', ''), '-', '')) AS `ust_c`
    FROM `company`
    UNION ALL
    SELECT 'snapshot', `id`, trim(`vat_number`), trim(`ust_number`),
      upper(replace(replace(replace(`vat_number`, ' ', ''), '.', ''), '-', '')),
      upper(replace(replace(replace(`ust_number`, ' ', ''), '.', ''), '-', ''))
    FROM `invoice_party_snapshot`
  )
);
--> statement-breakpoint
UPDATE `company` SET
  `vat_id` = v.`vat_id`,
  `tax_number` = CASE
    WHEN `company`.`tax_number` = '' AND v.`rest` <> '' AND NOT v.`rest_is_vat_id`
      AND v.`rest` <> v.`vat_id` THEN v.`rest`
    ELSE `company`.`tax_number` END,
  `notes` = CASE
    WHEN v.`rest` = '' OR v.`rest` = v.`vat_id` OR v.`rest` = `company`.`tax_number`
      OR (`company`.`tax_number` = '' AND NOT v.`rest_is_vat_id`) THEN `company`.`notes`
    WHEN coalesce(`company`.`notes`, '') = '' THEN 'USt-Nr. (alt): ' || v.`rest`
    ELSE `company`.`notes` || char(10) || 'USt-Nr. (alt): ' || v.`rest` END
FROM `__vat` v
WHERE v.`owner` = 'company' AND v.`id` = `company`.`id`;
--> statement-breakpoint
UPDATE `invoice_party_snapshot` SET
  `vat_id` = v.`vat_id`,
  `tax_number` = CASE
    WHEN `invoice_party_snapshot`.`tax_number` = '' AND v.`rest` <> '' AND NOT v.`rest_is_vat_id`
      AND v.`rest` <> v.`vat_id` THEN v.`rest`
    ELSE `invoice_party_snapshot`.`tax_number` END
FROM `__vat` v
WHERE v.`owner` = 'snapshot' AND v.`id` = `invoice_party_snapshot`.`id`;
--> statement-breakpoint
DROP TABLE `__vat`;
--> statement-breakpoint
-- 2. updated_at becomes NOT NULL with a default in the next migration: rows never
--    updated get their creation time.
UPDATE `person` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `company` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `venue` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `hotel` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `deal_memo` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `company_invoice_settings` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `invoice` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `itinerary` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `document` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `management_contract` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
-- 3. One timestamp format, SQLite's UTC "YYYY-MM-DD HH:MM:SS" (datetime('now')). ISO
--    strings ("…T…Z", written by JavaScript) and plain dates (invoice_status_change rows
--    carried over by an earlier migration) are converted; a fraction stays where
--    datetime('now') with %f wrote one, it sorts the same way.
UPDATE `person` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `person` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `company` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `company` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `band` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `band` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `venue` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `venue` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `genre` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `hotel` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `hotel` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `deal_memo` SET `archived_at` = strftime('%Y-%m-%d %H:%M:%S', `archived_at`) WHERE (`archived_at` GLOB '*T*' OR length(`archived_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `archived_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `deal_memo` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `deal_memo` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `company_invoice_settings` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `company_invoice_settings` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `invoice_party_snapshot` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `invoice` SET `emailed_at` = strftime('%Y-%m-%d %H:%M:%S', `emailed_at`) WHERE (`emailed_at` GLOB '*T*' OR length(`emailed_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `emailed_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `invoice` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `invoice` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `invoice_line_item` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `invoice_email` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `invoice_email_pending` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `invoice_status_change` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `itinerary` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `itinerary` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `document` SET `uploaded_at` = strftime('%Y-%m-%d %H:%M:%S', `uploaded_at`) WHERE (`uploaded_at` GLOB '*T*' OR length(`uploaded_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `uploaded_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `document` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `document` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `mail_link` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `app_setting` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `contact_list` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `contact_list` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `contact_list_member` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `mail_template` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `mail_template` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `mail_rule` SET `active_since` = strftime('%Y-%m-%d %H:%M:%S', `active_since`) WHERE (`active_since` GLOB '*T*' OR length(`active_since`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `active_since`) IS NOT NULL;--> statement-breakpoint
UPDATE `mail_rule` SET `last_applied_at` = strftime('%Y-%m-%d %H:%M:%S', `last_applied_at`) WHERE (`last_applied_at` GLOB '*T*' OR length(`last_applied_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `last_applied_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `mail_rule` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `mail_rule` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `mail_rule_hit` SET `applied_at` = strftime('%Y-%m-%d %H:%M:%S', `applied_at`) WHERE (`applied_at` GLOB '*T*' OR length(`applied_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `applied_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `follow_up` SET `done_at` = strftime('%Y-%m-%d %H:%M:%S', `done_at`) WHERE (`done_at` GLOB '*T*' OR length(`done_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `done_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `follow_up` SET `replied_at` = strftime('%Y-%m-%d %H:%M:%S', `replied_at`) WHERE (`replied_at` GLOB '*T*' OR length(`replied_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `replied_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `follow_up` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `follow_up` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `appointment` SET `reminded_at` = strftime('%Y-%m-%d %H:%M:%S', `reminded_at`) WHERE (`reminded_at` GLOB '*T*' OR length(`reminded_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `reminded_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `appointment` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `appointment` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `management_contract` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `management_contract` SET `updated_at` = strftime('%Y-%m-%d %H:%M:%S', `updated_at`) WHERE (`updated_at` GLOB '*T*' OR length(`updated_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `updated_at`) IS NOT NULL;--> statement-breakpoint
UPDATE `management_share` SET `created_at` = strftime('%Y-%m-%d %H:%M:%S', `created_at`) WHERE (`created_at` GLOB '*T*' OR length(`created_at`) = 10) AND strftime('%Y-%m-%d %H:%M:%S', `created_at`) IS NOT NULL;--> statement-breakpoint
-- 4. The next migration rebuilds document, and SQLite refuses to rename a table that a
--    trigger on another table (band) still names. All owner triggers go here; most would
--    go with their rebuilt table anyway, and 0043 creates every one of them again.
DROP TRIGGER IF EXISTS `document_owner_event_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `document_owner_band_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `document_owner_company_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `document_owner_venue_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `document_owner_person_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `mail_link_person_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `mail_link_company_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `mail_link_band_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `mail_link_venue_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `mail_link_event_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `mail_link_invoice_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `mail_link_contract_deleted`;
