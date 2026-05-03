# Realistic Alex Rivera Source Data

This optional folder contains a noisy synthetic source corpus derived from
`../simple/`. It is intended for future realistic parsing demos where an agent
has to recover profile and memory facts from ordinary workplace, travel, and
event-planning files.

Scenarios do not point at `realistic/` yet. Keep `../simple/` as the verified
machine-checkable baseline until realistic scenario mode exists.

## Corpus

- `profile-export.json`: account/profile export with durable preferences and stale fields.
- `assistant-preferences.yaml`: local assistant settings mixed with communication, food, and travel hints.
- `conference-registration-draft.md`: hand-written event registration notes with fallback memory facts.
- `event-planning-email.eml`: synthetic conference email with registration and meal context.
- `travel-hold.ics`: synthetic calendar hold with attendee, role, and travel notes.
- `team-chat-thread.txt`: chat-style discussion with repeated preferences and unrelated noise.
- `meal-preferences.csv`: multi-person catering export with Alex's row among unrelated rows.
- `engineering-interests.toml`: structured topic preferences for technical events.
- `contact-card.vcf`: exported contact card with identity and event notes.
- `event-profile.xml`: partner-system profile export using nested XML fields.
- `assistant-profile-snippet.html`: saved assistant setup page fragment with profile data.

All data is synthetic and non-sensitive.
