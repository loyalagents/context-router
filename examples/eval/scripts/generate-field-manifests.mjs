#!/usr/bin/env node

import { createRequire } from 'node:module';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const demoRoot = path.resolve(repoRoot, 'examples/eval');
const formsRoot = path.resolve(demoRoot, 'forms');

const backendRequire = createRequire(
  path.join(repoRoot, 'apps/backend/package.json'),
);

const {
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
} = backendRequire('pdf-lib');

const ORIGINAL_FILENAMES = new Map([
  ['2026-27-fafsa-form', '2026-27-fafsa-form.pdf'],
  ['sf86-16a-nat-security-questionare', 'SF86-16a-Nat-security-questionare.pdf'],
  ['fw4', 'fw4.pdf'],
  ['i-9', 'i-9.pdf'],
  ['rental-app-fillable', 'rental-app-fillable.pdf'],
  ['saws-1-snap', 'saws_1-SNAP.pdf'],
]);

const SENSITIVE_PATTERNS = [
  /social security|ssn/,
  /\bitin\b/,
  /uscis|a-?number|\banumber\b/,
  /passport|i-?94/,
  /tax|1040|income|wage|salary|gross|withholding|deduction|credit|ira|pension|asset|saving|checking|investment|business/,
  /benefit|snap|calfresh|cash aid|medi-?cal|medicaid|ssi|tanf|wic|health|medical/,
  /homeless|disability|pregnan|emergency|abuse|domestic|eviction/,
  /drug|alcohol|police|arrest|convict|court|bankrupt|debt|lien|garnish|clearance|investigation/,
];

const MANUAL_PATTERNS = [
  /signature|sign here|signed/,
  /consent|approval|certif|attest|declaration|under penalty|perjury|oath|authorization release/,
];

const INFERENCE_RULES = [
  {
    key: 'identity.first_name',
    kind: 'person.firstName',
    label: 'First name',
    confidence: 'high',
    patterns: [/first name|given name|\bname \(first/],
  },
  {
    key: 'identity.middle_name_or_initial',
    kind: 'person.middleNameOrInitial',
    label: 'Middle name or initial',
    confidence: 'high',
    patterns: [/middle name|middle initial|\bmi\b|m\.i\./],
  },
  {
    key: 'identity.last_name',
    kind: 'person.lastName',
    label: 'Last name',
    confidence: 'high',
    patterns: [/last name|family name|surname/],
  },
  {
    key: 'identity.full_name',
    kind: 'person.fullName',
    label: 'Full legal name',
    confidence: 'medium',
    patterns: [/\bfull name\b/, /^name\b/, /applicant_name$/, /\bapplicant.?s name\b/],
  },
  {
    key: 'identity.other_names',
    kind: 'person.previousOrOtherNames',
    label: 'Other names used',
    confidence: 'high',
    patterns: [/other names|former names|maiden|nickname|alias/],
  },
  {
    key: 'identity.suffix',
    kind: 'person.nameSuffix',
    label: 'Name suffix',
    confidence: 'high',
    patterns: [/suffix/],
  },
  {
    key: 'identity.date_of_birth',
    kind: 'date.birthDate',
    label: 'Date of birth',
    confidence: 'high',
    patterns: [/date of birth|birth month|birth day|birth year|\bdob\b/],
  },
  {
    key: 'identity.ssn',
    kind: 'id.ssn',
    label: 'Social Security number',
    confidence: 'high',
    patterns: [/social security|ssn/],
  },
  {
    key: 'identity.itin',
    kind: 'id.itin',
    label: 'Individual Taxpayer Identification Number',
    confidence: 'high',
    patterns: [/\bitin\b/],
  },
  {
    key: 'identity.sex_or_gender',
    kind: 'person.sexOrGender',
    label: 'Sex or gender',
    confidence: 'high',
    patterns: [/\bsex\b|\bgender\b/],
  },
  {
    key: 'identity.citizenship_status',
    kind: 'person.citizenshipStatus',
    label: 'Citizenship or immigration status',
    confidence: 'high',
    patterns: [/citizenship|citizen|eligible noncitizen|alien authorized|lawful permanent|immigration status/],
  },
  {
    key: 'identity.uscis_or_anumber',
    kind: 'id.uscisANumber',
    label: 'USCIS or A-number',
    confidence: 'high',
    patterns: [/uscis|a-?number|\banumber\b/],
  },
  {
    key: 'contact.email',
    kind: 'internet.email',
    label: 'Email address',
    confidence: 'high',
    patterns: [/e-?mail|email/],
  },
  {
    key: 'contact.phone',
    kind: 'phone.number',
    label: 'Phone number',
    confidence: 'high',
    patterns: [/phone|telephone|mobile/],
  },
  {
    key: 'address.street',
    kind: 'address.street',
    label: 'Street address',
    confidence: 'high',
    patterns: [/street|mailing address|home address|permanent mailing|address/],
  },
  {
    key: 'address.city',
    kind: 'address.city',
    label: 'City',
    confidence: 'high',
    patterns: [/\bcity\b|city or town/],
  },
  {
    key: 'address.state',
    kind: 'address.state',
    label: 'State',
    confidence: 'high',
    patterns: [/\bstate\b|school6_state/],
  },
  {
    key: 'address.zip',
    kind: 'address.zipCode',
    label: 'ZIP code',
    confidence: 'high',
    patterns: [/zip/],
  },
  {
    key: 'address.country',
    kind: 'address.country',
    label: 'Country',
    confidence: 'high',
    patterns: [/country/],
  },
  {
    key: 'household.marital_status',
    kind: 'household.maritalStatus',
    label: 'Marital status',
    confidence: 'high',
    patterns: [/marital status|married|single|divorced|widowed|separated/],
  },
  {
    key: 'household.family_or_dependents',
    kind: 'household.members',
    label: 'Family, household, or dependent information',
    confidence: 'medium',
    patterns: [/family size|dependents?|children|household|spouse|parent|partner|occupants/],
  },
  {
    key: 'education.school',
    kind: 'education.school',
    label: 'School or college information',
    confidence: 'medium',
    patterns: [/school|college|grade level|bachelor|ged|hiset|tasc|student id|education/],
  },
  {
    key: 'employment.employer',
    kind: 'employment.employer',
    label: 'Employer information',
    confidence: 'high',
    patterns: [/employer|business or org|organization name|occupation|supervisor|firstdayemployed|first day of employment/],
  },
  {
    key: 'employment.document',
    kind: 'employment.authorizationDocument',
    label: 'Employment authorization document',
    confidence: 'high',
    patterns: [/document title|issuing authority|document number|expiration date|list [abc]/],
  },
  {
    key: 'tax.filing',
    kind: 'tax.filingStatus',
    label: 'Tax filing information',
    confidence: 'high',
    patterns: [/1040|filing status|tax return|income tax|schedule [a-h]|eic|adjusted gross|agi/],
  },
  {
    key: 'finance.income_or_assets',
    kind: 'finance.amount',
    label: 'Income, assets, or financial amount',
    confidence: 'medium',
    patterns: [/income|earned|wage|salary|cash|savings|checking|investment|businesses|rent amount|gross|financial aid|deduction|withholding|credit|ira|pension|loan interest|charit/],
  },
  {
    key: 'public_benefits.program_status',
    kind: 'benefits.programStatus',
    label: 'Public benefits or program status',
    confidence: 'medium',
    patterns: [/benefit|snap|calfresh|cash aid|medi-?cal|medicaid|ssi|tanf|wic|school lunch|housing|qhp|programs/],
  },
  {
    key: 'demographics.race_or_ethnicity',
    kind: 'person.raceEthnicity',
    label: 'Race or ethnicity',
    confidence: 'high',
    patterns: [/race|ethnic|hispanic|latino|white|black|asian|native|pacific islander|middle eastern|african american/],
  },
  {
    key: 'housing.rental_history',
    kind: 'housing.rentalHistory',
    label: 'Rental or housing history',
    confidence: 'medium',
    patterns: [/rent|rental|landlord|owner\/manager|reason for leaving|eviction|homeless|housing|mortgage|utilities/],
  },
  {
    key: 'vehicle.vehicle',
    kind: 'vehicle.description',
    label: 'Vehicle information',
    confidence: 'high',
    patterns: [/vehicle|license/],
  },
  {
    key: 'emergency_contact.contact',
    kind: 'contact.emergencyContact',
    label: 'Emergency contact',
    confidence: 'high',
    patterns: [/emergency contact|personal emergency|relation/],
  },
  {
    key: 'authorized_representative.contact',
    kind: 'contact.authorizedRepresentative',
    label: 'Authorized representative',
    confidence: 'high',
    patterns: [/authorized representative|representative/],
  },
  {
    key: 'legal.signature_or_attestation',
    kind: 'legal.signature',
    label: 'Signature, consent, or attestation',
    confidence: 'high',
    patterns: MANUAL_PATTERNS,
  },
  {
    key: 'date.generic',
    kind: 'date.generic',
    label: 'Date',
    confidence: 'low',
    patterns: [/date|month|day|year|from_datefield|to_datefield/],
  },
];

async function main() {
  const formIds = (await readdir(formsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const formId of formIds) {
    const formDir = path.join(formsRoot, formId);
    const pdfPath = path.join(formDir, 'form.pdf');
    const manifest = await buildManifest(formId, pdfPath);
    await writeFile(
      path.join(formDir, 'fields.generated.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await writeFile(
      path.join(formDir, 'fake-user-requirements.generated.md'),
      renderRequirements(manifest),
    );
    const status =
      manifest.extraction.status === 'ok'
        ? `${manifest.fieldCount} fields`
        : `failed: ${manifest.extraction.error}`;
    console.log(`${formId}: ${status}`);
  }
}

async function buildManifest(formId, pdfPath) {
  const pdfBuffer = await readFile(pdfPath);
  const warnings = [];

  return capturePdfLibWarnings(warnings, async () => {
    let pdfDoc;
    let loadMode = 'normal';

    try {
      pdfDoc = await PDFDocument.load(pdfBuffer);
    } catch (error) {
      warnings.push(`normal PDF load failed: ${error.message}`);
      try {
        pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
        loadMode = 'ignoreEncryption';
      } catch (fallbackError) {
        return emptyManifest(formId, pdfPath, {
          status: 'failed',
          error: fallbackError.message,
          loadMode: 'failed',
          warnings,
        });
      }
    }

    const base = emptyManifest(formId, pdfPath, {
      status: 'ok',
      error: null,
      loadMode,
      warnings,
    });

    try {
      base.pageCount = pdfDoc.getPageCount();
      base.hasXfa = hasXfa(pdfDoc);
    } catch (error) {
      base.extraction.status = 'failed';
      base.extraction.error = error.message;
      base.fields = [];
      base.fieldCount = 0;
      base.typeCounts = {};
      base.requirements = [];
      return base;
    }

    try {
      const rawFields = pdfDoc.getForm().getFields();
      base.fields = rawFields.map((field, index) => enrichField(field, index));
      dedupeOptionSets(base);
      base.fieldCount = base.fields.length;
      base.typeCounts = countBy(base.fields, (field) => field.type);
      base.sectionCounts = countBy(
        base.fields,
        (field) => field.sectionHint ?? 'unknown',
      );
      base.requirements = buildRequirements(base.fields);
      return base;
    } catch (error) {
      base.extraction.status = 'failed';
      base.extraction.error = error.message;
      base.fields = [];
      base.fieldCount = 0;
      base.typeCounts = {};
      base.requirements = [];
      return base;
    }
  });
}

async function capturePdfLibWarnings(warnings, fn) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const message = args.map(String).join(' ');
    warnings.push(message);
    if (process.env.FORM_FILL_MANIFEST_DEBUG) {
      originalWarn(...args);
    }
  };

  try {
    return await fn();
  } finally {
    console.warn = originalWarn;
  }
}

function emptyManifest(formId, pdfPath, extraction) {
  return {
    schemaVersion: 1,
    generator: 'examples/eval/scripts/generate-field-manifests.mjs',
    formId,
    sourcePdf: {
      path: path.relative(demoRoot, pdfPath),
      storedFilename: path.basename(pdfPath),
      originalFilename: ORIGINAL_FILENAMES.get(formId) ?? path.basename(pdfPath),
    },
    pageCount: null,
    hasXfa: false,
    extraction,
    fieldCount: 0,
    typeCounts: {},
    sectionCounts: {},
    optionSets: [],
    requirements: [],
    fields: [],
  };
}

function enrichField(field, index) {
  const pdfFieldName = field.getName();
  const type = fieldType(field);
  const options = fieldOptions(field);
  const inferred = inferField(pdfFieldName, type);

  return {
    index,
    pdfFieldName,
    type,
    ...(field instanceof PDFTextField && field.getMaxLength() !== undefined
      ? { maxLength: field.getMaxLength() }
      : {}),
    options,
    inferredLabel: inferred.label,
    inferredDataKey: inferred.dataKey,
    fakeDataKind: inferred.fakeDataKind,
    fillPolicy: inferred.fillPolicy,
    sensitivity: inferred.sensitivity,
    confidence: inferred.confidence,
    sectionHint: inferSection(pdfFieldName),
  };
}

function fieldType(field) {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'option_list';
  if (field instanceof PDFSignature) return 'signature';
  if (field instanceof PDFButton) return 'button';
  return 'unknown';
}

function fieldOptions(field) {
  if (
    field instanceof PDFDropdown ||
    field instanceof PDFOptionList ||
    field instanceof PDFRadioGroup
  ) {
    return field.getOptions();
  }

  return [];
}

function dedupeOptionSets(manifest) {
  const optionSetByKey = new Map();

  for (const field of manifest.fields) {
    if (!field.options || field.options.length === 0) {
      field.optionSetId = null;
      field.optionCount = 0;
      delete field.options;
      continue;
    }

    const key = JSON.stringify(field.options);
    let optionSet = optionSetByKey.get(key);

    if (!optionSet) {
      optionSet = {
        id: `optionSet${optionSetByKey.size + 1}`,
        options: field.options,
      };
      optionSetByKey.set(key, optionSet);
      manifest.optionSets.push(optionSet);
    }

    field.optionSetId = optionSet.id;
    field.optionCount = optionSet.options.length;
    delete field.options;
  }
}

function hasXfa(pdfDoc) {
  const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
  return acroForm instanceof PDFDict && acroForm.has(PDFName.of('XFA'));
}

function inferField(pdfFieldName, type) {
  const normalized = normalize(pdfFieldName);
  const sensitivity = inferSensitivity(normalized);
  const manual = MANUAL_PATTERNS.some((pattern) => pattern.test(normalized));

  if (type === 'button' || type === 'signature' || type === 'unknown') {
    return {
      label: humanizeFieldName(pdfFieldName),
      dataKey: null,
      fakeDataKind: null,
      fillPolicy: 'skip',
      sensitivity,
      confidence: 'high',
    };
  }

  for (const rule of INFERENCE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        label: rule.label,
        dataKey: rule.key,
        fakeDataKind: rule.kind,
        fillPolicy: manual ? 'manual' : 'auto_candidate',
        sensitivity,
        confidence: rule.confidence,
      };
    }
  }

  const label = humanizeFieldName(pdfFieldName);
  return {
    label,
    dataKey: label ? 'unmapped.needs_review' : null,
    fakeDataKind: label ? genericFakeKind(type) : null,
    fillPolicy: manual ? 'manual' : 'auto_candidate',
    sensitivity,
    confidence: label ? 'low' : 'none',
  };
}

function inferSensitivity(normalized) {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized))
    ? 'sensitive'
    : 'normal';
}

function genericFakeKind(type) {
  switch (type) {
    case 'checkbox':
      return 'boolean';
    case 'radio':
    case 'dropdown':
    case 'option_list':
      return 'oneOfOptions';
    case 'text':
      return 'string';
    default:
      return null;
  }
}

function inferSection(pdfFieldName) {
  const rawSegments = pdfFieldName
    .split(/[.[\]]+/)
    .filter(Boolean)
    .filter((segment) => !/^\d+$/.test(segment));

  const meaningful = rawSegments.find((segment) =>
    /section|step|page|applicant|rep_|student|parent|preparer|list [abc]|continuation/i.test(
      segment,
    ),
  );

  if (!meaningful) return null;

  return meaningful
    .replace(/\\/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanizeFieldName(pdfFieldName) {
  const cleaned = pdfFieldName
    .replace(/form1\[\d+\]\./g, '')
    .replace(/topmostSubform\[\d+\]\./g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/#area\.\d+\./g, '')
    .replace(/#field/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\.+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;
  if (/^(page\d+|textField\d+|f\d+\s*\d+|c\d+\s*\d+|cell\d+|row\d+)$/i.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function normalize(value) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function buildRequirements(fields) {
  const requirementMap = new Map();

  for (const field of fields) {
    const key = field.inferredDataKey ?? 'unmapped.no_data_key';
    const existing = requirementMap.get(key) ?? {
      dataKey: key,
      label: field.inferredLabel ?? 'Unmapped field',
      fakeDataKind: field.fakeDataKind,
      fillPolicy: field.fillPolicy,
      sensitivity: field.sensitivity,
      confidence: field.confidence,
      fieldCount: 0,
      samplePdfFieldNames: [],
    };

    existing.fieldCount += 1;
    existing.fillPolicy = mergeFillPolicy(existing.fillPolicy, field.fillPolicy);
    existing.sensitivity =
      existing.sensitivity === 'sensitive' || field.sensitivity === 'sensitive'
        ? 'sensitive'
        : 'normal';
    existing.confidence = mergeConfidence(existing.confidence, field.confidence);
    if (existing.samplePdfFieldNames.length < 5) {
      existing.samplePdfFieldNames.push(field.pdfFieldName);
    }

    requirementMap.set(key, existing);
  }

  return [...requirementMap.values()].sort((a, b) => {
    if (a.dataKey.startsWith('unmapped') !== b.dataKey.startsWith('unmapped')) {
      return a.dataKey.startsWith('unmapped') ? 1 : -1;
    }
    return a.dataKey.localeCompare(b.dataKey);
  });
}

function mergeFillPolicy(left, right) {
  const rank = { skip: 0, manual: 1, auto_candidate: 2 };
  return rank[right] < rank[left] ? right : left;
}

function mergeConfidence(left, right) {
  const rank = { none: 0, low: 1, medium: 2, high: 3 };
  return rank[right] < rank[left] ? right : left;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function renderRequirements(manifest) {
  const lines = [
    `# Fake User Requirements: ${manifest.formId}`,
    '',
    '<!-- Generated by scripts/generate-field-manifests.mjs. Do not edit directly. -->',
    '',
    `Source PDF: \`${manifest.sourcePdf.path}\``,
    '',
    `Original filename: \`${manifest.sourcePdf.originalFilename}\``,
    '',
    `Extraction status: \`${manifest.extraction.status}\``,
    '',
  ];

  if (manifest.extraction.error) {
    lines.push(`Extraction error: \`${manifest.extraction.error}\``, '');
  }

  lines.push(
    `Pages: ${manifest.pageCount ?? 'unknown'}`,
    '',
    `Fields: ${manifest.fieldCount}`,
    '',
    `Type counts: ${JSON.stringify(manifest.typeCounts)}`,
    '',
  );

  const sectionEntries = Object.entries(manifest.sectionCounts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  if (sectionEntries.length > 0) {
    lines.push('## Section Counts', '');
    for (const [section, count] of sectionEntries.slice(0, 30)) {
      lines.push(`- ${section}: ${count}`);
    }
    if (sectionEntries.length > 30) {
      lines.push(`- ... ${sectionEntries.length - 30} more sections`);
    }
    lines.push('');
  }

  if (manifest.extraction.warnings.length > 0) {
    lines.push('Warnings:', '');
    for (const warning of manifest.extraction.warnings.slice(0, 10)) {
      lines.push(`- ${warning}`);
    }
    if (manifest.extraction.warnings.length > 10) {
      lines.push(
        `- ... ${manifest.extraction.warnings.length - 10} more warnings in fields.generated.json`,
      );
    }
    lines.push('');
  }

  if (manifest.requirements.length === 0) {
    lines.push(
      'No requirements were inferred because fields could not be extracted.',
      '',
    );
    return `${lines.join('\n')}\n`;
  }

  lines.push('## Inferred Requirements', '');

  for (const requirement of manifest.requirements) {
    lines.push(
      `- \`${requirement.dataKey}\`: ${requirement.label} (${requirement.fieldCount} fields; ${requirement.fillPolicy}; ${requirement.sensitivity}; confidence ${requirement.confidence}; fake kind \`${requirement.fakeDataKind ?? 'none'}\`)`,
    );
  }

  const unmapped = manifest.fields.filter(
    (field) =>
      !field.inferredDataKey ||
      field.inferredDataKey.startsWith('unmapped.'),
  );

  if (unmapped.length > 0) {
    lines.push('', '## Unmapped Field Samples', '');
    for (const field of unmapped.slice(0, 25)) {
      lines.push(
        `- \`${field.pdfFieldName}\` (${field.type}; label ${JSON.stringify(field.inferredLabel)})`,
      );
    }
    if (unmapped.length > 25) {
      lines.push(`- ... ${unmapped.length - 25} more unmapped fields`);
    }
  }

  return `${lines.join('\n')}\n`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
