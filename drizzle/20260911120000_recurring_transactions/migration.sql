CREATE TABLE `recurring_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`category_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`payment_mode` text,
	`title` text NOT NULL,
	`note` text,
	`start_date` text NOT NULL,
	`frequency` text NOT NULL,
	`interval_count` integer NOT NULL,
	`end_date` text,
	`is_paused` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sync_id` text,
	`deleted_at` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "valid_recurring_type" CHECK(`type` IN ('expense', 'income')),
	CONSTRAINT "recurring_amount_positive" CHECK(`amount_minor` > 0),
	CONSTRAINT "valid_recurring_frequency" CHECK(`frequency` IN ('daily', 'weekly', 'monthly', 'yearly')),
	CONSTRAINT "valid_recurring_interval" CHECK(`interval_count` BETWEEN 1 AND 999),
	CONSTRAINT "valid_recurring_start_date" CHECK(`start_date` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "valid_recurring_end_date" CHECK(`end_date` IS NULL OR (`end_date` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND `end_date` >= `start_date`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_recurring_templates_sync_id` ON `recurring_templates` (`sync_id`);
--> statement-breakpoint
CREATE TABLE `recurring_occurrences` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`template_id` integer NOT NULL,
	`occurrence_date` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sync_id` text,
	`deleted_at` integer,
	FOREIGN KEY (`template_id`) REFERENCES `recurring_templates`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "valid_recurring_occurrence_status" CHECK(`status` IN ('generated', 'skipped')),
	CONSTRAINT "valid_recurring_occurrence_date" CHECK(`occurrence_date` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_recurring_occurrences_sync_id` ON `recurring_occurrences` (`sync_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_recurring_occurrence_template_date` ON `recurring_occurrences` (`template_id`,`occurrence_date`);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `recurring_occurrence_id` integer REFERENCES recurring_occurrences(id);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tx_recurring_occurrence` ON `transactions` (`recurring_occurrence_id`);
