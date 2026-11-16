ALTER TABLE `users` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_key` text;--> statement-breakpoint
ALTER TABLE `users` ADD `profile_reviewed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `users_avatar_key_unique` ON `users` (`avatar_key`);