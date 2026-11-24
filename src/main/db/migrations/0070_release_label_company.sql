-- #289: a release's label as a company. drizzle-kit drops ON DELETE on ADD COLUMN, so it is
-- written here by hand: deleting the company keeps the release and its printed label.
ALTER TABLE `release` ADD `label_company_id` integer REFERENCES company(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `release_label_company_idx` ON `release` (`label_company_id`);
