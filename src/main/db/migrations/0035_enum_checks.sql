PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deal_memo` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`deal` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`ticket_price_vvk_cents` integer,
	`ticket_price_ak_cents` integer,
	`posters` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`amount_of_people` integer DEFAULT 0,
	`room_information` text DEFAULT '',
	`performance_duration` text DEFAULT '',
	`performance_time` text DEFAULT '',
	`performance_information` text DEFAULT '',
	`guarantee_cents` integer,
	`guarantee_vat_rate` real,
	`contract_notes` text DEFAULT '',
	`radius_km` integer,
	`radius_weeks_before` integer,
	`radius_weeks_after` integer,
	`lopro_person_id` integer,
	`lopro_company_id` integer,
	`invoice_company_id` integer,
	`representing_company_id` integer,
	`band_id` integer NOT NULL,
	`venue_id` integer,
	`hotel_id` integer,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`lopro_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lopro_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invoice_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`representing_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`hotel_id`) REFERENCES `hotel`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "deal_memo_status_check" CHECK("status" IN ('pending', 'confirmed', 'cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_deal_memo`("id", "name", "deal", "date", "ticket_price_vvk_cents", "ticket_price_ak_cents", "posters", "status", "notes", "amount_of_people", "room_information", "performance_duration", "performance_time", "performance_information", "guarantee_cents", "guarantee_vat_rate", "contract_notes", "radius_km", "radius_weeks_before", "radius_weeks_after", "lopro_person_id", "lopro_company_id", "invoice_company_id", "representing_company_id", "band_id", "venue_id", "hotel_id", "archived_at", "created_at", "updated_at") SELECT "id", "name", "deal", "date", "ticket_price_vvk_cents", "ticket_price_ak_cents", "posters", "status", "notes", "amount_of_people", "room_information", "performance_duration", "performance_time", "performance_information", "guarantee_cents", "guarantee_vat_rate", "contract_notes", "radius_km", "radius_weeks_before", "radius_weeks_after", "lopro_person_id", "lopro_company_id", "invoice_company_id", "representing_company_id", "band_id", "venue_id", "hotel_id", "archived_at", "created_at", "updated_at" FROM `deal_memo`;--> statement-breakpoint
DROP TABLE `deal_memo`;--> statement-breakpoint
ALTER TABLE `__new_deal_memo` RENAME TO `deal_memo`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `deal_memo_name_idx` ON `deal_memo` (`name`);--> statement-breakpoint
CREATE INDEX `deal_memo_date_idx` ON `deal_memo` (`date`);--> statement-breakpoint
CREATE INDEX `deal_memo_band_idx` ON `deal_memo` (`band_id`);--> statement-breakpoint
CREATE INDEX `deal_memo_venue_idx` ON `deal_memo` (`venue_id`);--> statement-breakpoint
CREATE INDEX `deal_memo_invoice_company_idx` ON `deal_memo` (`invoice_company_id`);--> statement-breakpoint
CREATE INDEX `deal_memo_status_idx` ON `deal_memo` (`status`);--> statement-breakpoint
CREATE INDEX `deal_memo_archived_idx` ON `deal_memo` (`archived_at`);--> statement-breakpoint
CREATE TABLE `__new_company` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'company' NOT NULL,
	`genres` text DEFAULT '' NOT NULL,
	`notes` text,
	`bank_id` integer,
	`vat_number` text DEFAULT '' NOT NULL,
	`ust_number` text DEFAULT '' NOT NULL,
	`tax_number` text DEFAULT '' NOT NULL,
	`commercial_register_no` text DEFAULT '' NOT NULL,
	`register_court` text DEFAULT '' NOT NULL,
	`logo_path` text DEFAULT '' NOT NULL,
	`signature_path` text DEFAULT '' NOT NULL,
	`ksk_number` text DEFAULT '' NOT NULL,
	`is_default_for_invoicing` integer DEFAULT false NOT NULL,
	`address_id` integer,
	`contact_id` integer,
	`invoice_contact_person_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`bank_id`) REFERENCES `bank`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invoice_contact_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "company_kind_check" CHECK("kind" IN ('company', 'media'))
);
--> statement-breakpoint
INSERT INTO `__new_company`("id", "name", "kind", "genres", "notes", "bank_id", "vat_number", "ust_number", "tax_number", "commercial_register_no", "register_court", "logo_path", "signature_path", "ksk_number", "is_default_for_invoicing", "address_id", "contact_id", "invoice_contact_person_id", "created_at", "updated_at") SELECT "id", "name", "kind", "genres", "notes", "bank_id", "vat_number", "ust_number", "tax_number", "commercial_register_no", "register_court", "logo_path", "signature_path", "ksk_number", "is_default_for_invoicing", "address_id", "contact_id", "invoice_contact_person_id", "created_at", "updated_at" FROM `company`;--> statement-breakpoint
DROP TABLE `company`;--> statement-breakpoint
ALTER TABLE `__new_company` RENAME TO `company`;--> statement-breakpoint
CREATE INDEX `company_name_idx` ON `company` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `company_default_for_invoicing_idx` ON `company` (`is_default_for_invoicing`) WHERE "is_default_for_invoicing" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `venue_member_unique_idx` ON `venue_member` (`venue_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `__new_appointment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`start_date` text NOT NULL,
	`start_time` text,
	`end_date` text NOT NULL,
	`end_time` text,
	`place` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`reminder_minutes` integer,
	`reminded_at` text,
	`ical_uid` text,
	`event_id` integer,
	`band_id` integer,
	`venue_id` integer,
	`company_id` integer,
	`person_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointment_one_record" CHECK(("event_id" IS NOT NULL) + ("band_id" IS NOT NULL) + ("venue_id" IS NOT NULL) + ("company_id" IS NOT NULL) + ("person_id" IS NOT NULL) <= 1)
);
--> statement-breakpoint
INSERT INTO `__new_appointment`("id", "title", "start_date", "start_time", "end_date", "end_time", "place", "notes", "reminder_minutes", "reminded_at", "ical_uid", "event_id", "band_id", "venue_id", "company_id", "person_id", "created_at", "updated_at") SELECT "id", "title", "start_date", "start_time", "end_date", "end_time", "place", "notes", "reminder_minutes", "reminded_at", "ical_uid", "event_id", "band_id", "venue_id", "company_id", "person_id", "created_at", "updated_at" FROM `appointment`;--> statement-breakpoint
DROP TABLE `appointment`;--> statement-breakpoint
ALTER TABLE `__new_appointment` RENAME TO `appointment`;--> statement-breakpoint
CREATE INDEX `appointment_start_idx` ON `appointment` (`start_date`);--> statement-breakpoint
CREATE INDEX `appointment_event_idx` ON `appointment` (`event_id`);--> statement-breakpoint
CREATE INDEX `appointment_band_idx` ON `appointment` (`band_id`);--> statement-breakpoint
CREATE INDEX `appointment_venue_idx` ON `appointment` (`venue_id`);--> statement-breakpoint
CREATE INDEX `appointment_company_idx` ON `appointment` (`company_id`);--> statement-breakpoint
CREATE INDEX `appointment_person_idx` ON `appointment` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_ical_uid_idx` ON `appointment` (`ical_uid`);--> statement-breakpoint
CREATE TABLE `__new_follow_up` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`due_date` text NOT NULL,
	`note` text NOT NULL,
	`done_at` text,
	`event_id` integer,
	`band_id` integer,
	`venue_id` integer,
	`company_id` integer,
	`person_id` integer,
	`invoice_id` integer,
	`mail_account_id` text,
	`mail_message_id` text,
	`replied_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "follow_up_one_record" CHECK(("event_id" IS NOT NULL) + ("band_id" IS NOT NULL) + ("venue_id" IS NOT NULL) + ("company_id" IS NOT NULL) + ("person_id" IS NOT NULL) + ("invoice_id" IS NOT NULL) <= 1)
);
--> statement-breakpoint
INSERT INTO `__new_follow_up`("id", "due_date", "note", "done_at", "event_id", "band_id", "venue_id", "company_id", "person_id", "invoice_id", "mail_account_id", "mail_message_id", "replied_at", "created_at", "updated_at") SELECT "id", "due_date", "note", "done_at", "event_id", "band_id", "venue_id", "company_id", "person_id", "invoice_id", "mail_account_id", "mail_message_id", "replied_at", "created_at", "updated_at" FROM `follow_up`;--> statement-breakpoint
DROP TABLE `follow_up`;--> statement-breakpoint
ALTER TABLE `__new_follow_up` RENAME TO `follow_up`;--> statement-breakpoint
CREATE INDEX `follow_up_open_idx` ON `follow_up` (`done_at`,`due_date`);--> statement-breakpoint
CREATE INDEX `follow_up_mail_idx` ON `follow_up` (`mail_account_id`,`mail_message_id`);--> statement-breakpoint
CREATE INDEX `follow_up_event_idx` ON `follow_up` (`event_id`);--> statement-breakpoint
CREATE INDEX `follow_up_band_idx` ON `follow_up` (`band_id`);--> statement-breakpoint
CREATE INDEX `follow_up_venue_idx` ON `follow_up` (`venue_id`);--> statement-breakpoint
CREATE INDEX `follow_up_company_idx` ON `follow_up` (`company_id`);--> statement-breakpoint
CREATE INDEX `follow_up_person_idx` ON `follow_up` (`person_id`);--> statement-breakpoint
CREATE INDEX `follow_up_invoice_idx` ON `follow_up` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `__new_invoice` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_number` integer,
	`company_id` integer NOT NULL,
	`issuer_snapshot_id` integer,
	`recipient_snapshot_id` integer,
	`deal_memo_id` integer,
	`period_start_date` text,
	`period_end_date` text,
	`period_label` text DEFAULT '' NOT NULL,
	`issue_date` text DEFAULT (date('now')) NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`subtotal_net_cents` integer DEFAULT 0 NOT NULL,
	`subtotal_tax_cents` integer DEFAULT 0 NOT NULL,
	`total_gross_cents` integer DEFAULT 0 NOT NULL,
	`payment_terms` text DEFAULT '' NOT NULL,
	`reverse_charge_note` text DEFAULT '' NOT NULL,
	`buyer_reference` text DEFAULT '' NOT NULL,
	`xrechnung` integer DEFAULT false NOT NULL,
	`kind` text DEFAULT 'invoice' NOT NULL,
	`cancels_invoice_id` integer,
	`notes` text DEFAULT '' NOT NULL,
	`emailed_at` text,
	`emailed_to` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issuer_snapshot_id`) REFERENCES `invoice_party_snapshot`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipient_snapshot_id`) REFERENCES `invoice_party_snapshot`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancels_invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invoice_status_check" CHECK("status" IN ('draft', 'issued', 'paid', 'overdue', 'cancelled')),
	CONSTRAINT "invoice_kind_check" CHECK("kind" IN ('invoice', 'cancellation'))
);
--> statement-breakpoint
INSERT INTO `__new_invoice`("id", "invoice_number", "company_id", "issuer_snapshot_id", "recipient_snapshot_id", "deal_memo_id", "period_start_date", "period_end_date", "period_label", "issue_date", "due_date", "status", "currency", "subtotal_net_cents", "subtotal_tax_cents", "total_gross_cents", "payment_terms", "reverse_charge_note", "buyer_reference", "xrechnung", "kind", "cancels_invoice_id", "notes", "emailed_at", "emailed_to", "created_at", "updated_at") SELECT "id", "invoice_number", "company_id", "issuer_snapshot_id", "recipient_snapshot_id", "deal_memo_id", "period_start_date", "period_end_date", "period_label", "issue_date", "due_date", "status", "currency", "subtotal_net_cents", "subtotal_tax_cents", "total_gross_cents", "payment_terms", "reverse_charge_note", "buyer_reference", "xrechnung", "kind", "cancels_invoice_id", "notes", "emailed_at", "emailed_to", "created_at", "updated_at" FROM `invoice`;--> statement-breakpoint
DROP TABLE `invoice`;--> statement-breakpoint
ALTER TABLE `__new_invoice` RENAME TO `invoice`;--> statement-breakpoint
CREATE INDEX `invoice_company_idx` ON `invoice` (`company_id`);--> statement-breakpoint
CREATE INDEX `invoice_recipient_snapshot_idx` ON `invoice` (`recipient_snapshot_id`);--> statement-breakpoint
CREATE INDEX `invoice_deal_memo_idx` ON `invoice` (`deal_memo_id`);--> statement-breakpoint
CREATE INDEX `invoice_status_idx` ON `invoice` (`status`);--> statement-breakpoint
CREATE INDEX `invoice_issue_date_idx` ON `invoice` (`issue_date`);--> statement-breakpoint
CREATE INDEX `invoice_period_start_idx` ON `invoice` (`period_start_date`);--> statement-breakpoint
CREATE INDEX `invoice_cancels_invoice_idx` ON `invoice` (`cancels_invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_company_invoice_number_unique_idx` ON `invoice` (`company_id`,`invoice_number`);--> statement-breakpoint
CREATE TABLE `__new_invoice_email` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`kind` text DEFAULT 'invoice' NOT NULL,
	`to` text DEFAULT '' NOT NULL,
	`message_id` text,
	`mail_account_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invoice_email_kind_check" CHECK("kind" IN ('invoice', 'reminder', 'dunning'))
);
--> statement-breakpoint
INSERT INTO `__new_invoice_email`("id", "invoice_id", "kind", "to", "message_id", "mail_account_id", "created_at") SELECT "id", "invoice_id", "kind", "to", "message_id", "mail_account_id", "created_at" FROM `invoice_email`;--> statement-breakpoint
DROP TABLE `invoice_email`;--> statement-breakpoint
ALTER TABLE `__new_invoice_email` RENAME TO `invoice_email`;--> statement-breakpoint
CREATE INDEX `invoice_email_invoice_idx` ON `invoice_email` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `__new_invoice_email_pending` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`kind` text DEFAULT 'invoice' NOT NULL,
	`to` text DEFAULT '' NOT NULL,
	`mail_account_id` text NOT NULL,
	`send_key` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invoice_email_pending_kind_check" CHECK("kind" IN ('invoice', 'reminder', 'dunning'))
);
--> statement-breakpoint
INSERT INTO `__new_invoice_email_pending`("id", "invoice_id", "kind", "to", "mail_account_id", "send_key", "created_at") SELECT "id", "invoice_id", "kind", "to", "mail_account_id", "send_key", "created_at" FROM `invoice_email_pending`;--> statement-breakpoint
DROP TABLE `invoice_email_pending`;--> statement-breakpoint
ALTER TABLE `__new_invoice_email_pending` RENAME TO `invoice_email_pending`;--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_email_pending_send_key_idx` ON `invoice_email_pending` (`send_key`);--> statement-breakpoint
CREATE TABLE `__new_invoice_line_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`position` integer DEFAULT 1 NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'service' NOT NULL,
	`unit_price_net` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_code` text DEFAULT 'standard' NOT NULL,
	`line_net_cents` integer DEFAULT 0 NOT NULL,
	`line_tax_cents` integer DEFAULT 0 NOT NULL,
	`line_gross_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invoice_line_item_position_check" CHECK("position" >= 1),
	CONSTRAINT "invoice_line_item_tax_code_check" CHECK("tax_code" IN ('standard', 'reduced', 'zero_rated', 'reverse_charge', 'exempt', 'intra_community', 'export', 'not_taxable', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_invoice_line_item`("id", "invoice_id", "position", "description", "quantity", "unit", "unit_price_net", "tax_rate", "tax_code", "line_net_cents", "line_tax_cents", "line_gross_cents", "created_at") SELECT "id", "invoice_id", "position", "description", "quantity", "unit", "unit_price_net", "tax_rate", "tax_code", "line_net_cents", "line_tax_cents", "line_gross_cents", "created_at" FROM `invoice_line_item`;--> statement-breakpoint
DROP TABLE `invoice_line_item`;--> statement-breakpoint
ALTER TABLE `__new_invoice_line_item` RENAME TO `invoice_line_item`;--> statement-breakpoint
CREATE INDEX `invoice_line_item_invoice_idx` ON `invoice_line_item` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_line_item_position_idx` ON `invoice_line_item` (`invoice_id`,`position`);--> statement-breakpoint
CREATE TABLE `__new_invoice_party_snapshot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`source_company_id` integer,
	`source_band_id` integer,
	`source_person_id` integer,
	`legal_name` text NOT NULL,
	`street` text DEFAULT '' NOT NULL,
	`street_number` text DEFAULT '' NOT NULL,
	`zip_code` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`country_code` text(2) DEFAULT '' NOT NULL,
	`vat_number` text DEFAULT '' NOT NULL,
	`ust_number` text DEFAULT '' NOT NULL,
	`tax_number` text DEFAULT '' NOT NULL,
	`commercial_register_no` text DEFAULT '' NOT NULL,
	`register_court` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`account_holder` text DEFAULT '' NOT NULL,
	`bank_name` text DEFAULT '' NOT NULL,
	`logo_path` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`iban` text DEFAULT '' NOT NULL,
	`bic` text DEFAULT '' NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`contact_phone` text DEFAULT '' NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`source_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invoice_party_snapshot_kind_check" CHECK("kind" IN ('company', 'band', 'person', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_invoice_party_snapshot`("id", "kind", "source_company_id", "source_band_id", "source_person_id", "legal_name", "street", "street_number", "zip_code", "city", "country", "country_code", "vat_number", "ust_number", "tax_number", "commercial_register_no", "register_court", "website", "account_holder", "bank_name", "logo_path", "email", "phone", "iban", "bic", "contact_name", "contact_phone", "contact_email", "created_at") SELECT "id", "kind", "source_company_id", "source_band_id", "source_person_id", "legal_name", "street", "street_number", "zip_code", "city", "country", "country_code", "vat_number", "ust_number", "tax_number", "commercial_register_no", "register_court", "website", "account_holder", "bank_name", "logo_path", "email", "phone", "iban", "bic", "contact_name", "contact_phone", "contact_email", "created_at" FROM `invoice_party_snapshot`;--> statement-breakpoint
DROP TABLE `invoice_party_snapshot`;--> statement-breakpoint
ALTER TABLE `__new_invoice_party_snapshot` RENAME TO `invoice_party_snapshot`;--> statement-breakpoint
CREATE INDEX `invoice_party_snapshot_kind_idx` ON `invoice_party_snapshot` (`kind`);--> statement-breakpoint
CREATE INDEX `invoice_party_snapshot_legal_name_idx` ON `invoice_party_snapshot` (`legal_name`);--> statement-breakpoint
CREATE TABLE `__new_invoice_status_change` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invoice_status_change_status_check" CHECK("status" IN ('draft', 'issued', 'paid', 'overdue', 'cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_invoice_status_change`("id", "invoice_id", "status", "created_at") SELECT "id", "invoice_id", "status", "created_at" FROM `invoice_status_change`;--> statement-breakpoint
DROP TABLE `invoice_status_change`;--> statement-breakpoint
ALTER TABLE `__new_invoice_status_change` RENAME TO `invoice_status_change`;--> statement-breakpoint
CREATE INDEX `invoice_status_change_invoice_idx` ON `invoice_status_change` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `__new_mail_template` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`kind` text,
	`lang` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "mail_template_kind_check" CHECK("kind" IN ('invoice', 'reminder', 'dunning', 'contract')),
	CONSTRAINT "mail_template_lang_check" CHECK("lang" IN ('de', 'en')),
	CONSTRAINT "mail_template_kind_lang_check" CHECK(("kind" IS NULL) = ("lang" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_mail_template`("id", "name", "subject", "body", "kind", "lang", "created_at", "updated_at") SELECT "id", "name", "subject", "body", "kind", "lang", "created_at", "updated_at" FROM `mail_template`;--> statement-breakpoint
DROP TABLE `mail_template`;--> statement-breakpoint
ALTER TABLE `__new_mail_template` RENAME TO `mail_template`;--> statement-breakpoint
CREATE UNIQUE INDEX `mail_template_kind_lang_idx` ON `mail_template` (`kind`,`lang`);--> statement-breakpoint
CREATE TABLE `__new_management_share` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`band_id` integer NOT NULL,
	`management_contract_id` integer,
	`year` integer NOT NULL,
	`quarter` integer NOT NULL,
	`commission_percent` real NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`management_contract_id`) REFERENCES `management_contract`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "management_share_quarter_check" CHECK("quarter" BETWEEN 1 AND 4)
);
--> statement-breakpoint
INSERT INTO `__new_management_share`("id", "invoice_id", "band_id", "management_contract_id", "year", "quarter", "commission_percent", "created_at") SELECT "id", "invoice_id", "band_id", "management_contract_id", "year", "quarter", "commission_percent", "created_at" FROM `management_share`;--> statement-breakpoint
DROP TABLE `management_share`;--> statement-breakpoint
ALTER TABLE `__new_management_share` RENAME TO `management_share`;--> statement-breakpoint
CREATE UNIQUE INDEX `management_share_invoice_unique_idx` ON `management_share` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `management_share_band_period_idx` ON `management_share` (`band_id`,`year`,`quarter`);--> statement-breakpoint
CREATE TABLE `__new_venue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'venue' NOT NULL,
	`capacity` integer,
	`genres` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`radius_km` integer,
	`radius_weeks_before` integer,
	`radius_weeks_after` integer,
	`address_id` integer,
	`company_id` integer,
	`contact_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "venue_kind_check" CHECK("kind" IN ('venue', 'festival'))
);
--> statement-breakpoint
INSERT INTO `__new_venue`("id", "name", "kind", "capacity", "genres", "notes", "radius_km", "radius_weeks_before", "radius_weeks_after", "address_id", "company_id", "contact_id", "created_at", "updated_at") SELECT "id", "name", "kind", "capacity", "genres", "notes", "radius_km", "radius_weeks_before", "radius_weeks_after", "address_id", "company_id", "contact_id", "created_at", "updated_at" FROM `venue`;--> statement-breakpoint
DROP TABLE `venue`;--> statement-breakpoint
ALTER TABLE `__new_venue` RENAME TO `venue`;--> statement-breakpoint
CREATE INDEX `venue_name_idx` ON `venue` (`name`);--> statement-breakpoint
CREATE INDEX `venue_company_idx` ON `venue` (`company_id`);