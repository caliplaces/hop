CREATE TABLE `block_keys` (
	`owner_id` text NOT NULL,
	`sender_key` text NOT NULL,
	`block_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `sender_key`),
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `block_keys_block_idx` ON `block_keys` (`block_id`);--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`contributor_user_id` text,
	`label` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contributor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_owner_user_idx` ON `blocks` (`owner_id`,`contributor_user_id`) WHERE "blocks"."contributor_user_id" is not null;--> statement-breakpoint
CREATE INDEX `blocks_owner_created_idx` ON `blocks` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`reporter_id` text,
	`reporter_ip_hash` text,
	`subject_user_id` text,
	`file_id` text,
	`contributor_name` text,
	`sender_key` text,
	`clip_note` text,
	`clip_name` text,
	`email_batch` integer,
	`emailed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reports_created_idx` ON `reports` (`created_at`);--> statement-breakpoint
CREATE INDEX `reports_unemailed_idx` ON `reports` (`created_at`) WHERE "reports"."emailed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `reports_once_idx` ON `reports` (`kind`,`reporter_id`,`file_id`) WHERE "reports"."reporter_id" is not null and "reports"."file_id" is not null;--> statement-breakpoint
CREATE INDEX `reports_page_idx` ON `reports` (`reporter_ip_hash`,`subject_user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `files` ADD `sender_key` text;--> statement-breakpoint
ALTER TABLE `files` ADD `held_until` integer;