-- #151: the CHECK constraints rebuilt company, venue, deal_memo and invoice, and dropping a
-- table drops its triggers. These are the ones from 0000_initial and 0011, unchanged;
-- tests/migrations.test.ts pins the full trigger list.
CREATE TRIGGER `document_owner_event_deleted` AFTER DELETE ON `deal_memo` BEGIN
	DELETE FROM `document` WHERE `owner_type` = 'event' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_owner_company_deleted` AFTER DELETE ON `company` BEGIN
	DELETE FROM `document` WHERE `owner_type` = 'company' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_owner_venue_deleted` AFTER DELETE ON `venue` BEGIN
	DELETE FROM `document` WHERE `owner_type` = 'venue' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `mail_link_company_deleted` AFTER DELETE ON `company` BEGIN
  DELETE FROM `mail_link` WHERE `entity_type` = 'company' AND `entity_id` = OLD.`id`;
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
