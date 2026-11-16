ALTER TABLE `users` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `users_deleted_idx` ON `users` (`deleted_at`) WHERE "users"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX `files_contributor_idx` ON `files` (`contributor_user_id`) WHERE "files"."contributor_user_id" is not null;