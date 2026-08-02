import { DigitalTwinsClient } from "@azure/digital-twins-core";
import { DefaultAzureCredential } from "@azure/identity";
import { WebPubSubServiceClient } from "@azure/web-pubsub";
import { AzureDigitalTwinStore, type TwinStore } from "./twinStore.js";

const credential = new DefaultAzureCredential();
let twinsClient: DigitalTwinsClient | undefined;
let pubSubClient: WebPubSubServiceClient | undefined;
let twinStore: TwinStore | undefined;

export function getTwinsClient(): DigitalTwinsClient {
  const endpoint = process.env.AZURE_DIGITAL_TWINS_ENDPOINT;
  if (!endpoint) throw new Error("AZURE_DIGITAL_TWINS_ENDPOINT is not configured.");
  twinsClient ??= new DigitalTwinsClient(endpoint, credential);
  return twinsClient;
}

export function getTwinStore(): TwinStore {
  twinStore ??= new AzureDigitalTwinStore(getTwinsClient());
  return twinStore;
}

export function getPubSubClient(): WebPubSubServiceClient | undefined {
  const endpoint = process.env.AZURE_WEBPUBSUB_ENDPOINT;
  const hub = process.env.AZURE_WEBPUBSUB_HUB ?? "ares7";
  if (!endpoint) return undefined;
  pubSubClient ??= new WebPubSubServiceClient(endpoint, credential, hub);
  return pubSubClient;
}
