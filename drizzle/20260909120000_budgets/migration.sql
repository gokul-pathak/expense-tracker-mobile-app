CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`category_id` integer,
	`period_month` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sync_id` text,
	`deleted_at` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_amount_positive" CHECK(`amount_minor` > 0),
	CONSTRAINT "valid_budget_period_month" CHECK(`period_month` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(`period_month`, 6, 2) BETWEEN '01' AND '12')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_budgets_sync_id` ON `budgets` (`sync_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_budget_live_period` ON `budgets` (`period_month`,`currency`,coalesce(`category_id`, -1)) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_budget_period_month` ON `budgets` (`period_month`);
--> statement-breakpoint
CREATE INDEX `idx_budget_category_id` ON `budgets` (`category_id`);
