# Cost controls and cleanup

ARES-7 is a short-lived evidence lab. The resource group is the unit of cost
tracking and cleanup.

## Current Azure state

| Item | State |
|---|---|
| Resource group | Deleted after the verified live run on August 9, 2026 |
| Core services | Deployed, verified, then removed with the resource group |
| Function App and Event Grid | Deployed for the verified run, then removed |
| DTDL models and twin graph | Uploaded for the verified run, then removed |
| Budget alert | Planned, not claimed as configured |
| Public redacted Azure evidence | Live-run and zero-residue summaries verified |

The Azure resources were genuine short-lived lab state. The named live run
proved the graph, routes, controller, approval boundary, and duplicate
handling. Cleanup then removed the exact resource group and left no tagged
ARES-7 group or resource in the active subscription.

## Spending envelope

- Target total lab spend: **under $10**.
- Planned secondary alert: **$25**.
- Evidence window: keep services live only as long as validation requires.
- Cleanup target: delete the lab resource group within **72 hours** of the final
  evidence capture. **Met on August 9, 2026.**

Azure budget alerts can lag and do not stop resources. They are a warning, not
a hard cap.

## Template cost gates

The Bicep template accepts only:

- IoT Hub `F1`, capacity 1.
- Web PubSub `Free_F1`, capacity 1.
- Standard LRS Storage.
- Metered Azure Digital Twins operations.

There is no paid fallback for IoT Hub or Web PubSub. If a free allocation is
unavailable, the deployment should fail and the lab should remain local rather
than silently consume more credit.

The first design excludes virtual machines, Kubernetes, Cosmos DB, Azure Data
Explorer, private endpoints, Defender plan upgrades, and paid AI services.
Functions and Event Grid are intended for consumption-based use when their
deployment is added.

## Tags

Resources created by the template carry:

```text
project=ARES-7
environment=development|evidence
purpose=portfolio-digital-twin-lab
costPolicy=free-skus-and-consumption-only
cleanup=delete-within-72-hours-of-final-evidence
```

The existing resource group is also tagged so that the cost boundary is visible
before any child service is created.

## Core deployment record

1. Confirmed the active subscription and exact target resource group.
2. Listed the empty group before deployment.
3. Built and validated the Bicep template.
4. Confirmed in What-If that exactly Digital Twins, IoT Hub F1, Web PubSub
   Free_F1, Standard LRS Storage, blob service configuration, and two private
   containers would be created.
5. Deployed the core and verified `Succeeded` plus the three intended SKUs.
6. Saved redacted evidence without tenant, subscription, or personal IDs.

Before adding consumption services, configure the planned budget alert and run
the same validate/What-If/deploy sequence for that incremental template.

Read-only checks:

```bash
az account show --query '{subscription:name, tenant:tenantId}' --output table
az resource list --resource-group rg-ares7-lab-eus2 --output table
```

Do not commit the command output without redacting tenant and subscription
identifiers.

## Evidence-run checklist

During the live window:

- Use one named scenario run ID.
- Capture IoT message count, Function logs, twin state, and the approval change.
- Record start and stop times in UTC.
- Do not enable unrelated monitoring or premium features for a screenshot.
- Review Cost Analysis before and after the run, accepting that data may lag.
- Remove any locally stored device credential when the run is complete.

## Cleanup procedure

The deletion target is only `rg-ares7-lab-eus2`.

First resolve and review the exact contents:

```bash
az group show --name rg-ares7-lab-eus2 --output table
az resource list --resource-group rg-ares7-lab-eus2 --output table
```

After the final evidence capture, delete that resource group through the Azure
portal or with:

```bash
az group delete --name rg-ares7-lab-eus2 --yes
```

Then verify removal:

```bash
az group exists --name rg-ares7-lab-eus2
```

Expected result: `false`.

Finally:

1. Remove the device credential from the local shell and any password manager
   entry created only for this run.
2. Confirm no ARES-7 resource exists outside the target group.
3. Save redacted cleanup proof in the evidence register.
4. Check delayed Cost Analysis later and record the actual total.

Deleting the resource group is destructive. Never substitute a broad path,
subscription-wide query, wildcard, or unresolved environment variable for the
explicit group name.

## Cleanup result

The guarded cleanup script from merge commit `cd6b052` deleted only
`rg-ares7-lab-eus2`. It verified the group no longer existed. Two additional
subscription-wide tag queries returned empty arrays for ARES-7-tagged groups
and resources. The redacted machine-readable result is in
[`evidence/logs/2026-08-09-azure-cleanup-summary.json`](../evidence/logs/2026-08-09-azure-cleanup-summary.json).
