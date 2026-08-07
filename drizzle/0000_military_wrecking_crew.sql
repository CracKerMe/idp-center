CREATE TABLE "access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"token_hash" text,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"subject_type" text DEFAULT 'user' NOT NULL,
	"oidc_session_id" text,
	"auth_code_id" text,
	"expires_at" timestamp NOT NULL,
	"revoked" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"scope" text DEFAULT 'openid',
	"revoked_at" timestamp,
	"revoke_reason" text,
	CONSTRAINT "access_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"requested_at" timestamp DEFAULT now(),
	"scheduled_delete_at" timestamp NOT NULL,
	"cancelled_at" timestamp,
	"completed_at" timestamp,
	"status" text DEFAULT 'pending',
	CONSTRAINT "account_deletion_requests_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"user_id" text,
	"tenant_id" text,
	"action" text NOT NULL,
	"target_id" text,
	"ip_address" text,
	"user_agent" text,
	"details" text,
	"prev_hash" text,
	"hash" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auth_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false,
	"nonce" text,
	"scope" text DEFAULT 'openid',
	"code_challenge" text,
	"code_challenge_method" text DEFAULT 'S256',
	"sid" text,
	CONSTRAINT "auth_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "backchannel_logout_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"oidc_session_id" text NOT NULL,
	"client_id" text NOT NULL,
	"url" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "client_assertion_jtis" (
	"jti" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"client_secret_hash" text,
	"client_secret_alg" text,
	"client_name" text NOT NULL,
	"redirect_uris" text NOT NULL,
	"grant_types" text NOT NULL,
	"tenant_id" text DEFAULT 'default',
	"is_resource_server" boolean DEFAULT false,
	"allowed_scopes" text,
	"frontchannel_logout_uri" text,
	"backchannel_logout_uri" text,
	"post_logout_redirect_uris" text,
	"jwks" text,
	"jwks_uri" text,
	"token_endpoint_auth_method" text DEFAULT 'client_secret_post',
	"allowed_audiences" text,
	"registration_token_hash" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "device_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"client_id" text NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"scope" text DEFAULT 'openid',
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"nonce" text,
	"interval" integer DEFAULT 5 NOT NULL,
	"last_polled_at" timestamp,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "device_codes_device_code_unique" UNIQUE("device_code")
);
--> statement-breakpoint
CREATE TABLE "dpop_jtis" (
	"jti" text PRIMARY KEY NOT NULL,
	"jkt" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"type" text NOT NULL,
	"new_email" text,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "email_verifications_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "group_roles" (
	"group_id" text NOT NULL,
	"role_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "identity_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"alias" text NOT NULL,
	"type" text NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"config_enc" text NOT NULL,
	"attribute_mapping" text DEFAULT '{}' NOT NULL,
	"jit_provisioning" boolean DEFAULT true,
	"link_by_verified_email" boolean DEFAULT false,
	"default_roles" text,
	"email_domains" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "linked_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"provider_username" text,
	"access_token" text,
	"tenant_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"tenant_id" text NOT NULL,
	"client_id" text,
	"outcome" text NOT NULL,
	"ip" text,
	"asn" text,
	"country" text,
	"city" text,
	"ua_family" text,
	"os_family" text,
	"device_fingerprint" text,
	"is_new_device" boolean,
	"is_new_country" boolean,
	"impossible_travel_kmh" integer,
	"hour_of_day" integer,
	"day_of_week" integer,
	"auth_methods" text,
	"risk_score" integer,
	"risk_reasons" text,
	"risk_action" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mfa_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"factor_id" text,
	"type" text NOT NULL,
	"code_hash" text,
	"challenge" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mfa_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text,
	"secret_enc" text,
	"phone" text,
	"email" text,
	"credential_id" text,
	"public_key" text,
	"counter" integer DEFAULT 0,
	"transports" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"provider" text,
	"payload" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "oidc_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"sid" text NOT NULL,
	"browser_session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"scope" text,
	"amr" text,
	"acr" text,
	"auth_time" timestamp DEFAULT now() NOT NULL,
	"last_refreshed_at" timestamp DEFAULT now(),
	"terminated_at" timestamp,
	"risk_score" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "password_resets_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "pushed_auth_requests" (
	"request_uri" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"payload" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"scope" text DEFAULT 'openid',
	"family_id" text,
	"oidc_session_id" text,
	"auth_code_id" text,
	"session_id" text,
	"expires_at" timestamp NOT NULL,
	"revoked" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"remember_me" boolean DEFAULT false,
	"device_id" text,
	CONSTRAINT "refresh_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "risk_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"min_score" integer NOT NULL,
	"max_score" integer NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "saml_assertion_ids" (
	"assertion_id" text PRIMARY KEY NOT NULL,
	"idp_alias" text NOT NULL,
	"tenant_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "schema_migrations" (
	"version" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"applied_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_info" text,
	"ip_address" text,
	"amr" text,
	"acr" text,
	"last_active" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"kid" text NOT NULL,
	"alg" text DEFAULT 'RS256' NOT NULL,
	"use" text DEFAULT 'sig' NOT NULL,
	"public_jwk" text NOT NULL,
	"private_jwk_enc" text NOT NULL,
	"status" text DEFAULT 'next' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"activated_at" timestamp,
	"retired_at" timestamp,
	"expires_at" timestamp,
	CONSTRAINT "signing_keys_kid_unique" UNIQUE("kid")
);
--> statement-breakpoint
CREATE TABLE "tenant_ip_whitelist" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"cidr" text NOT NULL,
	"description" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_mfa_policies" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"required" boolean DEFAULT false,
	"required_for_admins" boolean DEFAULT true,
	"allowed_types" text DEFAULT 'totp,webauthn,email',
	"remember_device_days" integer DEFAULT 30,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_password_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"min_length" integer DEFAULT 8 NOT NULL,
	"history_count" integer DEFAULT 5 NOT NULL,
	"rotation_enabled" boolean DEFAULT false,
	"rotation_period_days" integer DEFAULT 90 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "tenant_password_policies_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"is_active" boolean DEFAULT true,
	"settings" text DEFAULT '{}',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_fingerprint" text NOT NULL,
	"device_name" text,
	"trusted_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_behavior_baselines" (
	"user_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"usual_countries" text,
	"usual_asns" text,
	"usual_hours" text,
	"usual_devices" text,
	"login_count" integer DEFAULT 0,
	"peer_group" text,
	"feature_vector" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"user_id" text NOT NULL,
	"group_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"tenant_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"tenant_id" text DEFAULT 'default',
	"is_active" boolean DEFAULT true,
	"is_admin" boolean DEFAULT false,
	"is_platform_admin" boolean DEFAULT false,
	"otp_secret" text,
	"otp_enabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"full_name" text,
	"avatar_url" text,
	"phone" text,
	"password_changed_at" timestamp DEFAULT now(),
	"failed_login_attempts" integer DEFAULT 0,
	"locked_until" timestamp,
	"email_verified" boolean DEFAULT false,
	"email_verified_at" timestamp,
	"must_change_password" boolean DEFAULT false
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_accounts" ADD CONSTRAINT "linked_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_sessions" ADD CONSTRAINT "oidc_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_ip_whitelist" ADD CONSTRAINT "tenant_ip_whitelist_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_mfa_policies" ADD CONSTRAINT "tenant_mfa_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_password_policies" ADD CONSTRAINT "tenant_password_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_access_tokens_hash" ON "access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_access_tokens_session" ON "access_tokens" USING btree ("oidc_session_id");--> statement-breakpoint
CREATE INDEX "idx_access_tokens_auth_code" ON "access_tokens" USING btree ("auth_code_id");--> statement-breakpoint
CREATE INDEX "idx_access_tokens_user" ON "access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant_created" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user_created" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_audit_logs_seq" ON "audit_logs" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "idx_backchannel_deliveries_status" ON "backchannel_logout_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_clients_tenant" ON "clients" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_device_codes_usercode_tenant" ON "device_codes" USING btree ("user_code","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_device_codes_expires" ON "device_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_group_roles_unique" ON "group_roles" USING btree ("group_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_groups_tenant_name" ON "groups" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_idp_tenant_alias" ON "identity_providers" USING btree ("tenant_id","alias");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_linked_accounts_provider_user_tenant" ON "linked_accounts" USING btree ("provider","provider_user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_login_events_user_time" ON "login_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_login_events_tenant_time" ON "login_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_mfa_challenges_user" ON "mfa_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_mfa_factors_user" ON "mfa_factors" USING btree ("user_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_oidc_sessions_sid_tenant" ON "oidc_sessions" USING btree ("sid","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_oidc_sessions_browser" ON "oidc_sessions" USING btree ("browser_session_id");--> statement-breakpoint
CREATE INDEX "idx_oidc_sessions_user_client" ON "oidc_sessions" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "idx_password_history_user" ON "password_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_par_expires" ON "pushed_auth_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_family" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_session" ON "refresh_tokens" USING btree ("oidc_session_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_auth_code" ON "refresh_tokens" USING btree ("auth_code_id");--> statement-breakpoint
CREATE INDEX "idx_risk_policies_tenant" ON "risk_policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_role_permissions_unique" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_roles_tenant_name" ON "roles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "idx_saml_assertion_expires" ON "saml_assertion_ids" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_signing_keys_status" ON "signing_keys" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ip_whitelist_tenant_cidr" ON "tenant_ip_whitelist" USING btree ("tenant_id","cidr");--> statement-breakpoint
CREATE INDEX "idx_ip_whitelist_tenant" ON "tenant_ip_whitelist" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_trusted_devices_user_fingerprint" ON "trusted_devices" USING btree ("user_id","device_fingerprint");--> statement-breakpoint
CREATE INDEX "idx_ubb_tenant" ON "user_behavior_baselines" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_groups_unique" ON "user_groups" USING btree ("user_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_roles_unique" ON "user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE INDEX "idx_user_roles_user_tenant" ON "user_roles" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_username_tenant" ON "users" USING btree ("username","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email_tenant" ON "users" USING btree ("email","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_users_tenant" ON "users" USING btree ("tenant_id");