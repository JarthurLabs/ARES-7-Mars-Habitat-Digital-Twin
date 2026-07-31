# Security policy

ARES-7 is a portfolio lab. It is not a production safety system and must not be
used to control real life-support, energy, or access-control equipment.

## Reporting a problem

Use GitHub's private vulnerability-reporting flow if it is enabled for the
repository. Otherwise, contact the repository owner through their GitHub
profile. Do not put credentials, tokens, tenant details, exploit steps, or
other sensitive material in a public issue.

Please include the affected path, the expected and observed behavior, a safe
reproduction, and any suggested mitigation. Reports concerning a real exposed
credential should identify the file or commit without repeating the secret.

## Credential handling

- Azure service clients use `DefaultAzureCredential` where supported.
- The simulator accepts a device-scoped IoT Hub credential only at runtime.
- Real `.env` files and `local.settings.json` are ignored.
- Connection strings, SAS tokens, account keys, client secrets, and portal
  session data must never be committed or included in screenshots.
- Public evidence must redact email addresses, tenant IDs, subscription IDs,
  and any identifiers that are not needed to verify the claim.

If a credential is exposed, revoke or rotate it first, remove it from the
working tree and repository history, then document the remediation without
publishing the replacement value.

## Current security scope

The lab demonstrates private blob containers, disabled shared-key access where
configured, TLS 1.2 minimums, free-SKU cost gates, idempotent tick processing,
ETag-guarded twin updates, and a human approval boundary. It has not undergone
penetration, load, availability, or disaster-recovery testing. Public service
endpoints remain enabled in the lab template to keep the first deployment
understandable and inexpensive.
