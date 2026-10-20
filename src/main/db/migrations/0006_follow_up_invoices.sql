ALTER TABLE `follow_up` ADD `invoice_id` integer REFERENCES invoice(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `follow_up_invoice_idx` ON `follow_up` (`invoice_id`);