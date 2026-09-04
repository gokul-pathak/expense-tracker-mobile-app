CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`opening_balance_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`icon` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "valid_account_type" CHECK(`type` IN ('cash', 'bank', 'wallet', 'credit_card', 'other'))
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`icon` text,
	`system_key` text CONSTRAINT `uq_category_system_key` UNIQUE,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "valid_category_type" CHECK(`type` IN ('income', 'expense'))
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`note` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY,
	`default_currency` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`category_id` integer,
	`source_account_id` integer,
	`destination_account_id` integer,
	`person_id` integer,
	`payment_mode` text,
	`transaction_date` integer NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_transactions_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`),
	CONSTRAINT `fk_transactions_source_account_id_accounts_id_fk` FOREIGN KEY (`source_account_id`) REFERENCES `accounts`(`id`),
	CONSTRAINT `fk_transactions_destination_account_id_accounts_id_fk` FOREIGN KEY (`destination_account_id`) REFERENCES `accounts`(`id`),
	CONSTRAINT `fk_transactions_person_id_people_id_fk` FOREIGN KEY (`person_id`) REFERENCES `people`(`id`),
	CONSTRAINT "valid_transaction_type" CHECK(`type` IN ('income', 'expense', 'transfer', 'lend', 'borrow', 'repayment_received', 'repayment_paid', 'investment', 'investment_return')),
	CONSTRAINT "amount_positive" CHECK(`amount_minor` > 0),
	CONSTRAINT "transfer_different_accounts" CHECK(`source_account_id` IS NULL OR `destination_account_id` IS NULL OR `source_account_id` <> `destination_account_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_tx_transaction_date` ON `transactions` (`transaction_date`);--> statement-breakpoint
CREATE INDEX `idx_tx_type` ON `transactions` (`type`);--> statement-breakpoint
CREATE INDEX `idx_tx_category_id` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_tx_source_account_id` ON `transactions` (`source_account_id`);--> statement-breakpoint
CREATE INDEX `idx_tx_destination_account_id` ON `transactions` (`destination_account_id`);--> statement-breakpoint
CREATE INDEX `idx_tx_person_id` ON `transactions` (`person_id`);