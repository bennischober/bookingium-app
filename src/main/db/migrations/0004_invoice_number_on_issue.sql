PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
INSERT INTO `__new_invoice`("id", "invoice_number", "company_id", "issuer_snapshot_id", "recipient_snapshot_id", "deal_memo_id", "period_start_date", "period_end_date", "period_label", "issue_date", "due_date", "status", "currency", "subtotal_net_amount", "subtotal_tax_amount", "total_gross_amount", "total_amount", "payment_terms", "reverse_charge_note", "notes", "created_at", "updated_at") SELECT "id", "invoice_number", "company_id", "issuer_snapshot_id", "recipient_snapshot_id", "deal_memo_id", "period_start_date", "period_end_date", "period_label", "issue_date", "due_date", "status", "currency", "subtotal_net_amount", "subtotal_tax_amount", "total_gross_amount", "total_amount", "payment_terms", "reverse_charge_note", "notes", "created_at", "updated_at" FROM `invoice`;--> statement-breakpoint
DROP TABLE `invoice`;--> statement-breakpoint
ALTER TABLE `__new_invoice` RENAME TO `invoice`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `invoice_company_idx` ON `invoice` (`company_id`);--> statement-breakpoint
CREATE INDEX `invoice_recipient_snapshot_idx` ON `invoice` (`recipient_snapshot_id`);--> statement-breakpoint
CREATE INDEX `invoice_deal_memo_idx` ON `invoice` (`deal_memo_id`);--> statement-breakpoint
CREATE INDEX `invoice_status_idx` ON `invoice` (`status`);--> statement-breakpoint
CREATE INDEX `invoice_issue_date_idx` ON `invoice` (`issue_date`);--> statement-breakpoint
CREATE INDEX `invoice_period_start_idx` ON `invoice` (`period_start_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_company_invoice_number_unique_idx` ON `invoice` (`company_id`,`invoice_number`);