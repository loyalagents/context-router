# Diana Mercer — Synthetic Source Corpus

This folder contains a synthetic source corpus for the persona Diana Mercer.
It is structured to mirror the Alex Rivera realistic-parsing corpus and is
intended for use in preference store and context server demos, where an agent
must recover profile and preference facts from ordinary workplace, travel, and
event-planning files.

## Persona Summary

Diana Mercer is a VP of Cloud Architecture at Crestline Software, an independent
software vendor. She is in her mid-fifties, based on the US East Coast (Boston
area), and travels frequently to the West Coast for conferences and customer
engagements. Diana attends cloud and platform engineering conferences regularly
(e.g., CloudNativeCon, AWS re:Invent, Google Cloud Next) and is a practitioner-
level speaker and attendee.

She uses AI assistants — primarily Claude.ai, with Perplexity and Google Search
as additional tools — to handle personal shopping and all travel booking
(personal and professional). She shops exclusively online and has no preferred
retailers; she delegates retailer selection to her AI assistant based on fit,
reviews, and delivery speed. For flights she prefers JetBlue and Delta (aisle,
no checked bags, TSA PreCheck / Global Entry); for hotels she defaults to
Hotels.com with a Marriott Bonvoy loyalty preference.

Diana is pescatarian at events and gluten-sensitive (not celiac). She prefers
Japanese, Mediterranean, and Vietnamese food. In her personal time she attends
studio yoga classes and tends a home vegetable and herb garden.

She operates under a selective-minimum data-sharing model: agents and services
should request only the fields needed for a given task, not the full profile.

## Corpus

- `profile-export.json` — account and profile export with durable preferences,
  AI assistant usage patterns, and stale prior-employer fields.
- `assistant-preferences.yaml` — assistant configuration with communication,
  travel, food, shopping, and technical interest hints.
- `conference-registration-draft.md` — hand-written event registration notes
  with meal, travel, session, and data-sharing guidance.
- `engineering-interests.toml` — structured topic and preference export for
  technical conference matching systems.
- `team-chat-thread.txt` — internal chat thread confirming identity, title,
  meal, travel, session, and communication preferences, with unrelated noise.
- `README.md` — this file.

## Notes

All data is synthetic and non-sensitive. No real personal information is
included. The stale `previousCompany` (Stratosphere Solutions) is intentionally
included to test parser robustness when conflicting employer records appear.

Scenarios using this corpus should validate that agents:
1. Prefer current fields over stale fields.
2. Request minimum data per task rather than pulling the full export.
3. Require consent before sharing profile data with third-party services.
