CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"source_event_id" text,
	"user_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"metadata" text,
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	"resolved_by" text,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "auto_heal_log" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"rule_name" text NOT NULL,
	"action_type" text NOT NULL,
	"action_params" text,
	"status" text NOT NULL,
	"error" text,
	"executed_at" timestamp DEFAULT now(),
	"executed_by" text DEFAULT 'system'
);
--> statement-breakpoint
CREATE TABLE "health_check_history" (
	"id" text PRIMARY KEY NOT NULL,
	"score" integer NOT NULL,
	"status" text NOT NULL,
	"checks" text NOT NULL,
	"recommendations" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_alerts_tenant_status" ON "alerts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_alerts_created" ON "alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_auto_heal_log_time" ON "auto_heal_log" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "idx_health_history_time" ON "health_check_history" USING btree ("created_at");