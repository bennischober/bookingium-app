PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_company` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'company' NOT NULL,
	`notes` text,
	`bank_id` integer,
	`vat_id` text DEFAULT '' NOT NULL,
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
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`bank_id`) REFERENCES `bank`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invoice_contact_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "company_kind_check" CHECK("kind" IN ('company', 'media'))
);
--> statement-breakpoint
INSERT INTO `__new_company`("id", "name", "kind", "notes", "bank_id", "vat_id", "tax_number", "commercial_register_no", "register_court", "logo_path", "signature_path", "ksk_number", "is_default_for_invoicing", "address_id", "contact_id", "invoice_contact_person_id", "created_at", "updated_at") SELECT "id", "name", "kind", "notes", "bank_id", "vat_id", "tax_number", "commercial_register_no", "register_court", "logo_path", "signature_path", "ksk_number", "is_default_for_invoicing", "address_id", "contact_id", "invoice_contact_person_id", "created_at", "updated_at" FROM `company`;--> statement-breakpoint
DROP TABLE `company`;--> statement-breakpoint
ALTER TABLE `__new_company` RENAME TO `company`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `company_name_idx` ON `company` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `company_default_for_invoicing_idx` ON `company` (`is_default_for_invoicing`) WHERE "is_default_for_invoicing" = 1;--> statement-breakpoint
CREATE TABLE `__new_company_invoice_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`next_invoice_number` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_company_invoice_settings`("id", "company_id", "next_invoice_number", "created_at", "updated_at") SELECT "id", "company_id", "next_invoice_number", "created_at", "updated_at" FROM `company_invoice_settings`;--> statement-breakpoint
DROP TABLE `company_invoice_settings`;--> statement-breakpoint
ALTER TABLE `__new_company_invoice_settings` RENAME TO `company_invoice_settings`;--> statement-breakpoint
CREATE UNIQUE INDEX `company_invoice_settings_company_unique_idx` ON `company_invoice_settings` (`company_id`);--> statement-breakpoint
CREATE INDEX `company_invoice_settings_next_number_idx` ON `company_invoice_settings` (`next_invoice_number`);--> statement-breakpoint
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
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
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
CREATE INDEX `deal_memo_name_idx` ON `deal_memo` (`name`);--> statement-breakpoint
CREATE INDEX `deal_memo_date_idx` ON `deal_memo` (`date`);--> statement-breakpoint
CREATE INDEX `deal_memo_band_idx` ON `deal_memo` (`band_id`);--> statement-breakpoint
CREATE INDEX `deal_memo_venue_idx` ON `deal_memo` (`venue_id`);--> statement-breakpoint
CREATE INDEX `deal_memo_invoice_company_idx` ON `deal_memo` (`invoice_company_id`);--> statement-breakpoint
CREATE INDEX `deal_memo_status_idx` ON `deal_memo` (`status`);--> statement-breakpoint
CREATE INDEX `deal_memo_archived_idx` ON `deal_memo` (`archived_at`);--> statement-breakpoint
CREATE TABLE `__new_document` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` integer NOT NULL,
	`file_name` text NOT NULL,
	`display_name` text,
	`file_type` text NOT NULL,
	`file_path` text NOT NULL,
	`document_type` text DEFAULT 'other' NOT NULL,
	`file_size` integer NOT NULL,
	`uploaded_at` text DEFAULT (datetime('now')) NOT NULL,
	`uploaded_by` text,
	`source_message_id` text,
	`source_mail_account_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_document`("id", "owner_type", "owner_id", "file_name", "display_name", "file_type", "file_path", "document_type", "file_size", "uploaded_at", "uploaded_by", "source_message_id", "source_mail_account_id", "created_at", "updated_at") SELECT "id", "owner_type", "owner_id", "file_name", "display_name", "file_type", "file_path", "document_type", "file_size", "uploaded_at", "uploaded_by", "source_message_id", "source_mail_account_id", "created_at", "updated_at" FROM `document`;--> statement-breakpoint
DROP TABLE `document`;--> statement-breakpoint
ALTER TABLE `__new_document` RENAME TO `document`;--> statement-breakpoint
CREATE INDEX `document_owner_idx` ON `document` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `document_type_idx` ON `document` (`document_type`);--> statement-breakpoint
CREATE INDEX `document_uploaded_at_idx` ON `document` (`uploaded_at`);--> statement-breakpoint
CREATE TABLE `__new_hotel` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`contact_id` integer,
	`address_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_hotel`("id", "name", "notes", "contact_id", "address_id", "created_at", "updated_at") SELECT "id", "name", "notes", "contact_id", "address_id", "created_at", "updated_at" FROM `hotel`;--> statement-breakpoint
DROP TABLE `hotel`;--> statement-breakpoint
ALTER TABLE `__new_hotel` RENAME TO `hotel`;--> statement-breakpoint
CREATE INDEX `hotel_name_idx` ON `hotel` (`name`);--> statement-breakpoint
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
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
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
CREATE TABLE `__new_itinerary` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`deal_memo_id` integer NOT NULL,
	`get_in` text DEFAULT '' NOT NULL,
	`load_in` text DEFAULT '' NOT NULL,
	`sound_check_main_act` text DEFAULT '' NOT NULL,
	`sound_check_support` text DEFAULT '' NOT NULL,
	`dinner` text DEFAULT '' NOT NULL,
	`doors` text DEFAULT '' NOT NULL,
	`show_time_main_act` text DEFAULT '' NOT NULL,
	`show_time_support` text DEFAULT '' NOT NULL,
	`curfew_stage` text DEFAULT '' NOT NULL,
	`curfew_venue` text DEFAULT '' NOT NULL,
	`show_length` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_itinerary`("id", "notes", "deal_memo_id", "get_in", "load_in", "sound_check_main_act", "sound_check_support", "dinner", "doors", "show_time_main_act", "show_time_support", "curfew_stage", "curfew_venue", "show_length", "created_at", "updated_at") SELECT "id", "notes", "deal_memo_id", "get_in", "load_in", "sound_check_main_act", "sound_check_support", "dinner", "doors", "show_time_main_act", "show_time_support", "curfew_stage", "curfew_venue", "show_length", "created_at", "updated_at" FROM `itinerary`;--> statement-breakpoint
DROP TABLE `itinerary`;--> statement-breakpoint
ALTER TABLE `__new_itinerary` RENAME TO `itinerary`;--> statement-breakpoint
CREATE UNIQUE INDEX `itinerary_deal_memo_idx` ON `itinerary` (`deal_memo_id`);--> statement-breakpoint
CREATE TABLE `__new_management_contract` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`band_id` integer NOT NULL,
	`management_company_id` integer,
	`start_date` text,
	`territory` text DEFAULT 'örtlich unbeschränkt' NOT NULL,
	`term_years` integer DEFAULT 3 NOT NULL,
	`renewal_years` integer DEFAULT 1 NOT NULL,
	`notice_months` integer DEFAULT 6 NOT NULL,
	`commission_percent` real DEFAULT 20 NOT NULL,
	`excluded_income` text DEFAULT 'GVL und GEMA Einnahmen' NOT NULL,
	`statement_email` text DEFAULT '' NOT NULL,
	`settlement_days` integer DEFAULT 30 NOT NULL,
	`payment_days` integer DEFAULT 14 NOT NULL,
	`post_term_year1_percent` real DEFAULT 30 NOT NULL,
	`post_term_year2_percent` real DEFAULT 0 NOT NULL,
	`post_term_year3_percent` real DEFAULT 0 NOT NULL,
	`representative_person_id` integer,
	`special_clauses` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`management_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`representative_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_management_contract`("id", "band_id", "management_company_id", "start_date", "territory", "term_years", "renewal_years", "notice_months", "commission_percent", "excluded_income", "statement_email", "settlement_days", "payment_days", "post_term_year1_percent", "post_term_year2_percent", "post_term_year3_percent", "representative_person_id", "special_clauses", "created_at", "updated_at") SELECT "id", "band_id", "management_company_id", "start_date", "territory", "term_years", "renewal_years", "notice_months", "commission_percent", "excluded_income", "statement_email", "settlement_days", "payment_days", "post_term_year1_percent", "post_term_year2_percent", "post_term_year3_percent", "representative_person_id", "special_clauses", "created_at", "updated_at" FROM `management_contract`;--> statement-breakpoint
DROP TABLE `management_contract`;--> statement-breakpoint
ALTER TABLE `__new_management_contract` RENAME TO `management_contract`;--> statement-breakpoint
CREATE INDEX `management_contract_band_idx` ON `management_contract` (`band_id`);--> statement-breakpoint
CREATE TABLE `__new_person` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`birthday` text,
	`notes` text,
	`contact_id` integer,
	`address_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_person`("id", "first_name", "last_name", "birthday", "notes", "contact_id", "address_id", "created_at", "updated_at") SELECT "id", "first_name", "last_name", "birthday", "notes", "contact_id", "address_id", "created_at", "updated_at" FROM `person`;--> statement-breakpoint
DROP TABLE `person`;--> statement-breakpoint
ALTER TABLE `__new_person` RENAME TO `person`;--> statement-breakpoint
CREATE INDEX `person_name_idx` ON `person` (`first_name`,`last_name`);--> statement-breakpoint
CREATE TABLE `__new_venue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'venue' NOT NULL,
	`capacity` integer,
	`notes` text DEFAULT '' NOT NULL,
	`radius_km` integer,
	`radius_weeks_before` integer,
	`radius_weeks_after` integer,
	`address_id` integer,
	`company_id` integer,
	`contact_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "venue_kind_check" CHECK("kind" IN ('venue', 'festival'))
);
--> statement-breakpoint
INSERT INTO `__new_venue`("id", "name", "kind", "capacity", "notes", "radius_km", "radius_weeks_before", "radius_weeks_after", "address_id", "company_id", "contact_id", "created_at", "updated_at") SELECT "id", "name", "kind", "capacity", "notes", "radius_km", "radius_weeks_before", "radius_weeks_after", "address_id", "company_id", "contact_id", "created_at", "updated_at" FROM `venue`;--> statement-breakpoint
DROP TABLE `venue`;--> statement-breakpoint
ALTER TABLE `__new_venue` RENAME TO `venue`;--> statement-breakpoint
CREATE INDEX `venue_name_idx` ON `venue` (`name`);--> statement-breakpoint
CREATE INDEX `venue_company_idx` ON `venue` (`company_id`);--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` DROP COLUMN `vat_number`;--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` DROP COLUMN `ust_number`;