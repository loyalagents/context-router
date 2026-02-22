-- CreateEnum
CREATE TYPE "PreferenceValueType" AS ENUM ('STRING', 'BOOLEAN', 'ENUM', 'ARRAY');

-- CreateEnum
CREATE TYPE "PreferenceScope" AS ENUM ('GLOBAL', 'LOCATION');

-- CreateTable
CREATE TABLE "preference_definitions" (
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "value_type" "PreferenceValueType" NOT NULL,
    "scope" "PreferenceScope" NOT NULL,
    "options" JSONB,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "is_core" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preference_definitions_pkey" PRIMARY KEY ("slug")
);

-- Seed core preference definitions
INSERT INTO "preference_definitions" ("slug", "description", "value_type", "scope", "options", "is_sensitive", "is_core", "created_at", "updated_at") VALUES
  ('system.response_tone', 'The personality and formality level the AI should use when responding.', 'ENUM', 'GLOBAL', '["casual","professional","concise","enthusiastic"]', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('system.response_length', 'Preferred length of AI responses - brief for quick answers, detailed for thorough explanations.', 'ENUM', 'GLOBAL', '["brief","moderate","detailed"]', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('food.dietary_restrictions', 'Food allergies, intolerances, dislikes, or diet plans the user follows (e.g., vegetarian, vegan, gluten-free, kosher, halal).', 'ARRAY', 'GLOBAL', null, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('food.cuisine_preferences', 'Types of cuisine the user enjoys or prefers (e.g., Italian, Japanese, Mexican).', 'ARRAY', 'GLOBAL', null, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('food.spice_tolerance', 'How much spice/heat the user prefers in their food.', 'ENUM', 'GLOBAL', '["none","mild","medium","hot","extra_hot"]', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dev.tech_stack', 'Preferred programming languages, frameworks, and tools the user works with.', 'ARRAY', 'GLOBAL', null, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dev.coding_style', 'Coding conventions and style preferences (e.g., tabs vs spaces, naming conventions).', 'STRING', 'GLOBAL', null, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('travel.seat_preference', 'Preferred airplane seat location.', 'ENUM', 'GLOBAL', '["window","middle","aisle"]', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('travel.meal_preference', 'Meal preference for flights and travel.', 'STRING', 'GLOBAL', null, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('communication.preferred_channels', 'Preferred methods of communication (e.g., email, phone, text, slack).', 'ARRAY', 'GLOBAL', null, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('location.default_temperature', 'Preferred temperature setting for a specific location (in Fahrenheit).', 'STRING', 'LOCATION', null, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('location.quiet_hours', 'Time range when the user prefers no notifications or disturbances at this location.', 'STRING', 'LOCATION', null, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Delete existing preference data that may reference unknown slugs
TRUNCATE "user_preferences" CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_slug_fkey" FOREIGN KEY ("slug") REFERENCES "preference_definitions"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;
