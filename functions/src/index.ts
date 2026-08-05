import { app } from "@azure/functions";
import { emergencyController } from "./emergencyController.js";
import { ingestTelemetry } from "./ingestTelemetry.js";
import { negotiateViewer } from "./negotiateViewer.js";

app.eventGrid("ingestTelemetry", {
  handler: ingestTelemetry,
});

app.eventGrid("emergencyController", {
  handler: emergencyController,
});

app.http("negotiateViewer", {
  route: "viewer/negotiate",
  methods: ["GET", "OPTIONS"],
  authLevel: "anonymous",
  handler: negotiateViewer,
});
