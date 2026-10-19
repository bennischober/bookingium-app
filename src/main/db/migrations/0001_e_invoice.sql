ALTER TABLE `company` ADD `invoice_contact_person_id` integer REFERENCES person(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `invoice` ADD `buyer_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `contact_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `contact_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_party_snapshot` ADD `contact_email` text DEFAULT '' NOT NULL;