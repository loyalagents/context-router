# 100-Document Goal Commands

TODO: Move these commands to a more permanent eval docs location after the workflow stabilizes.

## Validate The Current 100-Doc Fixture

Focused validation:

```bash
pnpm eval:validate --user nina-meera-patel --corpus realistic
```

Focused validation and refresh report:

```bash
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
```

Scenario-scope validation:

```bash
pnpm eval:validate --scenario nina-meera-patel-i9-realistic
```

Full eval verification:

```bash
pnpm eval:verify
```

## Regenerate Manifest Without AI

Use after `corpus-plan.json` metadata changes:

```bash
pnpm eval:manifest --user nina-meera-patel --corpus realistic
```

## Inspect The Corpus

Count committed document files:

```bash
find examples/eval/users/nina-meera-patel/corpora/realistic/documents -type f | wc -l
```

List file-type distribution:

```bash
find examples/eval/users/nina-meera-patel/corpora/realistic/documents -type f | sed 's/.*\\.//' | sort | uniq -c
```

Summarize the manifest:

```bash
node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync("examples/eval/users/nina-meera-patel/corpora/realistic/manifest.json","utf8")); console.log(JSON.stringify({userId:m.userId, corpusId:m.corpusId, docs:m.documents.length, categories:m.documents.reduce((a,d)=>(a[d.category]=(a[d.category]||0)+1,a),{}), intentionallyMissing:m.intentionallyMissing.map(x=>x.factKey)},null,2));'
```

List planned file extensions:

```bash
node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync("examples/eval/users/nina-meera-patel/corpora/realistic/corpus-plan.json","utf8")); console.log(p.documents.reduce((a,d)=>(a[d.outputExtension]=(a[d.outputExtension]||0)+1,a),{}));'
```

## Derive Seed Preferences

Run after profile changes:

```bash
pnpm eval:derive-seeds
```

## Fish Env For Vertex Generation

Set these in fish with real values:

```fish
set -x GCP_PROJECT_ID (gcloud config get-value project)
set -x EVAL_GENERATION_MODEL gemini-2.5-pro
set -x VERTEX_REGION us-central1
```

Authenticate if needed:

```fish
gcloud auth application-default login
gcloud auth application-default set-quota-project $GCP_PROJECT_ID
```

Check the variables:

```fish
echo $GCP_PROJECT_ID
echo $EVAL_GENERATION_MODEL
echo $VERTEX_REGION
```

## Mixed Vertex Preview

Generate a cross-category mixed preview to a temp folder:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --ids 001,017,031,043,055,063,081 --out /private/tmp/nina-mixed-preview
```

List preview files:

```bash
find /private/tmp/nina-mixed-preview -type f | sort
```

Search preview for supported values:

```bash
rg -n "Nina Meera Patel|742 Maple Ridge Lane|Apt 5D|Austin|TX|78704|nina\\.patel@example\\.test|nina\\.patel@hillcountrydata\\.example\\.test|U\\.S\\. citizen|Shah|000-00-0392" /private/tmp/nina-mixed-preview
```

Search for accidental phone-like values:

```bash
rg -n "\\b\\(?[0-9]{3}\\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\\b|Phone|Telephone" /private/tmp/nina-mixed-preview
```

Parse generated JSON preview files:

```bash
find /private/tmp/nina-mixed-preview -name '*.json' -print0 | xargs -0 -n1 node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log("ok", process.argv[1]);'
```

## Full Vertex Generation

Run this only after preview quality is acceptable:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --backend vertex --overwrite --concurrency 2
```

Then validate:

```bash
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
pnpm eval:verify
```

## Targeted Regeneration

Regenerate selected docs in place using short ids:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --regenerate 001,017,031 --concurrency 2
```

Preview selected docs without touching the committed corpus:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --ids 001,017,031 --out /private/tmp/nina-preview
```

## Useful Searches

Find docs that declare SSN support:

```bash
node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync("examples/eval/users/nina-meera-patel/corpora/realistic/manifest.json","utf8")); for (const d of m.documents.filter(d=>d.factKeys.includes("identity.ssn"))) console.log(d.path);'
```

Find actual SSN mentions:

```bash
rg -l "000-00-0392|0000000392|0392" examples/eval/users/nina-meera-patel/corpora/realistic/documents
```

## Backend Not Required

The generator calls Vertex directly from `examples/eval/scripts/generate.mjs`.

The backend does not need to be running for:

- `pnpm eval:validate`
- `pnpm eval:verify`
- `pnpm eval:manifest`
- `pnpm eval:generate`

Backend test DB setup is only needed for future `pnpm eval:run` snapshot work.
