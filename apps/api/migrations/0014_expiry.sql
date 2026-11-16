CREATE TABLE `devices` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`environment` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `devices_user_idx` ON `devices` (`user_id`);--> statement-breakpoint
CREATE TABLE `expiry_notices` (
	`user_id` text NOT NULL,
	`batch` integer NOT NULL,
	`clips` integer NOT NULL,
	`goes_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`pushed_at` integer,
	`given_at` integer,
	`abandoned_at` integer,
	`reminded_at` integer,
	PRIMARY KEY(`user_id`, `batch`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `expiry_notices_sending_idx` ON `expiry_notices` (`next_attempt_at`) WHERE "expiry_notices"."given_at" is null and "expiry_notices"."abandoned_at" is null;--> statement-breakpoint
CREATE INDEX `expiry_notices_reminder_idx` ON `expiry_notices` (`goes_at`) WHERE "expiry_notices"."given_at" is not null and "expiry_notices"."reminded_at" is null;--> statement-breakpoint
ALTER TABLE `files` ADD `expiry_notice_batch` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `expiry_goes_at` integer;--> statement-breakpoint
CREATE INDEX `files_unnoticed_idx` ON `files` (`owner_id`,`completed_at`) WHERE "files"."status" = 'complete' and "files"."expiry_notice_batch" is null;--> statement-breakpoint
CREATE INDEX `files_notice_idx` ON `files` (`owner_id`,`expiry_notice_batch`) WHERE "files"."expiry_notice_batch" is not null;--> statement-breakpoint
CREATE INDEX `files_goes_idx` ON `files` (`expiry_goes_at`) WHERE "files"."expiry_goes_at" is not null;