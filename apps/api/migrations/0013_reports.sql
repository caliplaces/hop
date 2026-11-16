CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`contributor_user_id` text,
	`sender_key` text,
	`label` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contributor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_owner_user_idx` ON `blocks` (`owner_id`,`contributor_user_id`) WHERE "blocks"."contributor_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_owner_sender_idx` ON `blocks` (`owner_id`,`sender_key`) WHERE "blocks"."sender_key" is not null;--> statement-breakpoint
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
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subject_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reports_created_idx` ON `reports` (`created_at`);--> statement-breakpoint
ALTER TABLE `files` ADD `sender_key` text;