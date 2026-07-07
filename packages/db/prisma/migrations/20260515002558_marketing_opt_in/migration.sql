-- AlterTable
ALTER TABLE "User" ALTER COLUMN "pushPrefs" SET DEFAULT '{"transactional":true,"marketing":false}';

-- Flip all existing users' marketing pref to false until re-consent
UPDATE "User"
SET "pushPrefs" = jsonb_set("pushPrefs"::jsonb, '{marketing}', 'false')
WHERE ("pushPrefs"::jsonb ->> 'marketing')::boolean IS DISTINCT FROM false;
