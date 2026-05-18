# Forms Notes

This file records what user information would be needed to fill the editable
sections of the PDFs in `forms/<formId>/form.pdf`.

Field inventory was checked with the backend's `pdf-lib` dependency, matching
the current form-fill implementation where possible. `rental-app-fillable.pdf`
is encrypted and `pdf-lib` cannot enumerate its AcroForm fields, so its checklist
comes from rendering the PDF pages and reading the visible fillable application.

Generated field manifests live beside each PDF:

- `forms/<formId>/fields.generated.json` tracks raw PDF field names, types,
  option sets, inferred labels, data keys, fake-data hints, fill policy, and
  sensitivity.
- `forms/<formId>/field-map.json`, when present, is the machine-readable mapping
  from PDF fields to local eval fact keys or intentional skip reasons.
- `forms/<formId>/fake-user-requirements.generated.md` summarizes the inferred
  fake-user requirements for quick review.

Run `pnpm eval:manifests` after adding or replacing PDFs.

## Current Eval Fixture Coverage

The current canonical user fixture is Elena Marquez. Her realistic corpus is
focused on I-9 Section 1 and uses the V1 eval profile, manifest, scenario, and
field-map contracts.

For evaluation and demos, signatures, certifications, legal attestations,
consent checkboxes, and anything requiring a current legal assertion should be
skipped unless the user explicitly supplied that exact value for this form run.

## Cross-Form Information Categories

A user who wanted every editable section filled across all forms would need a
large personal dossier, including:

- Legal identity: full legal name, former names, aliases, suffixes, date and
  place of birth, sex, physical description, SSN, ITIN, USCIS/A-number, passport
  details, photo ID details, and signature dates.
- Contact and addresses: phone numbers, email addresses, current mailing and
  residential addresses, previous addresses, campus addresses, counties, states,
  ZIP codes, countries, and dates at each address.
- Household and family: spouse or partner, parents, parent spouse or partner,
  children, dependents, other household members, proposed rental occupants,
  emergency contacts, personal references, and authorized representatives.
- Education: high school completion, school names and locations, GED or other
  equivalency data, college grade level, colleges receiving FAFSA data, student
  IDs, campus housing references, and education dates.
- Employment and income: current and prior employers, occupations, supervisor
  contacts, employment dates, first day of employment, wages, pay periods, gross
  income, financial aid, cash aid, unemployment, Social Security, child support,
  school grants or loans, rental income, and self-employment records.
- Tax and assets: filing status, whether a 1040 or foreign/territorial return is
  filed, AGI, income tax paid, IRA and pension distributions and rollovers,
  education credits, EIC status, Schedule A/B/D/E/F/H status, business profit or
  loss, foreign earned income exclusion, child support received or paid, cash,
  checking and savings balances, investments, business values, deductions, and
  extra withholding choices.
- Housing and public benefits: rent or mortgage costs, utilities, bank balances,
  current or prior SNAP/CalFresh, cash aid, Medicaid/Medi-Cal, SSI, TANF, WIC,
  school lunch, housing assistance, QHP benefits, and expedited benefit
  circumstances.
- Immigration and work authorization: I-9 citizenship or immigration status,
  acceptable employment documents, issuing authorities, document numbers,
  expiration dates, I-94 data, foreign passport details, and country of issuance.
- Security-clearance history: citizenship, foreign ties, residences, education,
  employment, military service, people who know the user, relationships,
  relatives, foreign contacts and activities, mental health, police record, drug
  and alcohol use, prior investigations and clearances, financial record, IT
  misuse, civil court actions, and associations.
- Rental application data: rental history, landlord contacts, reasons for
  leaving, pets, smoking status, vehicles, references, emergency contacts,
  proposed rental, proposed move-in date, and proof documents.

## `2026-27-fafsa-form.pdf`

Inventory: 23 pages, 463 AcroForm fields: 250 text, 112 radio, 101 checkbox.

This form needs enough student-aid data to complete the FAFSA for the student
and, when applicable, the student's spouse, parent, parent spouse or partner,
and preparer.

Needed student information:

- Name, middle name, last name, suffix, date of birth, SSN, ITIN, mobile phone,
  email, permanent mailing address, city, state, ZIP, ZIP+4, and country.
- Current marital status, college grade level, whether this is the first
  bachelor's degree, whether the student is pursuing initial teaching
  certification, family size, number in college, and sex.
- Personal circumstances: active duty, veteran, dependents, orphan, ward of
  court, foster care, emancipated minor, legal guardianship, or none.
- Homelessness and homelessness determination source, unusual circumstances, and
  whether applying for Direct Unsubsidized Loan only.
- Race and ethnicity selections and "other" subcategory text for White, Black or
  African American, Asian, American Indian or Alaska Native, Native Hawaiian or
  Other Pacific Islander, Hispanic or Latino, and Middle Eastern or North
  African.
- Citizenship status, A-number if eligible noncitizen, state of residence, and
  month/year state residency began.
- Parent education status, whether a parent was killed in the line of duty, high
  school completion status, high school or equivalency details, and issuing
  state.
- Federal benefit history for EIC, housing assistance, school lunch, Medicaid,
  QHP, SNAP, SSI, TANF, WIC, or none.
- Tax filing details: whether a 1040 was or will be filed, whether no U.S. return
  will be filed, whether a joint return was filed, filing status, earned income,
  tax-exempt interest, IRA distributions and rollovers, pension distributions and
  rollovers, AGI, income tax paid, EIC status, IRA/self-employed plan payments,
  education credits, Schedule A/B/D/E/F/H status, net profit or loss, grants and
  benefits, foreign earned income exclusion, child support, cash/savings/checking
  balances, investments, and business values.
- Up to 10 colleges: Federal School Code, name, address/city, and state.
- Consent and approval checkbox plus signature month, day, and year.

Needed student spouse information, if applicable:

- Same identity, contact, address, tax filing, income, asset, consent, and
  signature-date fields as the student spouse section exposes.

Needed parent and parent spouse/partner information, if applicable:

- Parent identity, contact, address, marital status, state residency, family
  size, number in college, federal benefits, tax filing, income, assets, consent,
  and signature-date fields.
- Parent spouse or partner identity, contact, address, tax filing, income,
  assets, consent, and signature-date fields.

Needed preparer information, if applicable:

- Preparer name, last name, SSN or EIN, affiliation or organization, mailing
  address, city, state, ZIP, ZIP+4, and signature date.

Caveats:

- This form contains many sensitive values. The current demo users are not
  adequate for it.
- Consent and signature fields should be skipped unless the user explicitly asks
  to complete them for the current form.

## `SF86-16a-Nat-security-questionare.pdf`

Inventory: 136 pages, 6,197 AcroForm fields: 3,149 text, 398 radio, 857
dropdown, 1,793 checkbox.

This is the largest and most sensitive fixture. Filling every editable field
requires effectively a complete SF-86 security-clearance dossier.

Needed information:

- Core identity: full name, SSN, date and place of birth, gender, suffix,
  physical description, and other names used with dates and reasons.
- Contact data: current phone numbers, email addresses, mailing and physical
  addresses, and U.S. passport or passport-card history.
- Citizenship: U.S. citizenship basis, naturalization or citizenship certificate
  details, derivative citizenship, non-U.S. citizenship, dual citizenship,
  foreign passports, foreign citizenship benefits, and related documents.
- Residence history: addresses, dates, ownership/rental status, and people who
  can verify each residence.
- Education history: schools attended, dates, degrees/diplomas, addresses,
  contacts, and disciplinary history.
- Employment activities: current and prior employers, unemployment periods,
  self-employment, supervisors, addresses, dates, duties, reasons for leaving,
  disciplinary actions, and federal service details.
- Selective Service and military history: registration, service branch, service
  dates, discharge type, disciplinary record, and foreign military involvement.
- People who know the user well, marital/cohabitation history, current and
  former spouse or partner details, relatives, in-laws, and foreign-born or
  foreign-resident relatives.
- Foreign contacts and activities: close foreign contacts, foreign financial
  interests, business/professional activities, foreign government contacts,
  foreign travel, foreign property, foreign voting, foreign military or security
  activity, and foreign support.
- Psychological and emotional health history, treatment, counseling, diagnoses,
  hospitalizations, and provider details where required.
- Police record, charges, arrests, convictions, probation, parole, domestic
  violence, restraining orders, and related court details.
- Illegal drug use, drug activity, prescription drug misuse, treatment, and
  alcohol-related counseling or incidents.
- Prior background investigations, clearance eligibility, clearance denials,
  suspensions, revocations, debarments, and agency details.
- Financial record: delinquencies, collections, repossessions, liens, judgments,
  bankruptcy, wage garnishment, taxes, credit counseling, gambling debt, and
  mitigation details.
- Misuse of information technology, non-criminal court actions, and association
  record information covering terrorism, espionage, sabotage, overthrow,
  violence, or related organizations.
- Continuation sections, authorization releases, certifications, and signature
  dates.

Caveats:

- The field names are mostly generated by the source PDF, so reliable automation
  would need stronger label/position extraction than the current metadata-only
  prompt.
- This should not be used with the current synthetic demo users except as a
  stress test for skipped fields.

## `fw4.pdf`

Inventory: 5 pages, 48 AcroForm fields: 43 text, 5 checkbox.

Needed employee information:

- First name, middle initial, last name, SSN, address, city, state, ZIP, and tax
  filing status.
- Whether the employee has multiple jobs or a spouse who works.
- Dependent credit inputs: qualifying children under age 17, other dependents,
  and total other credits.
- Other income not from jobs, deductions, and extra withholding per pay period.
- Whether the employee claims exemption from withholding for 2026.
- Employee signature and date.

Needed worksheet information:

- Multiple Jobs Worksheet: number of jobs, annual wages for highest/lower paying
  jobs, table values from the W-4 tables, number of pay periods per year, and
  resulting extra withholding.
- Deductions Worksheet: qualifying tips, qualified overtime compensation,
  passenger vehicle loan interest, age/blindness adjustments, student loan
  interest, IRA contributions, educator expenses, alimony, other adjustments,
  itemized deductions, medical/dental expenses, state and local taxes, home
  mortgage interest, charitable gifts, other itemized deductions, income
  limitation values, standard deduction, cash charitable gifts, and final
  deduction amount.

Needed employer-only information:

- Employer name and address, first date of employment, and employer EIN.

Caveats:

- The form-fill flow can technically fill signature and employer-only fields, but
  those should be skipped unless the user supplied them for this run.

## `i-9.pdf`

Inventory: 2 pages, 48 AcroForm fields: 42 text, 5 checkbox, 1 dropdown.

Needed employee information:

- Last name, first name, middle initial, other last names used, street address,
  apartment number, city, state, ZIP, date of birth, SSN, email, and telephone.
- Citizenship or immigration status: U.S. citizen, noncitizen national, lawful
  permanent resident, or alien authorized to work.
- If applicable: USCIS/A-number, work authorization expiration date, Form I-94
  admission number, foreign passport number, and country of issuance.
- Employee signature and today's date.

Needed employer/reviewer information:

- List A document data, or List B and List C document data: document title,
  issuing authority, document number, and expiration date for each presented
  document.
- Whether the alternative document-examination procedure was used.
- Employee first day of employment.
- Employer or authorized representative name and title, signature, today's date,
  employer business or organization name, and employer business address.

Caveats:

- Section 2 depends on physical document inspection and should usually be skipped
  by memory-only form fill.
- Signatures and attestations require explicit user action.

## `rental-app-fillable.pdf`

Inventory: 2 rendered pages. `pdf-lib` cannot enumerate the fields because the
PDF is encrypted, but the visible application is fillable.

Needed applicant information:

- Applicant last name, first name, middle initial, SSN or ITIN if provided, date
  of birth, contact phone, photo ID type, photo ID number, issuing government,
  ID expiration date, other ID, and email address.
- Present address, city, state, ZIP, owner/manager, owner/manager phone, rent
  amount, dates from/to, and reason for leaving.
- Previous address, city, state, ZIP, owner/manager, owner/manager phone, rent
  amount, dates from/to, and reason for leaving.
- Current or previous campus address if applicable, dates, rent amount, housing
  or residential-life office phone, student ID, and whether a UCSC reference
  release form has been turned in, will not be turned in, or will be turned in
  within three days.
- Proposed occupants and ages for up to six occupants.
- Pets, smoker status, current occupation, current employer, employment dates,
  supervisor name, supervisor phone, and work city.
- Previous occupation, previous employer, employment dates, supervisor name,
  supervisor phone, and work city.
- Current gross income, pay period, savings, financial aid award, and financial
  aid pay period.
- Personal reference name and phone.
- Emergency contact name, phone, relation, and email.
- Up to two vehicles by make, year, and license number.
- Address of proposed rental and proposed move-in date.
- Application date and applicant signature.

Needed supporting documents mentioned by the instructions:

- Most recent pay slip, latest bank statement with sensitive account data
  blacked out, trust or family-assistance documentation if applicable, financial
  aid letter if applicable, and UCSC reference release materials for campus
  housing references.

Caveats:

- The visible form warns not to send SSN by email. Treat SSN/ITIN as highly
  sensitive and skip unless explicitly provided for this exact run.

## `saws_1-SNAP.pdf`

Inventory: 8 pages, 115 AcroForm fields: 38 text, 77 checkbox.

The fillable fields are concentrated in the initial application pages. The other
pages are mostly informational rights, responsibilities, program rules, and proof
instructions.

Needed applicant information:

- Name, other names, SSN if available and applying for benefits, home address or
  directions, apartment number, city, county, state, ZIP, mailing address if
  different, home phone, work/alternate/message phone, and email address.
- Consent choices for receiving application and case information by email.
- Programs being applied for: CalFresh, cash aid, and/or health coverage.
- Disability/help-applying status, homelessness status, preferred reading
  language, preferred speaking language, and deaf/hard-of-hearing status.

Needed expedited service and emergency information:

- Whether household gross monthly income is under $150 and cash/checking/savings
  are $100 or less.
- Whether housing costs are more than monthly income plus liquid resources.
- Whether the household is a migrant or seasonal farmworker household with low
  liquid resources.
- Eviction or notice to pay rent or leave.
- Utility shutoff or shutoff notice.
- Whether food will run out in three days or less.
- Need for transportation to get food, clothing, medical care, or another
  emergency item.
- Need for essential clothing such as diapers or weather-appropriate clothes.
- Pregnancy status and whether a Presumptive Eligibility card was received.
- Whether anyone in the household has a personal emergency, and if so whether it
  is pregnancy, immediate medical need, child abuse, domestic abuse, elder abuse,
  or another emergency threatening health or safety.

Needed signature information:

- Applicant date and spouse/other parent/aided adult/registered domestic partner
  date. Signature boxes are visible and should be treated as manual attestation
  fields.

Needed authorized representative information:

- Whether to name someone to help with the CalFresh case, representative name,
  and representative phone number.
- Whether to name someone to receive and spend CalFresh benefits, representative
  name, phone, address, city, state, and ZIP.
- Whether to choose a health-insurance authorized representative.

Needed demographics and other-program information:

- American Indian or Alaska Native status.
- Optional race/ethnicity choices: opt out, Hispanic/Latino/Spanish origin,
  Mexican, Puerto Rican, Cuban, other Hispanic origin text, White, American
  Indian or Alaska Native, Black or African American, Other or Mixed text, Asian
  subcategories, Other Asian text, Native Hawaiian or Other Pacific Islander
  subcategories, and Samoan.
- Interview preference: in-person CalFresh interview preference and disability
  accommodation need.
- Household public-assistance history: whether anyone ever received TANF, Tribal
  TANF, Medicaid, SNAP/food stamps, General Assistance/General Relief, or similar
  programs, plus who and where.

Proof documents listed in the form:

- Identity, birth certificates for cash aid applicants, residence proof, SSNs,
  bank statements, earned and unearned income proof, lawful immigration status if
  applicable, housing costs, phone and utility costs, medical expenses for
  elderly or disabled household members, dependent-care costs, child support
  paid, job-related health insurance, current health insurance policy numbers,
  immunization proof for young children, and vehicle registration for cash aid.

Caveats:

- Many fields are yes/no emergency or eligibility claims. These should not be
  inferred from generic user memory.
