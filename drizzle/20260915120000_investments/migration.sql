CREATE TABLE `investment_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`symbol` text,
	`asset_type` text NOT NULL,
	`currency` text NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sync_id` text,
	`deleted_at` integer,
	CONSTRAINT "valid_investment_asset_type" CHECK(`asset_type` IN ('stock', 'mutual_fund', 'etf', 'bond', 'crypto', 'fixed_deposit', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_investment_assets_sync_id` ON `investment_assets` (`sync_id`);
--> statement-breakpoint
CREATE TABLE `investment_trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`asset_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`trade_type` text NOT NULL,
	`trade_date` integer NOT NULL,
	`quantity_minor` integer,
	`unit_price_minor` integer,
	`fee_minor` integer DEFAULT 0 NOT NULL,
	`amount_minor` integer,
	`currency` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sync_id` text,
	`deleted_at` integer,
	FOREIGN KEY (`asset_id`) REFERENCES `investment_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "valid_investment_trade_type" CHECK(`trade_type` IN ('buy', 'sell', 'dividend', 'fee')),
	CONSTRAINT "investment_trade_shape" CHECK((`trade_type` IN ('buy', 'sell') AND `quantity_minor` > 0 AND `unit_price_minor` > 0 AND `fee_minor` >= 0 AND `amount_minor` IS NULL) OR (`trade_type` IN ('dividend', 'fee') AND `quantity_minor` IS NULL AND `unit_price_minor` IS NULL AND `fee_minor` = 0 AND `amount_minor` > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_investment_trades_sync_id` ON `investment_trades` (`sync_id`);
--> statement-breakpoint
CREATE INDEX `idx_investment_trades_asset_order` ON `investment_trades` (`asset_id`,`trade_date`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_investment_trades_account` ON `investment_trades` (`account_id`);
--> statement-breakpoint
CREATE TABLE `investment_prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`asset_id` integer NOT NULL,
	`price_minor` integer NOT NULL,
	`price_date` text NOT NULL,
	`currency` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sync_id` text,
	`deleted_at` integer,
	FOREIGN KEY (`asset_id`) REFERENCES `investment_assets`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "investment_price_positive" CHECK(`price_minor` > 0),
	CONSTRAINT "valid_investment_price_date" CHECK(`price_date` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_investment_prices_sync_id` ON `investment_prices` (`sync_id`);
--> statement-breakpoint
CREATE INDEX `idx_investment_prices_asset_date` ON `investment_prices` (`asset_id`,`price_date`);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `investment_trade_id` integer REFERENCES investment_trades(id);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tx_investment_trade` ON `transactions` (`investment_trade_id`);
