CREATE TABLE `address` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`street` text DEFAULT '' NOT NULL,
	`street_number` text DEFAULT '' NOT NULL,
	`address_suffix` text DEFAULT '',
	`zip_code` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`country_code` text(2) DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `address_city_idx` ON `address` (`city`);--> statement-breakpoint
CREATE INDEX `address_country_idx` ON `address` (`country`);--> statement-breakpoint
CREATE TABLE `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `band` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`genre` text DEFAULT '' NOT NULL,
	`founded` text,
	`notes` text DEFAULT '' NOT NULL,
	`company_id` integer NOT NULL,
	`responsible_person_id` integer,
	`management_company_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsible_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`management_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `band_name_idx` ON `band` (`name`);--> statement-breakpoint
CREATE INDEX `band_company_idx` ON `band` (`company_id`);--> statement-breakpoint
CREATE TABLE `band_member` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`band_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`role` text,
	`notes` text,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `band_member_band_idx` ON `band_member` (`band_id`);--> statement-breakpoint
CREATE INDEX `band_member_person_idx` ON `band_member` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `band_member_unique_idx` ON `band_member` (`band_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `bank` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bank_name` text DEFAULT '' NOT NULL,
	`account_holder` text DEFAULT '' NOT NULL,
	`iban` text(34) DEFAULT '' NOT NULL,
	`bic` text(11) DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bank_iban_idx` ON `bank` (`iban`);--> statement-breakpoint
CREATE TABLE `company` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
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
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`bank_id`) REFERENCES `bank`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `company_name_idx` ON `company` (`name`);--> statement-breakpoint
CREATE TABLE `company_invoice_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`next_invoice_number` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_invoice_settings_company_unique_idx` ON `company_invoice_settings` (`company_id`);--> statement-breakpoint
CREATE INDEX `company_invoice_settings_next_number_idx` ON `company_invoice_settings` (`next_invoice_number`);--> statement-breakpoint
CREATE TABLE `company_member` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`role` text,
	`notes` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `company_member_company_idx` ON `company_member` (`company_id`);--> statement-breakpoint
CREATE INDEX `company_member_person_idx` ON `company_member` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `company_member_unique_idx` ON `company_member` (`company_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `contact` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text,
	`mobile_phone` text,
	`homepage` text
);
--> statement-breakpoint
CREATE INDEX `contact_email_idx` ON `contact` (`email`);--> statement-breakpoint
CREATE TABLE `deal_memo` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`deal` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`ticket_price_vvk` real,
	`ticket_price_ak` real,
	`posters` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`amount_of_people` integer DEFAULT 0,
	`room_information` text DEFAULT '',
	`performance_duration` text DEFAULT '',
	`performance_time` text DEFAULT '',
	`performance_information` text DEFAULT '',
	`guarantee_amount` real,
	`guarantee_vat_rate` real,
	`contract_notes` text DEFAULT '',
	`lopro_person_id` integer,
	`lopro_company_id` integer,
	`invoice_company_id` integer,
	`representing_company_id` integer,
	`band_id` integer NOT NULL,
	`venue_id` integer,
	`hotel_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`lopro_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lopro_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invoice_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`representing_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`hotel_id`) REFERENCES `hotel`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deal_memo_name_idx` ON `deal_memo` (`name`);--> statement-breakpoint
CREATE INDEX `deal_memo_date_idx` ON `deal_memo` (`date`);--> statement-breakpoint
CREATE INDEX `deal_memo_band_idx` ON `deal_memo` (`band_id`);--> statement-breakpoint
CREATE INDEX `deal_memo_venue_idx` ON `deal_memo` (`venue_id`);--> statement-breakpoint
CREATE INDEX `deal_memo_invoice_company_idx` ON `deal_memo` (`invoice_company_id`);--> statement-breakpoint
CREATE INDEX `deal_memo_status_idx` ON `deal_memo` (`status`);--> statement-breakpoint
CREATE TABLE `document` (
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
CREATE INDEX `document_owner_idx` ON `document` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `document_type_idx` ON `document` (`document_type`);--> statement-breakpoint
CREATE INDEX `document_uploaded_at_idx` ON `document` (`uploaded_at`);--> statement-breakpoint
CREATE TABLE `hotel` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`contact_id` integer,
	`address_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `hotel_name_idx` ON `hotel` (`name`);--> statement-breakpoint
CREATE TABLE `invoice` (
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
	`subtotal_net_amount` real DEFAULT 0 NOT NULL,
	`subtotal_tax_amount` real DEFAULT 0 NOT NULL,
	`total_gross_amount` real DEFAULT 0 NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`payment_terms` text DEFAULT '' NOT NULL,
	`reverse_charge_note` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issuer_snapshot_id`) REFERENCES `invoice_party_snapshot`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipient_snapshot_id`) REFERENCES `invoice_party_snapshot`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `invoice_company_idx` ON `invoice` (`company_id`);--> statement-breakpoint
CREATE INDEX `invoice_recipient_snapshot_idx` ON `invoice` (`recipient_snapshot_id`);--> statement-breakpoint
CREATE INDEX `invoice_deal_memo_idx` ON `invoice` (`deal_memo_id`);--> statement-breakpoint
CREATE INDEX `invoice_status_idx` ON `invoice` (`status`);--> statement-breakpoint
CREATE INDEX `invoice_issue_date_idx` ON `invoice` (`issue_date`);--> statement-breakpoint
CREATE INDEX `invoice_period_start_idx` ON `invoice` (`period_start_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_company_invoice_number_unique_idx` ON `invoice` (`company_id`,`invoice_number`);--> statement-breakpoint
CREATE TABLE `invoice_line_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`position` integer DEFAULT 1 NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'service' NOT NULL,
	`unit_price_net` real DEFAULT 0 NOT NULL,
	`line_net_amount` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`tax_code` text DEFAULT 'standard' NOT NULL,
	`line_tax_amount` real DEFAULT 0 NOT NULL,
	`line_gross_amount` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_line_item_invoice_idx` ON `invoice_line_item` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_line_item_position_idx` ON `invoice_line_item` (`invoice_id`,`position`);--> statement-breakpoint
CREATE TABLE `invoice_party_snapshot` (
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
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`source_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `invoice_party_snapshot_kind_idx` ON `invoice_party_snapshot` (`kind`);--> statement-breakpoint
CREATE INDEX `invoice_party_snapshot_legal_name_idx` ON `invoice_party_snapshot` (`legal_name`);--> statement-breakpoint
CREATE TABLE `itinerary` (
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
	`updated_at` text,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `itinerary_deal_memo_idx` ON `itinerary` (`deal_memo_id`);--> statement-breakpoint
CREATE TABLE `management_contract` (
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
	`updated_at` text,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`management_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`representative_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `management_contract_band_idx` ON `management_contract` (`band_id`);--> statement-breakpoint
CREATE TABLE `management_contract_member` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contract_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `management_contract`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `management_contract_member_unique_idx` ON `management_contract_member` (`contract_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `management_share` (
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
	FOREIGN KEY (`management_contract_id`) REFERENCES `management_contract`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `management_share_invoice_unique_idx` ON `management_share` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `management_share_band_period_idx` ON `management_share` (`band_id`,`year`,`quarter`);--> statement-breakpoint
CREATE TABLE `management_share_income` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`share_id` integer NOT NULL,
	`position` integer NOT NULL,
	`description` text NOT NULL,
	`net_amount` real NOT NULL,
	FOREIGN KEY (`share_id`) REFERENCES `management_share`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `management_share_income_share_idx` ON `management_share_income` (`share_id`);--> statement-breakpoint
CREATE TABLE `person` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`birthday` text,
	`notes` text,
	`contact_id` integer,
	`address_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `person_name_idx` ON `person` (`first_name`,`last_name`);--> statement-breakpoint
CREATE TABLE `venue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'venue' NOT NULL,
	`capacity` integer,
	`notes` text DEFAULT '' NOT NULL,
	`address_id` integer,
	`company_id` integer,
	`contact_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `venue_name_idx` ON `venue` (`name`);--> statement-breakpoint
CREATE INDEX `venue_company_idx` ON `venue` (`company_id`);--> statement-breakpoint
CREATE TABLE `venue_member` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venue_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`role` text,
	`notes` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `venue_member_venue_idx` ON `venue_member` (`venue_id`);--> statement-breakpoint
CREATE INDEX `venue_member_person_idx` ON `venue_member` (`person_id`);
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
