ALTER TABLE `files` ADD `notify_batch` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `notified_at` integer;--> statement-breakpoint
CREATE INDEX `files_unnotified_idx` ON `files` (`owner_id`,`completed_at`) WHERE "files"."status" = 'complete' and "files"."notified_at" is null;--> statement-breakpoint
ALTER TABLE `users` ADD `email_new_clips` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- Clips that arrived before the digest existed count as announced, so the first
-- run doesn't email every athlete about their whole inbox.
UPDATE `files` SET `notified_at` = coalesce(`completed_at`, `created_at`) WHERE `status` = 'complete';
