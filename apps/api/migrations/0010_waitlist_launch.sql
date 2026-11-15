ALTER TABLE `waitlist` ADD `launch_first_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `launch_attempted_at` integer;--> statement-breakpoint
ALTER TABLE `waitlist` ADD `launch_attempts` integer DEFAULT 0 NOT NULL;