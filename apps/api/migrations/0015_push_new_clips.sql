ALTER TABLE `live_activities` ADD `pushed_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `push_new_clips` integer DEFAULT true NOT NULL;