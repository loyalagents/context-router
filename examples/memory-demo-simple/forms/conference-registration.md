# Conference Registration Form

Loose form dump for quick memory-demo experiments.

## Form Goal

Fill a conference registration form for a synthetic attendee using profile data, existing MCP memory, and local fallback memory for anything missing from MCP.

## Fields

- Full name: required profile value.
- Badge name: required profile value.
- Email: required profile value.
- Organization: required profile value.
- Role: required profile value.
- Preferred contact channels: required memory value from `communication.preferred_channels`.
- Technical interests: required memory value from `dev.tech_stack`.
- Dietary restrictions: required memory value from `food.dietary_restrictions`.
- Meal preference: required memory value from `travel.meal_preference`.
- Cuisine preferences: required memory value from `food.cuisine_preferences`.
- Spice tolerance: required memory value from `food.spice_tolerance`; expected options are `none`, `mild`, `medium`, `hot`, and `extra_hot`.
- Travel seat preference: required memory value from `travel.seat_preference`; expected options are `window`, `middle`, and `aisle`.
- Additional notes: optional freeform field; leave blank when there is no supported value.

## Expected Filled Values For Alex Rivera

- Full name: Alex Rivera
- Badge name: Alex
- Email: alex.rivera@example.test
- Organization: Northstar Labs
- Role: Senior Product Engineer
- Preferred contact channels: email, slack
- Technical interests: TypeScript, Next.js, NestJS, PostgreSQL, AI tooling
- Dietary restrictions: peanuts, shellfish
- Meal preference: vegetarian
- Cuisine preferences: Japanese, Mediterranean
- Spice tolerance: medium
- Travel seat preference: aisle
- Additional notes: blank
