ALTER TABLE `receipt_drafts` ADD `payment_mode` text;
--> statement-breakpoint
ALTER TABLE `receipt_drafts` ADD `finalized_transaction_id` integer;
--> statement-breakpoint
ALTER TABLE `receipt_drafts` ADD `finalized_at` integer;
