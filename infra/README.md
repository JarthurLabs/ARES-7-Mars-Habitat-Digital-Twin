# Infrastructure

## Current Azure state

Deployment `ares7-core-20260731` in `rg-ares7-lab-eus2` succeeded. It created
the four intended core services plus the Storage blob service and two private
containers. Integration and end-to-end live evidence remain pending.

The first deployment is intentionally small and fail-closed:

- Azure Digital Twins instance with a system-assigned identity.
- IoT Hub **F1 only**.
- Web PubSub **Free_F1 only**, with local-key authentication disabled.
- Standard locally redundant Storage account with private scene and evidence containers.
- TLS 1.2 minimum, no anonymous blob access, and tags that make the cleanup policy visible.

There is no paid IoT Hub or Web PubSub fallback. If either free SKU is unavailable, deployment stops and the documented fallback is used instead of silently spending credit.

Pre-deployment review corrected the derived storage-name length and casing.
Bicep build exposed IoT flags in the wrong resource body; Azure validation then
exposed a network ACL unsupported by Web PubSub Free_F1. Both were corrected
before What-If and the successful deployment. The sequence is preserved in the
evidence record rather than hidden.

Function Apps, Event Grid subscriptions, data-plane models, twins, relationships, and device identities are deployed after the core resources. Several of those operations depend on code existing or require data-plane commands, so combining everything into one template would make errors harder to diagnose.

## Azure CLI deployment

```bash
az group show --name rg-ares7-lab-eus2 --output table
az resource list --resource-group rg-ares7-lab-eus2 --output table

az deployment group validate \
  --resource-group rg-ares7-lab-eus2 \
  --template-file infra/main.bicep \
  --parameters '@infra/main.parameters.example.json'

az deployment group what-if \
  --resource-group rg-ares7-lab-eus2 \
  --template-file infra/main.bicep \
  --parameters '@infra/main.parameters.example.json'

az deployment group create \
  --resource-group rg-ares7-lab-eus2 \
  --template-file infra/main.bicep \
  --parameters '@infra/main.parameters.example.json'
```

For any redeployment, do not run the create command until validation succeeds
and `what-if` shows only the expected resources and free SKUs. What-If is
proposal evidence; the saved deployment state and resource list are the core
deployment evidence.
