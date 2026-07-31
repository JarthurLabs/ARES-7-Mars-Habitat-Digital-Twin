import { app } from "@azure/functions";
import { emergencyController } from "./emergencyController.js";
import { ingestTelemetry } from "./ingestTelemetry.js";

app.eventGrid("ingestTelemetry", {
  handler: ingestTelemetry,
});

app.eventGrid("emergencyController", {
  handler: emergencyController,
});
