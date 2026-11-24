-- #289: a measure names the release it is for. drizzle-kit drops ON DELETE on ADD COLUMN, so it
-- is written here by hand: deleting a release keeps its measures (their text field stays).
ALTER TABLE `marketing_action` ADD `release_id` integer REFERENCES release(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `marketing_action_release_idx` ON `marketing_action` (`release_id`);
