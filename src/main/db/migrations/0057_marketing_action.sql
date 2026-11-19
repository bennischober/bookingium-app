CREATE TABLE `marketing_action` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`band_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`deal_memo_id` integer,
	`tour` text DEFAULT '' NOT NULL,
	`release` text DEFAULT '' NOT NULL,
	`company_id` integer,
	`marketing_item_id` integer,
	`start_date` text,
	`end_date` text,
	`region` text DEFAULT '' NOT NULL,
	`cost_cents` integer,
	`payer` text DEFAULT 'us' NOT NULL,
	`receipt_id` integer,
	`invoice_id` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`band_id`) REFERENCES `band`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_memo_id`) REFERENCES `deal_memo`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`marketing_item_id`) REFERENCES `marketing_item`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipt`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "marketing_action_kind_check" CHECK("kind" IN ('radio_spot', 'poster', 'print_ad', 'online_ad', 'interview', 'playlist', 'giveaway', 'other')),
	CONSTRAINT "marketing_action_status_check" CHECK("status" IN ('planned', 'booked', 'running', 'done', 'cancelled')),
	CONSTRAINT "marketing_action_payer_check" CHECK("payer" IN ('us', 'band', 'label', 'promoter', 'other'))
);
--> statement-breakpoint
CREATE INDEX `marketing_action_band_idx` ON `marketing_action` (`band_id`);--> statement-breakpoint
CREATE INDEX `marketing_action_event_idx` ON `marketing_action` (`deal_memo_id`);--> statement-breakpoint
CREATE INDEX `marketing_action_company_idx` ON `marketing_action` (`company_id`);--> statement-breakpoint
CREATE INDEX `marketing_action_item_idx` ON `marketing_action` (`marketing_item_id`);--> statement-breakpoint
CREATE INDEX `marketing_action_receipt_idx` ON `marketing_action` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `marketing_action_invoice_idx` ON `marketing_action` (`invoice_id`);