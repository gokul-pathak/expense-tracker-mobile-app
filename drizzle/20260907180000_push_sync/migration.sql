ALTER TABLE `sync_outbox` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_outbox` ADD `last_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `last_successful_push_at` integer;
