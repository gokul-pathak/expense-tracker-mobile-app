CREATE TABLE `receipt_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`image_uri` text NOT NULL,
	`status` text NOT NULL,
	`failure_reason` text,
	`merchant_name` text,
	`amount_minor` integer,
	`currency` text,
	`transaction_date` text,
	`confidence` text,
	`parser_version` integer,
	`ocr_provider` text,
	`processing_generation` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer,
	CONSTRAINT "valid_receipt_status" CHECK(`status` IN ('captured', 'processing', 'ready_for_review', 'failed')),
	CONSTRAINT "valid_receipt_amount" CHECK(`amount_minor` IS NULL OR `amount_minor` > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_receipt_drafts_status` ON `receipt_drafts` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_receipt_drafts_expires_at` ON `receipt_drafts` (`expires_at`);
