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
ALTER TABLE `files` ADD `expiry_notice_batch` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `expiry_noticed_at` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `expiry_reminded_at` integer;--> statement-breakpoint
CREATE INDEX `files_unnoticed_idx` ON `files` (`owner_id`,`completed_at`) WHERE "files"."status" = 'complete' and "files"."expiry_notice_batch" is null;--> statement-breakpoint
CREATE INDEX `files_noticed_idx` ON `files` (`expiry_notice_batch`,`owner_id`) WHERE "files"."expiry_notice_batch" is not null;