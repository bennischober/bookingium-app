ALTER TABLE `follow_up` ADD `mail_account_id` text;--> statement-breakpoint
ALTER TABLE `follow_up` ADD `mail_message_id` text;--> statement-breakpoint
ALTER TABLE `follow_up` ADD `replied_at` text;--> statement-breakpoint
CREATE INDEX `follow_up_mail_idx` ON `follow_up` (`mail_account_id`,`mail_message_id`);