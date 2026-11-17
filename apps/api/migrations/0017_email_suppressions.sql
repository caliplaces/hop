CREATE TABLE `email_suppressions` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `expiry_notices` ADD `email_id` text;--> statement-breakpoint
CREATE INDEX `expiry_notices_email_idx` ON `expiry_notices` (`email_id`) WHERE "expiry_notices"."email_id" is not null;