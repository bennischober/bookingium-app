ALTER TABLE `mail_template` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `mail_template` ADD `lang` text;--> statement-breakpoint
CREATE UNIQUE INDEX `mail_template_kind_lang_idx` ON `mail_template` (`kind`,`lang`);--> statement-breakpoint
INSERT INTO `mail_template` (`name`, `subject`, `body`, `kind`, `lang`) SELECT '', json_extract(`value`, '$.subject'), json_extract(`value`, '$.body'), 'invoice', 'de' FROM `app_setting` WHERE `key` = 'invoiceEmailDe' AND json_valid(`value`) AND json_type(`value`, '$.subject') = 'text' AND json_type(`value`, '$.body') = 'text';
--> statement-breakpoint
INSERT INTO `mail_template` (`name`, `subject`, `body`, `kind`, `lang`) SELECT '', json_extract(`value`, '$.subject'), json_extract(`value`, '$.body'), 'invoice', 'en' FROM `app_setting` WHERE `key` = 'invoiceEmailEn' AND json_valid(`value`) AND json_type(`value`, '$.subject') = 'text' AND json_type(`value`, '$.body') = 'text';
--> statement-breakpoint
INSERT INTO `mail_template` (`name`, `subject`, `body`, `kind`, `lang`) SELECT '', json_extract(`value`, '$.subject'), json_extract(`value`, '$.body'), 'reminder', 'de' FROM `app_setting` WHERE `key` = 'reminderEmailDe' AND json_valid(`value`) AND json_type(`value`, '$.subject') = 'text' AND json_type(`value`, '$.body') = 'text';
--> statement-breakpoint
INSERT INTO `mail_template` (`name`, `subject`, `body`, `kind`, `lang`) SELECT '', json_extract(`value`, '$.subject'), json_extract(`value`, '$.body'), 'reminder', 'en' FROM `app_setting` WHERE `key` = 'reminderEmailEn' AND json_valid(`value`) AND json_type(`value`, '$.subject') = 'text' AND json_type(`value`, '$.body') = 'text';
--> statement-breakpoint
INSERT INTO `mail_template` (`name`, `subject`, `body`, `kind`, `lang`) SELECT '', json_extract(`value`, '$.subject'), json_extract(`value`, '$.body'), 'dunning', 'de' FROM `app_setting` WHERE `key` = 'dunningEmailDe' AND json_valid(`value`) AND json_type(`value`, '$.subject') = 'text' AND json_type(`value`, '$.body') = 'text';
--> statement-breakpoint
INSERT INTO `mail_template` (`name`, `subject`, `body`, `kind`, `lang`) SELECT '', json_extract(`value`, '$.subject'), json_extract(`value`, '$.body'), 'dunning', 'en' FROM `app_setting` WHERE `key` = 'dunningEmailEn' AND json_valid(`value`) AND json_type(`value`, '$.subject') = 'text' AND json_type(`value`, '$.body') = 'text';
--> statement-breakpoint
INSERT INTO `mail_template` (`name`, `subject`, `body`, `kind`, `lang`) SELECT '', json_extract(`value`, '$.subject'), json_extract(`value`, '$.body'), 'contract', 'de' FROM `app_setting` WHERE `key` = 'contractEmailDe' AND json_valid(`value`) AND json_type(`value`, '$.subject') = 'text' AND json_type(`value`, '$.body') = 'text';
--> statement-breakpoint
INSERT INTO `mail_template` (`name`, `subject`, `body`, `kind`, `lang`) SELECT '', json_extract(`value`, '$.subject'), json_extract(`value`, '$.body'), 'contract', 'en' FROM `app_setting` WHERE `key` = 'contractEmailEn' AND json_valid(`value`) AND json_type(`value`, '$.subject') = 'text' AND json_type(`value`, '$.body') = 'text';