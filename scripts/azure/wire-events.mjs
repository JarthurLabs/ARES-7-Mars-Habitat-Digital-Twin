import { existsSync } from "node:fs";
import {
  assertAzureAccount,
  handleFailure,
  run,
  validateScope,
} from "./common.mjs";

try {
  const scope = validateScope(process.env, "write");
  const wiringTemplate = new URL(
    "../../infra/event-wiring.bicep",
    import.meta.url,
  );
  if (!existsSync(wiringTemplate)) {
    throw new Error(
      "infra/event-wiring.bicep must be reviewed and committed during the live-scenario milestone",
    );
  }
  assertAzureAccount(scope);
  run("az", [
    "deployment",
    "group",
    "validate",
    "--resource-group",
    scope.resourceGroup,
    "--template-file",
    "infra/event-wiring.bicep",
  ]);
  run("az", [
    "deployment",
    "group",
    "what-if",
    "--resource-group",
    scope.resourceGroup,
    "--template-file",
    "infra/event-wiring.bicep",
    "--no-pretty-print",
  ]);
  run("az", [
    "deployment",
    "group",
    "create",
    "--name",
    "ares7-event-wiring",
    "--resource-group",
    scope.resourceGroup,
    "--template-file",
    "infra/event-wiring.bicep",
  ]);
} catch (error) {
  handleFailure(error);
}
