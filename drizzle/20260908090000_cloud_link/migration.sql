ALTER TABLE `sync_state` ADD `pending_link_user_id` text;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `reconciliation_required` integer DEFAULT false NOT NULL;
