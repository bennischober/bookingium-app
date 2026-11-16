ALTER TABLE `band` ADD `customer_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `band_customer_number_idx` ON `band` (`customer_number`);--> statement-breakpoint
ALTER TABLE `company` ADD `customer_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `company_customer_number_idx` ON `company` (`customer_number`);--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `customer_number` integer;--> statement-breakpoint
ALTER TABLE `person` ADD `customer_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `person_customer_number_idx` ON `person` (`customer_number`);