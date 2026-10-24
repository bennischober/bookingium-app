-- C2: SQLite treats NULLs as distinct, so the unique constraint from the card
-- cannot be a UNIQUE(...) with nullable columns. A unique index over coalesce()
-- makes re-linking the same mail to the same record a no-op instead of a duplicate.
CREATE UNIQUE INDEX `mail_link_unique_idx` ON `mail_link` (
  `mail_account_id`,
  coalesce(`message_id`, ''),
  coalesce(`fallback_key`, ''),
  `entity_type`,
  `entity_id`
);
--> statement-breakpoint
-- C2: a deleted record takes its mail links with it (same pattern as document).
CREATE TRIGGER `mail_link_person_deleted` AFTER DELETE ON `person` BEGIN
  DELETE FROM `mail_link` WHERE `entity_type` = 'person' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `mail_link_company_deleted` AFTER DELETE ON `company` BEGIN
  DELETE FROM `mail_link` WHERE `entity_type` = 'company' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `mail_link_band_deleted` AFTER DELETE ON `band` BEGIN
  DELETE FROM `mail_link` WHERE `entity_type` = 'band' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `mail_link_venue_deleted` AFTER DELETE ON `venue` BEGIN
  DELETE FROM `mail_link` WHERE `entity_type` = 'venue' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `mail_link_event_deleted` AFTER DELETE ON `deal_memo` BEGIN
  DELETE FROM `mail_link` WHERE `entity_type` = 'event' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `mail_link_invoice_deleted` AFTER DELETE ON `invoice` BEGIN
  DELETE FROM `mail_link` WHERE `entity_type` = 'invoice' AND `entity_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `mail_link_contract_deleted` AFTER DELETE ON `management_contract` BEGIN
  DELETE FROM `mail_link` WHERE `entity_type` = 'contract' AND `entity_id` = OLD.`id`;
END;
