CREATE TABLE `receipt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer,
	`category` text DEFAULT 'incoming' NOT NULL,
	`receipt_date` text,
	`amount_cents` integer,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`supplier_company_id` integer,
	`supplier_name` text DEFAULT '' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`file_name` text NOT NULL,
	`file_path` text NOT NULL,
	`file_size` integer NOT NULL,
	`source_message_id` text,
	`source_mail_account_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`supplier_company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "receipt_category_check" CHECK("category" IN ('outgoing', 'incoming', 'cash', 'other', 'credit_card'))
);
--> statement-breakpoint
CREATE INDEX `receipt_company_idx` ON `receipt` (`company_id`);--> statement-breakpoint
CREATE INDEX `receipt_date_idx` ON `receipt` (`receipt_date`);--> statement-breakpoint
CREATE INDEX `receipt_supplier_idx` ON `receipt` (`supplier_company_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_datev_transfer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer,
	`receipt_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`category` text DEFAULT 'outgoing' NOT NULL,
	`to` text NOT NULL,
	`file_name` text NOT NULL,
	`mail_account_id` text NOT NULL,
	`send_key` text NOT NULL,
	`message_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipt`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "datev_transfer_document_check" CHECK(("invoice_id" IS NULL) <> ("receipt_id" IS NULL)),
	CONSTRAINT "datev_transfer_status_check" CHECK("status" IN ('pending', 'sent')),
	CONSTRAINT "datev_transfer_category_check" CHECK("category" IN ('outgoing', 'incoming', 'cash', 'other', 'credit_card'))
);
--> statement-breakpoint
INSERT INTO `__new_datev_transfer`("id", "invoice_id", "status", "category", "to", "file_name", "mail_account_id", "send_key", "message_id", "created_at", "sent_at") SELECT "id", "invoice_id", "status", "category", "to", "file_name", "mail_account_id", "send_key", "message_id", "created_at", "sent_at" FROM `datev_transfer`;--> statement-breakpoint
DROP TABLE `datev_transfer`;--> statement-breakpoint
ALTER TABLE `__new_datev_transfer` RENAME TO `datev_transfer`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `datev_transfer_invoice_idx` ON `datev_transfer` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `datev_transfer_receipt_idx` ON `datev_transfer` (`receipt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `datev_transfer_send_key_idx` ON `datev_transfer` (`send_key`);