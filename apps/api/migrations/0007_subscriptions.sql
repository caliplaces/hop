CREATE TABLE `subscriptions` (
	`original_transaction_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`environment` text NOT NULL,
	`expires_at` integer NOT NULL,
	`grace_expires_at` integer,
	`revoked_at` integer,
	`auto_renew` integer DEFAULT true NOT NULL,
	`purchased_at` integer NOT NULL,
	`signed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subscriptions_user_idx` ON `subscriptions` (`user_id`,`expires_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `app_account_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_app_account_token_unique` ON `users` (`app_account_token`);