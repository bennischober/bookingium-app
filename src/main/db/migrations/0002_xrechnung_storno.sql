ALTER TABLE `invoice` ADD `xrechnung` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice` ADD `kind` text DEFAULT 'invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice` ADD `cancels_invoice_id` integer REFERENCES invoice(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `invoice_cancels_invoice_idx` ON `invoice` (`cancels_invoice_id`);