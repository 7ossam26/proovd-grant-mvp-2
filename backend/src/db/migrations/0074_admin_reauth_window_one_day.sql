-- Product direction: an Admin sign-in remains fresh for one day. Updating the
-- stored setting is required because ADMIN_REAUTH_WINDOW_SECONDS is only a
-- first-boot seed and does not replace an existing operator value.
--
-- Leave NULL alone so an intentionally unconfigured installation continues to
-- fail closed and can be seeded through the existing bootstrap path.
UPDATE "app_settings"
   SET "value" = '86400',
       "updated_by" = 'system:migration',
       "update_reason" = 'extended the Admin reauthentication window to one day by product direction'
 WHERE "key" = 'admin_reauth_window_seconds'
   AND "value" IS NOT NULL
   AND "value" IS DISTINCT FROM '86400';
