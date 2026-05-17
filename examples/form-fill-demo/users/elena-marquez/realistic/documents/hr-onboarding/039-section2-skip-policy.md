# Section 2 Skip Policy

Policy memo: People Operations / Form I-9 demo guardrail
Effective: 2026-05-10

For this demo, an agent may extract employee Section 1 facts from Elena's memory corpus. It must not complete Section 2 fields from memory-only context.

Skip these field groups:
- Document Title 1, 2, or 3
- Issuing Authority
- Document Number
- Expiration Date
- Alternative procedure checkbox
- First day of employment when treated as Section 2 field
- Employer or authorized representative name/title/signature/date
- Employer business or organization name/address

Reason: Section 2 requires employer or authorized representative review of acceptable documents. The corpus may contain document-choice hints, but those are not the same as review completion.
