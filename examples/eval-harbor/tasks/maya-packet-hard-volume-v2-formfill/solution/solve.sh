#!/bin/sh
set -eu

mkdir -p outputs/forms

cat > outputs/forms/i-9.json <<'JSON'
{
  "schemaVersion": 1,
  "taskId": "maya-packet-hard-volume-v2-formfill",
  "formId": "i-9",
  "fields": {
    "section1.address.city": "Oakland",
    "section1.address.postalCode": "94609",
    "section1.address.state": "CA",
    "section1.address.street": "2846 Ashbury Street",
    "section1.address.unit": "Apt 3D",
    "section1.citizenship.usCitizen": true,
    "section1.dateOfBirthMmddyyyy": "02221991",
    "section1.email": "maya.chen@gmail.test",
    "section1.firstName": "Maya",
    "section1.lastName": "Chen",
    "section1.middleInitial": "L",
    "section1.ssnDigits": "000000417"
  },
  "abstentions": {
    "section1.phone": "No supported phone number is present for Maya Chen in the packet."
  },
  "notes": []
}
JSON

cat > outputs/forms/fw4.json <<'JSON'
{
  "schemaVersion": 1,
  "taskId": "maya-packet-hard-volume-v2-formfill",
  "formId": "fw4",
  "fields": {
    "step1.address.cityStateZip": "Oakland, CA 94609",
    "step1.address.streetLine": "2846 Ashbury Street Apt 3D",
    "step1.filingStatus.singleOrMarriedFilingSeparately": true,
    "step1.firstName": "Maya",
    "step1.lastName": "Chen",
    "step1.ssnDigits": "000000417"
  },
  "abstentions": {},
  "notes": []
}
JSON

cat > outputs/forms/direct-deposit-sf1199a-24.json <<'JSON'
{
  "schemaVersion": 1,
  "taskId": "maya-packet-hard-volume-v2-formfill",
  "formId": "direct-deposit-sf1199a-24",
  "fields": {
    "section1.accountType.checking": true,
    "section1.payeeAddress.city": "Oakland",
    "section1.payeeAddress.postalCode": "94609",
    "section1.payeeAddress.state": "CA",
    "section1.payeeAddress.streetLine": "2846 Ashbury Street Apt 3D",
    "section1.payeeName": "Maya Lin Chen",
    "section1.personEntitledToPayment": "Maya Lin Chen",
    "section3.accountHolderName": "Maya Lin Chen",
    "section3.financialInstitutionName": "Bay Harbor Credit Union"
  },
  "abstentions": {
    "section1.payeePhone": "No supported phone number is present for Maya Chen in the packet."
  },
  "notes": []
}
JSON
