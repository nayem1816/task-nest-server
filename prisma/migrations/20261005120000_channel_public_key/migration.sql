-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "publicKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Channel_publicKey_key" ON "Channel"("publicKey");


-- Existing website chat channels get a key so they can be installed.
UPDATE "Channel"
SET "publicKey" = 'wk_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)
WHERE "type" = 'WEBSITE_CHAT' AND "publicKey" IS NULL;
