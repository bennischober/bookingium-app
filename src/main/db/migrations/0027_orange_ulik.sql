ALTER TABLE `appointment` ADD `ical_uid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_ical_uid_idx` ON `appointment` (`ical_uid`);