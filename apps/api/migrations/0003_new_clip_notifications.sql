ALTER TABLE `files` ADD `notify_batch` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `notify_attempted_at` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `notified_at` integer;--> statement-breakpoint
CREATE INDEX `files_unannounced_idx` ON `files` (`owner_id`,`notify_batch`,`completed_at`) WHERE "files"."completed_at" is not null and "files"."notified_at" is null;--> statement-breakpoint
ALTER TABLE `users` ADD `email_new_clips` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- Uploads that finished before the digest existed count as announced, so the
-- first run doesn't email every athlete about their whole inbox.
UPDATE `files` SET `notified_at` = coalesce(`completed_at`, `created_at`) WHERE `completed_at` IS NOT NULL OR `status` = 'complete';
