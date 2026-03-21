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
CREATE TABLE `band` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`genre` text DEFAULT '' NOT NULL,
	`founded` text,
	`notes` text DEFAULT '' NOT NULL,
	`company_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE no action
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
	`lopro_person_id` integer,
	`lopro_company_id` integer,
	`band_id` integer NOT NULL,
	`venue_id` integer,
	`hotel_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`lopro_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lopro_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venue_id`) REFERENCES `venue`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`hotel_id`) REFERENCES `hotel`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deal_memo_name_idx` ON `deal_memo` (`name`);--> statement-breakpoint
CREATE INDEX `deal_memo_date_idx` ON `deal_memo` (`date`);--> statement-breakpoint
CREATE INDEX `deal_memo_band_idx` ON `deal_memo` (`band_id`);--> statement-breakpoint
CREATE INDEX `deal_memo_venue_idx` ON `deal_memo` (`venue_id`);--> statement-breakpoint
CREATE INDEX `deal_memo_status_idx` ON `deal_memo` (`status`);--> statement-breakpoint
CREATE TABLE `document` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_memo_id` integer NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`file_path` text NOT NULL,
	`document_type` text DEFAULT 'other' NOT NULL,
	`file_size` integer NOT NULL,
	`uploaded_at` text DEFAULT (datetime('now')) NOT NULL,
	`uploaded_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_deal_memo_idx` ON `document` (`deal_memo_id`);--> statement-breakpoint
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