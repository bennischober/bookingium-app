-- Documents belong to any record (owner_type + owner_id) instead of only to
-- events (deal_memo_id). Existing documents become owner_type 'event'.
CREATE TABLE `__new_document` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` integer NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`file_path` text NOT NULL,
	`document_type` text DEFAULT 'other' NOT NULL,
	`file_size` integer NOT NULL,
	`uploaded_at` text DEFAULT (datetime('now')) NOT NULL,
	`uploaded_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
INSERT INTO `__new_document`("id", "owner_type", "owner_id", "file_name", "file_type", "file_path", "document_type", "file_size", "uploaded_at", "uploaded_by", "created_at", "updated_at") SELECT "id", 'event', "deal_memo_id", "file_name", "file_type", "file_path", "document_type", "file_size", "uploaded_at", "uploaded_by", "created_at", "updated_at" FROM `document`;
--> statement-breakpoint
DROP TABLE `document`;
--> statement-breakpoint
ALTER TABLE `__new_document` RENAME TO `document`;
--> statement-breakpoint
CREATE INDEX `document_owner_idx` ON `document` (`owner_type`,`owner_id`);
--> statement-breakpoint
CREATE INDEX `document_type_idx` ON `document` (`document_type`);
--> statement-breakpoint
CREATE INDEX `document_uploaded_at_idx` ON `document` (`uploaded_at`);
--> statement-breakpoint
-- Deleting an owner deletes its document rows (the files are removed by the
-- app); one trigger per owner type
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
