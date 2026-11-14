-- #153: 0042 dropped the owner triggers so that 0043 could rebuild document and the
-- tables with a nullable updated_at. These are the ones from 0000_initial and 0011,
-- unchanged; tests/migrations.test.ts pins the full trigger list.
CREATE TRIGGER `document_owner_event_deleted` AFTER DELETE ON `deal_memo` BEGIN
	DELETE FROM `document` WHERE `owner_type` = 'event' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `document_owner_band_deleted` AFTER DELETE ON `band` BEGIN
	DELETE FROM `document` WHERE `owner_type` = 'band' AND `owner_id` = OLD.`id`;
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
CREATE TRIGGER `document_owner_person_deleted` AFTER DELETE ON `person` BEGIN
	DELETE FROM `document` WHERE `owner_type` = 'person' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
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
