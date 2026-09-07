ALTER TABLE `accounts` ADD `sync_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `categories` ADD `sync_id` text;--> statement-breakpoint
ALTER TABLE `categories` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `people` ADD `sync_id` text;--> statement-breakpoint
ALTER TABLE `people` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `sync_id` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `sync_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `deleted_at` integer;--> statement-breakpoint
UPDATE `accounts` SET `sync_id` = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))) WHERE `sync_id` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `sync_id` = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))) WHERE `sync_id` IS NULL;--> statement-breakpoint
UPDATE `people` SET `sync_id` = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))) WHERE `sync_id` IS NULL;--> statement-breakpoint
UPDATE `settings` SET `sync_id` = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))) WHERE `sync_id` IS NULL;--> statement-breakpoint
UPDATE `transactions` SET `sync_id` = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))) WHERE `sync_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_accounts_sync_id` ON `accounts` (`sync_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_categories_sync_id` ON `categories` (`sync_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_people_sync_id` ON `people` (`sync_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_settings_sync_id` ON `settings` (`sync_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_transactions_sync_id` ON `transactions` (`sync_id`);--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`entity_type` text NOT NULL,
	`entity_sync_id` text NOT NULL,
	`operation` text NOT NULL,
	`created_at` integer NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	CONSTRAINT `uq_sync_outbox_entity` UNIQUE(`entity_type`,`entity_sync_id`),
	CONSTRAINT "valid_sync_operation" CHECK(`operation` IN ('upsert', 'delete'))
);
--> statement-breakpoint
CREATE INDEX `idx_sync_outbox_order` ON `sync_outbox` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`singleton_id` integer PRIMARY KEY,
	`linked_user_id` text,
	`pull_cursor` integer,
	`last_successful_sync_at` integer,
	`last_sync_error` text,
	CONSTRAINT "single_sync_state_row" CHECK(`singleton_id` = 1)
);
--> statement-breakpoint
INSERT OR IGNORE INTO `sync_state` (`singleton_id`) VALUES (1);
