#!/usr/bin/env bash
set -euo pipefail

readonly resource_group="rg-ares7-lab-eus2"
readonly repository_url="https://github.com/JarthurLabs/ARES-7-Mars-Habitat-Digital-Twin.git"
readonly repository_branch="agent/complete-ares-live-20260808"
readonly fixed_live_commit="74d62b6cdb1ede7e982ccfb735e30f044802b6c5"
readonly repository_commit="${ARES7_REPOSITORY_COMMIT:-$fixed_live_commit}"
readonly max_spend_usd="10"
readonly run_started_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
readonly run_id="$(python3 -c 'import uuid; print(uuid.uuid4())')"
readonly launch_dir="$PWD"
readonly run_root="$(mktemp -d /tmp/ares7-live-evidence.XXXXXX)"
readonly evidence_dir="$run_root/evidence"
readonly evidence_archive="$launch_dir/ARES7_Live_Evidence_${run_id}.zip"

mkdir -p "$evidence_dir"
printf '%s\n' \
  '{' \
  "  \"scenarioRunId\": \"$run_id\"," \
  "  \"startedAtUtc\": \"$run_started_utc\"," \
  '  "cleanupIncluded": false' \
  '}' > "$evidence_dir/run-metadata.json"

subscription_id=""
tenant_id=""
account_user=""
viewer_pid=""
scenario_pid=""
browser_pid=""

die() {
  echo "ARES-7 guard stopped: $*" >&2
  exit 1
}

terminate_process_tree() {
  local target_pid="$1"
  local child_pid
  while IFS= read -r child_pid; do
    child_pid="${child_pid//[[:space:]]/}"
    [[ -n "$child_pid" ]] && terminate_process_tree "$child_pid"
  done < <(ps -o pid= --ppid "$target_pid" 2>/dev/null)
  kill "$target_pid" 2>/dev/null || true
}

redact_evidence() {
  command -v python3 >/dev/null 2>&1 || return 0
  python3 - "$evidence_dir" "${subscription_id:-}" "${tenant_id:-}" "${account_user:-}" <<'PY'
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
literal_values = [value for value in sys.argv[2:] if value]
for path in root.rglob("*"):
    if not path.is_file():
        continue
    try:
        text = path.read_text()
    except (UnicodeDecodeError, OSError):
        continue
    for value in literal_values:
        text = text.replace(value, "<redacted-account-value>")
        text = text.replace(value.lower(), "<redacted-account-value>")
        text = text.replace(value.upper(), "<redacted-account-value>")
    text = re.sub(
        r'(?i)("?(?:clientId|principalId|tenantId|subscriptionId)"?\s*[:=]\s*"?)[0-9a-f-]{36}("?)',
        r'\1<redacted-id>\2',
        text,
    )
    text = re.sub(
        r'(?i)((?:SharedAccessKey|access_token|sig)=)[^\s&";]+',
        r'\1<redacted-secret>',
        text,
    )
    path.write_text(text)
PY
}

finish() {
  local status=$?
  set +e
  for pid in "${scenario_pid:-}" "${viewer_pid:-}" "${browser_pid:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      terminate_process_tree "$pid"
      wait "$pid" 2>/dev/null
    fi
  done
  redact_evidence
  if command -v zip >/dev/null 2>&1 && [[ -d "$evidence_dir" ]]; then
    (
      cd "$evidence_dir" || exit
      zip -q -r "$evidence_archive" .
    )
    echo "Redacted evidence archive: $evidence_archive"
  fi
  if [[ "$status" -ne 0 ]]; then
    echo "The run stopped safely. Partial redacted evidence remains in $evidence_dir." >&2
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "ARES-7 guarded live evidence run: $run_id"
echo "Pinned repository commit: $repository_commit"
echo "No resource deletion is included in this script."

[[ "$repository_commit" =~ ^[0-9a-fA-F]{40}$ ]] || \
  die "ARES7_REPOSITORY_COMMIT must be one exact 40-character commit."

for required_command in az git node npm python3 zip unzip ps; do
  command -v "$required_command" >/dev/null 2>&1 || \
    die "Required command is unavailable: $required_command"
done

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || [[ "$node_major" -lt 22 ]]; then
  if command -v nvm >/dev/null 2>&1; then
    nvm install 22
    nvm use 22
  elif [[ -n "${NVM_DIR:-}" && -s "${NVM_DIR}/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "${NVM_DIR}/nvm.sh"
    nvm install 22
    nvm use 22
  else
    die "Node.js 22 or newer is required; found $(node --version)."
  fi
fi
node -e 'if (typeof WebSocket !== "function") process.exit(1)' || \
  die "This Node.js build does not provide the WebSocket client required for live capture."

azure_cli_version="$(az version --query '"azure-cli"' --output tsv 2>/dev/null)"
python3 - "$azure_cli_version" <<'PY' || die "Azure CLI 2.70 or newer is required; found $azure_cli_version."
import re
import sys
match = re.match(r"^(\d+)\.(\d+)", sys.argv[1])
raise SystemExit(0 if match and (int(match.group(1)), int(match.group(2))) >= (2, 70) else 1)
PY

az account list --all --output none >/dev/null 2>&1 || \
  die "Azure CLI is not logged in. Open Cloud Shell from the signed-in Azure portal and run this script there."

if ! az extension show --name azure-iot --output none >/dev/null 2>&1; then
  echo "Installing the Azure IoT CLI extension in Cloud Shell."
  az extension add --name azure-iot --yes --only-show-errors \
    > "$evidence_dir/azure-iot-extension-install.log" 2>&1
fi

mapfile -t enabled_subscriptions < <(
  az account list --all --query "[?state=='Enabled'].id" --output tsv
)
[[ "${#enabled_subscriptions[@]}" -gt 0 ]] || die "No enabled Azure subscription is available."

matching_subscriptions=()
for candidate_subscription in "${enabled_subscriptions[@]}"; do
  [[ "$candidate_subscription" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] || \
    die "Azure returned an invalid enabled subscription identifier."
  if ! group_exists="$(
    az group exists \
      --name "$resource_group" \
      --subscription "$candidate_subscription" \
      --output tsv \
      --only-show-errors
  )"; then
    die "Could not safely check $resource_group in every enabled subscription."
  fi
  case "$group_exists" in
    true) matching_subscriptions+=("$candidate_subscription") ;;
    false) ;;
    *) die "Azure returned an unexpected resource-group existence result." ;;
  esac
done

[[ "${#matching_subscriptions[@]}" -eq 1 ]] || \
  die "Expected exactly one enabled subscription containing $resource_group; found ${#matching_subscriptions[@]}."

subscription_id="${matching_subscriptions[0]}"
az account set --subscription "$subscription_id"
actual_subscription="$(
  az account show --subscription "$subscription_id" --query id --output tsv --only-show-errors
)"
[[ "${actual_subscription,,}" == "${subscription_id,,}" ]] || \
  die "Azure CLI did not bind to the uniquely resolved subscription."

tenant_id="$(
  az account show --subscription "$subscription_id" --query tenantId --output tsv --only-show-errors
)"
account_user="$(
  az account show --subscription "$subscription_id" --query user.name --output tsv --only-show-errors
)"
printf '%s\n' \
  '{' \
  '  "subscription": "<redacted>",' \
  '  "tenant": "<redacted>",' \
  '  "user": "<redacted>",' \
  "  \"verifiedAtUtc\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"" \
  '}' > "$evidence_dir/account-redacted.json"

az group show \
  --name "$resource_group" \
  --subscription "$subscription_id" \
  --query '{name:name,location:location,provisioningState:properties.provisioningState,tags:tags}' \
  --output json \
  --only-show-errors > "$evidence_dir/resource-group.json"

python3 - "$evidence_dir/resource-group.json" "$resource_group" <<'PY' || \
  die "The target resource group identity, state, or required ARES-7 tags have drifted."
import json
import sys
group = json.load(open(sys.argv[1]))
expected_tags = {
    "project": "ARES-7",
    "purpose": "portfolio-digital-twin-lab",
    "costPolicy": "free-skus-and-consumption-only",
    "cleanup": "delete-within-72-hours-of-final-evidence",
}
ok = (
    group.get("name") == sys.argv[2]
    and group.get("provisioningState") == "Succeeded"
    and all((group.get("tags") or {}).get(key) == value for key, value in expected_tags.items())
)
raise SystemExit(0 if ok else 1)
PY

az resource list \
  --subscription "$subscription_id" \
  --tag project=ARES-7 \
  --query '[].{name:name,type:type,resourceGroup:resourceGroup,location:location,kind:kind,sku:sku.name,tags:tags}' \
  --output json \
  --only-show-errors > "$evidence_dir/ares-tagged-resources-before.json"

python3 - "$evidence_dir/ares-tagged-resources-before.json" "$resource_group" <<'PY' || \
  die "An ARES-7-tagged resource exists outside the exact target group; refusing scoped writes."
import json
import sys
resources = json.load(open(sys.argv[1]))
expected = sys.argv[2].lower()
outside = [item for item in resources if str(item.get("resourceGroup", "")).lower() != expected]
raise SystemExit(0 if not outside else 1)
PY

capture_cost() {
  local raw_path="$1"
  local normalized_path="$2"
  local error_path="${raw_path%.json}.error.log"
  local scope="/subscriptions/${subscription_id}/resourceGroups/${resource_group}"
  if az costmanagement query \
    --type ActualCost \
    --scope "$scope" \
    --timeframe MonthToDate \
    --dataset-aggregation '{"totalCost":{"name":"Cost","function":"Sum"}}' \
    --subscription "$subscription_id" \
    --output json \
    --only-show-errors > "$raw_path" 2> "$error_path"; then
    python3 - "$raw_path" "$normalized_path" <<'PY'
import json
import pathlib
import sys
source = json.load(open(sys.argv[1]))
properties = source.get("properties", source)
columns = properties.get("columns") or source.get("columns") or []
rows = properties.get("rows") or source.get("rows") or []
names = [str(column.get("name", "")) if isinstance(column, dict) else str(column) for column in columns]
amount = None
currency = None
if rows and isinstance(rows[0], list):
    row = rows[0]
    if "Cost" in names and names.index("Cost") < len(row):
        amount = row[names.index("Cost")]
    if "Currency" in names and names.index("Currency") < len(row):
        currency = row[names.index("Currency")]
    if amount is None:
        amount = next((value for value in row if isinstance(value, (int, float))), None)
    if currency is None:
        currency = next((value for value in row if isinstance(value, str) and len(value) == 3), None)
result = {
    "status": "captured; Azure billing may lag" if isinstance(amount, (int, float)) else "no billed row returned",
    "amount": amount,
    "currency": currency,
}
pathlib.Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + "\n")
PY
  else
    printf '%s\n' '{"status":"billing data unavailable or delayed at capture time","amount":null,"currency":null}' \
      > "$normalized_path"
  fi
}

capture_cost \
  "$evidence_dir/cost-before-raw.json" \
  "$evidence_dir/cost-before.json"

python3 - "$evidence_dir/cost-before.json" "$max_spend_usd" <<'PY' || \
  die "The captured ARES-7 resource-group cost has already reached the 10 USD workflow ceiling."
import json
import sys
cost = json.load(open(sys.argv[1]))
amount = cost.get("amount")
currency = str(cost.get("currency") or "").upper()
limit = float(sys.argv[2])
raise SystemExit(1 if currency == "USD" and isinstance(amount, (int, float)) and amount >= limit else 0)
PY

git clone --quiet --branch "$repository_branch" --single-branch "$repository_url" "$run_root/repository"
cd "$run_root/repository"
git checkout --quiet --detach "$repository_commit"
[[ "$(git rev-parse HEAD)" == "$repository_commit" ]] || \
  die "The checked-out repository commit does not match the pinned commit."
git merge-base --is-ancestor "$fixed_live_commit" "$repository_commit" || \
  die "The selected commit predates the reviewed live-path fixes."
git merge-base --is-ancestor "$repository_commit" "origin/$repository_branch" || \
  die "The selected commit is not reachable from the reviewed pull-request branch."
git diff --quiet && git diff --cached --quiet || \
  die "The checked-out repository is unexpectedly modified."
git show --no-patch --format='commit=%H%nauthorDate=%aI%nsubject=%s' HEAD \
  > "$evidence_dir/repository-commit.txt"

echo "Installing locked dependencies and running the complete local verification suite."
npm ci --silent > "$evidence_dir/npm-root-install.log" 2>&1
npm --prefix simulator ci --silent > "$evidence_dir/npm-simulator-install.log" 2>&1
npm --prefix functions ci --silent > "$evidence_dir/npm-functions-install.log" 2>&1
npm run verify > "$evidence_dir/local-verification.log" 2>&1

export ARES7_RESOURCE_GROUP="$resource_group"
export ARES7_SUBSCRIPTION_ID="$subscription_id"
export ARES7_MILESTONE="live-scenario"
export ARES7_CONFIRM_WRITE="deploy-rg-ares7-lab-eus2"
export ARES7_MAX_SPEND_USD="$max_spend_usd"
export ARES7_SCENARIO_RUN_ID="$run_id"
export ARES7_INTERVAL_SECONDS="12"
export ARES7_DUPLICATE_TICK="11"
export ARES7_DUPLICATE_DELAY_SECONDS="12"

echo "Running the guarded Azure validation and What-If preflight."
npm run azure:preflight > "$evidence_dir/azure-preflight.log" 2>&1

echo "Building and verifying the corrected Azure Functions package."
npm run azure:package:functions > "$evidence_dir/functions-package.log" 2>&1

echo "Idempotently deploying the reviewed integration boundary."
export ARES7_CONFIRM_INTEGRATION="integration-reviewed-rg-ares7-lab-eus2"
npm run azure:deploy:integration > "$evidence_dir/integration-deployment.log" 2>&1
unset ARES7_CONFIRM_INTEGRATION

retry_logged() {
  local attempts="$1"
  local delay_seconds="$2"
  local log_path="$3"
  local description="$4"
  shift 4
  : > "$log_path"
  for attempt in $(seq 1 "$attempts"); do
    printf 'attempt %s/%s: %s\n' "$attempt" "$attempts" "$description" >> "$log_path"
    if "$@" >> "$log_path" 2>&1; then
      return 0
    fi
    if [[ "$attempt" -lt "$attempts" ]]; then
      sleep "$delay_seconds"
    fi
  done
  return 1
}

echo "Deploying the corrected Function package and verifying discovery."
export ARES7_CONFIRM_FUNCTION_DEPLOY="functions-rg-ares7-lab-eus2"
retry_logged 4 20 \
  "$evidence_dir/functions-deployment.log" \
  "Function package deployment" \
  npm run azure:deploy:functions || \
  die "The Function package could not be deployed and discovered after bounded retries."
unset ARES7_CONFIRM_FUNCTION_DEPLOY

echo "Idempotently bootstrapping the nine models, eleven base twins, and fifteen relationships."
export ARES7_CONFIRM_GRAPH_BOOTSTRAP="graph-rg-ares7-lab-eus2"
retry_logged 6 20 \
  "$evidence_dir/graph-bootstrap.log" \
  "Digital Twins graph bootstrap" \
  npm run azure:bootstrap:graph || \
  die "The Digital Twins graph did not become available after bounded role-propagation retries."
unset ARES7_CONFIRM_GRAPH_BOOTSTRAP

echo "Idempotently provisioning the one allowed simulator device identity."
export ARES7_CONFIRM_DEVICE="ares7-simulator"
retry_logged 3 10 \
  "$evidence_dir/device-provisioning.log" \
  "simulator device provisioning" \
  npm run azure:provision:device || \
  die "The guarded simulator identity could not be provisioned or verified."
unset ARES7_CONFIRM_DEVICE

echo "Idempotently wiring the two narrow Event Grid paths and Digital Twins route."
export ARES7_CONFIRM_EVENT_WIRING="wire-rg-ares7-lab-eus2"
npm run azure:wire:events > "$evidence_dir/event-wiring.log" 2>&1
unset ARES7_CONFIRM_EVENT_WIRING

echo "Verifying deployed functions, event paths, route, and base graph before telemetry."
retry_logged 6 15 \
  "$evidence_dir/pre-run-cloud-verification.log" \
  "pre-run cloud verification" \
  env ARES7_VERIFY_STAGE=pre-run npm run azure:verify:live || \
  die "The deployed live path did not pass pre-run verification."

mapfile -t function_app_names < <(
  az functionapp list \
    --resource-group "$resource_group" \
    --subscription "$subscription_id" \
    --query "[?starts_with(name, 'func-ares7-')].name" \
    --output tsv \
    --only-show-errors
)
[[ "${#function_app_names[@]}" -eq 1 ]] || \
  die "Expected exactly one ARES-7 Function App; found ${#function_app_names[@]}."
function_app_name="${function_app_names[0]}"

mapfile -t digital_twins_names < <(
  az resource list \
    --resource-group "$resource_group" \
    --subscription "$subscription_id" \
    --resource-type Microsoft.DigitalTwins/digitalTwinsInstances \
    --query "[?starts_with(name, 'adt-ares7-')].name" \
    --output tsv \
    --only-show-errors
)
[[ "${#digital_twins_names[@]}" -eq 1 ]] || \
  die "Expected exactly one ARES-7 Digital Twins instance; found ${#digital_twins_names[@]}."
digital_twins_name="${digital_twins_names[0]}"

mapfile -t iot_hub_names < <(
  az resource list \
    --resource-group "$resource_group" \
    --subscription "$subscription_id" \
    --resource-type Microsoft.Devices/IotHubs \
    --query "[?starts_with(name, 'iot-ares7-')].name" \
    --output tsv \
    --only-show-errors
)
[[ "${#iot_hub_names[@]}" -eq 1 ]] || \
  die "Expected exactly one ARES-7 IoT Hub; found ${#iot_hub_names[@]}."
iot_hub_name="${iot_hub_names[0]}"

mapfile -t storage_account_names < <(
  az resource list \
    --resource-group "$resource_group" \
    --subscription "$subscription_id" \
    --resource-type Microsoft.Storage/storageAccounts \
    --query "[?starts_with(name, 'stares7')].name" \
    --output tsv \
    --only-show-errors
)
[[ "${#storage_account_names[@]}" -eq 1 ]] || \
  die "Expected exactly one ARES-7 storage account; found ${#storage_account_names[@]}."
storage_account_name="${storage_account_names[0]}"

echo "Regenerating and validating the segmented GLB and Microsoft-schema 3D Scenes configuration."
npm run asset:export > "$evidence_dir/scene-glb-export.log" 2>&1
npm run asset:test > "$evidence_dir/scene-glb-test.log" 2>&1
npm run asset:validate > "$evidence_dir/scene-glb-validation.log" 2>&1
npm run asset:scene:export -- "$storage_account_name" \
  > "$evidence_dir/scene-configuration-export.log" 2>&1
npm run asset:scene:test > "$evidence_dir/scene-configuration-test.log" 2>&1
npm run asset:scene:validate > "$evidence_dir/scene-configuration-validation.log" 2>&1
node scripts/3d/validate-scene-configuration.mjs \
  > "$evidence_dir/scene-configuration-validation.json" \
  2> "$evidence_dir/scene-configuration-validation.error.log"

echo "Idempotently uploading the validated private 3D Scenes bundle with Entra authentication."
export ARES7_CONFIRM_SCENE_UPLOAD="upload-ares7-3d-scenes-bundle"
npm run azure:upload:scene > "$evidence_dir/scene-bundle-upload.log" 2>&1
unset ARES7_CONFIRM_SCENE_UPLOAD

az storage account show \
  --name "$storage_account_name" \
  --resource-group "$resource_group" \
  --subscription "$subscription_id" \
  --query '{name:name,allowBlobPublicAccess:allowBlobPublicAccess,allowSharedKeyAccess:allowSharedKeyAccess,defaultToOAuthAuthentication:defaultToOAuthAuthentication,minimumTlsVersion:minimumTlsVersion}' \
  --output json \
  --only-show-errors > "$evidence_dir/scene-storage-account.json"

az storage container show \
  --name ares7-3d-scenes \
  --account-name "$storage_account_name" \
  --auth-mode login \
  --subscription "$subscription_id" \
  --query '{name:name,publicAccess:properties.publicAccess,metadata:metadata}' \
  --output json \
  --only-show-errors > "$evidence_dir/scene-container.json"

az storage blob list \
  --container-name ares7-3d-scenes \
  --account-name "$storage_account_name" \
  --auth-mode login \
  --subscription "$subscription_id" \
  --query "[?name == 'ares7-habitat-segmented.glb' || name == '3DScenesConfiguration.json'].{name:name,contentType:properties.contentSettings.contentType,metadata:metadata}" \
  --output json \
  --only-show-errors > "$evidence_dir/scene-blobs.json"

python3 - \
  "$evidence_dir/scene-storage-account.json" \
  "$evidence_dir/scene-container.json" \
  "$evidence_dir/scene-blobs.json" <<'PY' || \
  die "The uploaded 3D Scenes bundle failed private-storage or digest verification."
import json
import re
import sys
account = json.load(open(sys.argv[1]))
container = json.load(open(sys.argv[2]))
blobs = json.load(open(sys.argv[3]))
if account.get("allowBlobPublicAccess") is not False:
    raise SystemExit(1)
if account.get("allowSharedKeyAccess") is not False:
    raise SystemExit(1)
if account.get("defaultToOAuthAuthentication") is not True:
    raise SystemExit(1)
if account.get("minimumTlsVersion") != "TLS1_2":
    raise SystemExit(1)
if container.get("name") != "ares7-3d-scenes" or container.get("publicAccess") not in (None, ""):
    raise SystemExit(1)
by_name = {item.get("name"): item for item in blobs}
expected_types = {
    "ares7-habitat-segmented.glb": "model/gltf-binary",
    "3DScenesConfiguration.json": "application/json",
}
if set(by_name) != set(expected_types):
    raise SystemExit(1)
for name, content_type in expected_types.items():
    item = by_name[name]
    if item.get("contentType") != content_type:
        raise SystemExit(1)
    if not re.fullmatch(r"[0-9a-f]{64}", str((item.get("metadata") or {}).get("sha256", ""))):
        raise SystemExit(1)
configuration_metadata = by_name["3DScenesConfiguration.json"].get("metadata") or {}
if (configuration_metadata.get("schemaVersion") or configuration_metadata.get("schemaversion")) != "v1.0.0":
    raise SystemExit(1)
PY

live_negotiate_url="https://${function_app_name}.azurewebsites.net/api/viewer/negotiate"
public_viewer_url="$(python3 - "$live_negotiate_url" <<'PY'
import sys
from urllib.parse import urlencode
base = "https://jarthurlabs.github.io/ARES-7-Mars-Habitat-Digital-Twin/"
print(f"{base}?{urlencode({'source': 'azure', 'negotiate': sys.argv[1]})}")
PY
)"
python3 - "$evidence_dir/live-viewer-endpoints.json" "$function_app_name" "$live_negotiate_url" "$public_viewer_url" <<'PY'
import json
import pathlib
import sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    "functionAppName": sys.argv[2],
    "negotiateEndpoint": sys.argv[3],
    "publicViewerUrl": sys.argv[4],
    "credentialFree": True,
    "grantOrWebSocketUrlIncluded": False,
}, indent=2) + "\n")
PY

echo "Installing the pinned headless Chromium build for browser evidence."
npx playwright install chromium --only-shell \
  > "$evidence_dir/playwright-browser-install.log" 2>&1

export ARES7_LIVE_NEGOTIATE_URL="$live_negotiate_url"
export ARES7_BROWSER_EVIDENCE_DIR="$evidence_dir/browser"
node scripts/capture-live-browser-evidence.mjs \
  > "$evidence_dir/live-browser-capture.log" 2>&1 &
browser_pid=$!

browser_ready="false"
for _attempt in $(seq 1 240); do
  if [[ -s "$evidence_dir/browser/browser-ready.json" ]]; then
    browser_ready="true"
    break
  fi
  kill -0 "$browser_pid" 2>/dev/null || break
  sleep 0.5
done
[[ "$browser_ready" == "true" ]] || \
  die "The read-only portfolio viewer did not reach browser-ready state within 120 seconds."

cat > "$run_root/live-viewer-listener.mjs" <<'NODE'
import { writeFile } from "node:fs/promises";

const [negotiateUrl, runId, outputPath, readyPath] = process.argv.slice(2);
const response = await fetch(negotiateUrl, {
  headers: { Origin: "https://jarthurlabs.github.io" },
});
if (!response.ok) throw new Error(`negotiate failed with HTTP ${response.status}`);
const grant = await response.json();
if (
  grant.permissions !== "receive-only" ||
  typeof grant.url !== "string" ||
  !grant.url.startsWith("wss://")
) {
  throw new Error("negotiate response was not a receive-only Web PubSub grant");
}

const messages = [];
let completed = false;
let processing = Promise.resolve();
const socket = new WebSocket(grant.url, "json.webpubsub.azure.v1");

const persist = () =>
  writeFile(
    outputPath,
    `${JSON.stringify(
      {
        permissions: "receive-only",
        scenarioRunId: runId,
        messageCount: messages.length,
        messages,
      },
      null,
      2,
    )}\n`,
  );

const timeout = setTimeout(() => {
  processing = processing.then(async () => {
    await persist();
    process.exitCode = 2;
    socket.close(1000, "evidence timeout");
  });
}, 300_000);

socket.addEventListener("open", async () => {
  await writeFile(readyPath, `${new Date().toISOString()}\n`);
});

socket.addEventListener("message", (event) => {
  processing = processing.then(async () => {
    let envelope;
    try {
      envelope = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (envelope?.type !== "message" || envelope?.from !== "server") return;
    let payload = envelope.data;
    if (envelope.dataType !== "json") {
      try {
        payload = JSON.parse(String(envelope.data));
      } catch {
        return;
      }
    }
    if (
      payload?.source !== "azure-live" ||
      payload?.scenarioRunId !== runId ||
      !Number.isInteger(payload?.tick) ||
      typeof payload?.snapshotVersion !== "string" ||
      typeof payload?.controllerState !== "string"
    ) {
      return;
    }
    messages.push({
      source: "azure-live",
      actionId: payload.actionId,
      scenarioRunId: payload.scenarioRunId,
      tick: payload.tick,
      snapshotVersion: payload.snapshotVersion,
      controllerState: payload.controllerState,
      operatorDecision: payload.operatorDecision,
      action: payload.action,
      receivedAtUtc: new Date().toISOString(),
      transport: "Azure Web PubSub receive-only grant",
    });
    await persist();
    if (
      payload.tick === 11 &&
      payload.controllerState === "RESOLVED" &&
      payload.operatorDecision === "APPROVED"
    ) {
      completed = true;
      clearTimeout(timeout);
      socket.close(1000, "final ARES-7 state captured");
    }
  });
});

socket.addEventListener("error", () => {
  process.exitCode = 3;
});

socket.addEventListener("close", () => {
  clearTimeout(timeout);
  if (!completed && !process.exitCode) process.exitCode = 4;
});
NODE

node "$run_root/live-viewer-listener.mjs" \
  "$live_negotiate_url" \
  "$run_id" \
  "$evidence_dir/live-viewer-messages.json" \
  "$run_root/live-viewer-ready.txt" \
  > "$evidence_dir/live-viewer-listener.log" 2>&1 &
viewer_pid=$!

viewer_ready="false"
for _attempt in $(seq 1 60); do
  if [[ -s "$run_root/live-viewer-ready.txt" ]]; then
    viewer_ready="true"
    break
  fi
  kill -0 "$viewer_pid" 2>/dev/null || break
  sleep 0.5
done
[[ "$viewer_ready" == "true" ]] || \
  die "The receive-only Web PubSub viewer could not connect before telemetry started."

capture_control_twins() {
  local evidence_prefix="$1"
  local twin_id
  local capture_pid
  local failed="false"
  local -a capture_pids=()
  for twin_id in \
    ares7-module-lab \
    ares7-module-greenhouse \
    ares7-airlock-main \
    ares7-battery-alpha \
    ares7-life-support; do
    az dt twin show \
      --dt-name "$digital_twins_name" \
      --twin-id "$twin_id" \
      --subscription "$subscription_id" \
      --output json \
      --only-show-errors > "$evidence_dir/${evidence_prefix}-${twin_id}.json" &
    capture_pids+=("$!")
  done
  for capture_pid in "${capture_pids[@]}"; do
    wait "$capture_pid" || failed="true"
  done
  [[ "$failed" == "false" ]]
}

echo "Running twelve telemetry frames plus one exact duplicate."
export ARES7_CONFIRM_SCENARIO="run-ares7-simulator"
npm run azure:run:scenario > "$evidence_dir/scenario.log" 2>&1 &
scenario_pid=$!

export ARES7_CONFIRM_APPROVAL="approve-containment"
approval_requested="false"
pending_tick=""
for _attempt in $(seq 1 240); do
  az dt twin show \
    --dt-name "$digital_twins_name" \
    --twin-id ares7-habitat \
    --subscription "$subscription_id" \
    --output json \
    --only-show-errors > "$run_root/habitat-poll.json"
  IFS=$'\t' read -r pending_state pending_decision pending_run pending_tick_candidate < <(
    python3 - "$run_root/habitat-poll.json" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1]))
print("\t".join(str(data.get(key, "")) for key in (
    "operationalState", "operatorDecision", "scenarioRunId", "lastProcessedTick"
)))
PY
  )
  if [[ \
    "$pending_state" == "LIFE_SUPPORT_RISK" && \
    "$pending_decision" == "PENDING" && \
    "$pending_run" == "$run_id" && \
    "$pending_tick_candidate" == "4" \
  ]]; then
    pending_tick="$pending_tick_candidate"
    cp "$run_root/habitat-poll.json" "$evidence_dir/pending-habitat.json"
    capture_control_twins pending || \
      die "Could not capture every pending control twin before approval."
    python3 - "$evidence_dir" <<'PY' || die "Containment controls changed before human approval."
import json
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
expected = {
    "ares7-module-lab": {"isolated": False},
    "ares7-module-greenhouse": {"isolated": False},
    "ares7-airlock-main": {"sealed": False},
    "ares7-battery-alpha": {"nonCriticalLoadShed": False},
    "ares7-life-support": {"priorityMode": False},
}
for twin_id, values in expected.items():
    actual = json.loads((root / f"pending-{twin_id}.json").read_text())
    if any(actual.get(key) is not value for key, value in values.items()):
        raise SystemExit(1)
PY
    npm run azure:approve:containment > "$evidence_dir/approval-request.log" 2>&1
    approval_requested="true"
    break
  fi
  kill -0 "$scenario_pid" 2>/dev/null || break
  sleep 1
done

[[ "$approval_requested" == "true" ]] || \
  die "The scenario did not reach the exact tick-4 LIFE_SUPPORT_RISK/PENDING human gate."

same_tick_approval="false"
for _attempt in $(seq 1 20); do
  az dt twin show \
    --dt-name "$digital_twins_name" \
    --twin-id ares7-habitat \
    --subscription "$subscription_id" \
    --output json \
    --only-show-errors > "$run_root/approved-habitat-poll.json"
  IFS=$'\t' read -r approved_state approved_decision approved_tick action_source decision_id last_decision_id < <(
    python3 - "$run_root/approved-habitat-poll.json" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1]))
print("\t".join(str(data.get(key, "")) for key in (
    "operationalState", "operatorDecision", "lastProcessedTick",
    "lastActionSource", "decisionId", "lastDecisionId"
)))
PY
  )
  if [[ "$approved_tick" =~ ^[0-9]+$ ]] && [[ "$approved_tick" -gt "$pending_tick" ]]; then
    break
  fi
  if [[ \
    "$approved_state" == "CONTAINMENT" && \
    "$approved_decision" == "APPROVED" && \
    "$approved_tick" == "$pending_tick" && \
    "$action_source" == "approval" && \
    -n "$decision_id" && \
    "$last_decision_id" == "$decision_id" \
  ]]; then
    cp "$run_root/approved-habitat-poll.json" "$evidence_dir/approved-habitat.json"
    capture_control_twins approved || \
      die "Could not capture every approved control twin on the decision tick."
    python3 - "$evidence_dir" <<'PY' || die "Approved containment did not actuate every expected control."
import json
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
expected = {
    "ares7-module-lab": {"isolated": True},
    "ares7-module-greenhouse": {"isolated": True},
    "ares7-airlock-main": {"sealed": True},
    "ares7-battery-alpha": {"nonCriticalLoadShed": True},
    "ares7-life-support": {"priorityMode": True},
}
for twin_id, values in expected.items():
    actual = json.loads((root / f"approved-{twin_id}.json").read_text())
    if any(actual.get(key) is not value for key, value in values.items()):
        raise SystemExit(1)
PY
    same_tick_approval="true"
    break
  fi
  sleep 0.5
done

[[ "$same_tick_approval" == "true" ]] || \
  die "The approved containment action was not reconciled on the same committed tick."

wait "$scenario_pid"
scenario_pid=""
unset ARES7_CONFIRM_SCENARIO ARES7_CONFIRM_APPROVAL

wait "$viewer_pid"
viewer_pid=""

wait "$browser_pid"
browser_pid=""
unset ARES7_LIVE_NEGOTIATE_URL ARES7_BROWSER_EVIDENCE_DIR

echo "Running strict, convergent post-run cloud verification."
ARES7_VERIFY_STAGE="post-run" npm run azure:verify:live \
  > "$evidence_dir/post-run-cloud-verification.log" 2>&1

az dt twin show \
  --dt-name "$digital_twins_name" \
  --twin-id ares7-clock \
  --subscription "$subscription_id" \
  --query '{scenarioRunId:scenarioRunId,tick:tick,snapshotVersion:snapshotVersion,committedSnapshotId:committedSnapshotId,payloadHash:payloadHash}' \
  --output json \
  --only-show-errors > "$evidence_dir/clock.json"

az dt twin show \
  --dt-name "$digital_twins_name" \
  --twin-id ares7-habitat \
  --subscription "$subscription_id" \
  --query '{scenarioRunId:scenarioRunId,lastProcessedTick:lastProcessedTick,operationalState:operationalState,operatorDecision:operatorDecision,controllerAction:controllerAction,decisionId:decisionId,decisionScenarioRunId:decisionScenarioRunId,decisionTick:decisionTick,lastDecisionId:lastDecisionId,lastActionId:lastActionId,lastActionSource:lastActionSource,lastBroadcastActionId:lastBroadcastActionId}' \
  --output json \
  --only-show-errors > "$evidence_dir/habitat.json"

az dt twin query \
  --dt-name "$digital_twins_name" \
  --subscription "$subscription_id" \
  --query-command "SELECT T.\$dtId AS twinId, T.scenarioRunId AS scenarioRunId, T.tick AS tick, T.snapshotVersion AS snapshotVersion, T.payloadHash AS payloadHash FROM DIGITALTWINS T WHERE IS_OF_MODEL(T, 'dtmi:ares7:TelemetrySnapshot;2') AND T.scenarioRunId = '$run_id'" \
  --output json \
  --only-show-errors > "$evidence_dir/snapshots.json"

az dt model list \
  --dt-name "$digital_twins_name" \
  --subscription "$subscription_id" \
  --query '[].id' \
  --output json \
  --only-show-errors > "$evidence_dir/digital-twin-models.json"

for twin_id in \
  ares7-module-lab \
  ares7-module-greenhouse \
  ares7-airlock-main \
  ares7-battery-alpha \
  ares7-life-support; do
  az dt twin show \
    --dt-name "$digital_twins_name" \
    --twin-id "$twin_id" \
    --subscription "$subscription_id" \
    --output json \
    --only-show-errors > "$evidence_dir/final-${twin_id}.json"
done

az functionapp function list \
  --resource-group "$resource_group" \
  --name "$function_app_name" \
  --subscription "$subscription_id" \
  --query '[].name' \
  --output json \
  --only-show-errors > "$evidence_dir/deployed-functions.json"

az iot hub device-identity list \
  --hub-name "$iot_hub_name" \
  --resource-group "$resource_group" \
  --auth-type login \
  --subscription "$subscription_id" \
  --query '[].{deviceId:deviceId,status:status,authenticationType:authentication.type}' \
  --output json \
  --only-show-errors > "$evidence_dir/device-identities.json"

az eventgrid event-subscription list \
  --resource-group "$resource_group" \
  --subscription "$subscription_id" \
  --query '[].{name:name,provisioningState:provisioningState,deadLetterEndpoint:deadLetterDestination.endpointType,identityDeadLetterEndpoint:deadLetterWithResourceIdentity.deadLetterDestination.endpointType,eventTypes:filter.includedEventTypes,subjectBeginsWith:filter.subjectBeginsWith,subjectEndsWith:filter.subjectEndsWith,advancedFilters:filter.advancedFilters,maxDeliveryAttempts:retryPolicy.maxDeliveryAttempts,eventTimeToLiveInMinutes:retryPolicy.eventTimeToLiveInMinutes}' \
  --output json \
  --only-show-errors > "$evidence_dir/event-subscriptions.json"

python3 - "$evidence_dir/deployed-functions.json" "$evidence_dir/event-subscriptions.json" "$evidence_dir/device-identities.json" "$evidence_dir/digital-twin-models.json" <<'PY' || \
  die "The deployed Functions, Event Grid paths, device identity, or Digital Twins models failed strict evidence validation."
import json
import sys

functions = {str(name).split("/")[-1] for name in json.load(open(sys.argv[1]))}
if functions != {"ingestTelemetry", "emergencyController", "negotiateViewer"}:
    raise SystemExit(1)

subscriptions = json.load(open(sys.argv[2]))
by_name = {str(item.get("name", "")).split("/")[-1]: item for item in subscriptions}
required = {
    "ares7-device-telemetry-to-ingest",
    "ares7-twin-updates-to-controller",
}
if not required.issubset(by_name):
    raise SystemExit(1)
for name in required:
    item = by_name[name]
    if (
        item.get("provisioningState") != "Succeeded"
        or "StorageBlob" not in {
            item.get("deadLetterEndpoint"),
            item.get("identityDeadLetterEndpoint"),
        }
        or item.get("maxDeliveryAttempts") != 10
        or item.get("eventTimeToLiveInMinutes") != 60
    ):
        raise SystemExit(1)

device = by_name["ares7-device-telemetry-to-ingest"]
if (
    device.get("eventTypes") != ["Microsoft.Devices.DeviceTelemetry"]
    or device.get("subjectBeginsWith") != "devices/ares7-simulator"
    or device.get("subjectEndsWith") != "devices/ares7-simulator"
):
    raise SystemExit(1)

controller = by_name["ares7-twin-updates-to-controller"]
if controller.get("eventTypes") != ["Microsoft.DigitalTwins.Twin.Update"]:
    raise SystemExit(1)
filters = controller.get("advancedFilters") or []
if not any(
    item.get("key") == "Subject"
    and item.get("operatorType") == "StringIn"
    and sorted(item.get("values") or []) == ["ares7-clock", "ares7-habitat"]
    for item in filters
):
    raise SystemExit(1)

devices = json.load(open(sys.argv[3]))
if (
    len(devices) != 1
    or devices[0].get("deviceId") != "ares7-simulator"
    or str(devices[0].get("status", "")).lower() != "enabled"
    or devices[0].get("authenticationType") != "sas"
):
    raise SystemExit(1)

models = json.load(open(sys.argv[4]))
if not isinstance(models, list) or len(models) != 9 or len(set(models)) != 9:
    raise SystemExit(1)
PY

mapfile -t application_insights_names < <(
  az resource list \
    --resource-group "$resource_group" \
    --subscription "$subscription_id" \
    --resource-type Microsoft.Insights/components \
    --query '[].name' \
    --output tsv \
    --only-show-errors
)
[[ "${#application_insights_names[@]}" -eq 1 ]] || \
  die "Expected exactly one ARES-7 Application Insights component; found ${#application_insights_names[@]}."
application_insights_name="${application_insights_names[0]}"

trace_proof="false"
for _attempt in $(seq 1 12); do
  if az monitor app-insights query \
    --app "$application_insights_name" \
    --resource-group "$resource_group" \
    --subscription "$subscription_id" \
    --analytics-query "traces | where timestamp > ago(1h) | where message contains '$run_id' | project timestamp, message | order by timestamp asc" \
    --output json \
    --only-show-errors > "$evidence_dir/function-traces.json" 2> "$evidence_dir/function-traces.error.log"; then
    if python3 - "$evidence_dir/function-traces.json" "$run_id" <<'PY'
import json
import sys
text = json.dumps(json.load(open(sys.argv[1])))
run_id = sys.argv[2]
ok = (
    f"duplicate run={run_id} tick=11" in text
    and " approval state=CONTAINMENT " in text
    and f"run={run_id} tick=4" in text
)
raise SystemExit(0 if ok else 1)
PY
    then
      trace_proof="true"
      break
    fi
  fi
  sleep 10
done
python3 - "$evidence_dir/trace-evidence-status.json" "$trace_proof" <<'PY'
import json
import pathlib
import sys
observed = sys.argv[2] == "true"
pathlib.Path(sys.argv[1]).write_text(json.dumps({
    "status": "observed" if observed else "supplemental traces unavailable or sampled during bounded polling",
    "duplicateAndApprovalTraceObserved": observed,
    "requiredForLiveVerdict": False,
}, indent=2) + "\n")
PY
if [[ ! -s "$evidence_dir/function-traces.json" ]]; then
  printf '%s\n' '{"status":"no trace query payload returned"}' \
    > "$evidence_dir/function-traces.json"
fi

az resource list \
  --subscription "$subscription_id" \
  --tag project=ARES-7 \
  --query '[].{name:name,type:type,resourceGroup:resourceGroup,location:location,kind:kind,sku:sku.name,tags:tags}' \
  --output json \
  --only-show-errors > "$evidence_dir/ares-tagged-resources-after.json"

python3 - "$evidence_dir/ares-tagged-resources-after.json" "$resource_group" <<'PY' || \
  die "Post-run scope verification found an ARES-7-tagged resource outside the exact target group."
import json
import sys
resources = json.load(open(sys.argv[1]))
expected = sys.argv[2].lower()
outside = [item for item in resources if str(item.get("resourceGroup", "")).lower() != expected]
raise SystemExit(0 if not outside else 1)
PY

python3 - "$evidence_dir/ares-tagged-resources-after.json" <<'PY' || \
  die "The deployed ARES-7 SKU boundary drifted from the reviewed free/consumption configuration."
import json
import sys
resources = json.load(open(sys.argv[1]))

def exactly_one(resource_type, sku):
    matches = [item for item in resources if str(item.get("type", "")).lower() == resource_type.lower()]
    return len(matches) == 1 and matches[0].get("sku") == sku

ok = (
    exactly_one("Microsoft.Devices/IotHubs", "F1")
    and exactly_one("Microsoft.SignalRService/webPubSub", "Free_F1")
    and exactly_one("Microsoft.Storage/storageAccounts", "Standard_LRS")
    and exactly_one("Microsoft.Web/serverfarms", "FC1")
)
forbidden_prefixes = (
    "microsoft.compute/",
    "microsoft.containerservice/",
    "microsoft.kubernetes/",
    "microsoft.documentdb/",
    "microsoft.kusto/",
)
if any(str(item.get("type", "")).lower().startswith(forbidden_prefixes) for item in resources):
    ok = False
raise SystemExit(0 if ok else 1)
PY

capture_cost \
  "$evidence_dir/cost-after-raw.json" \
  "$evidence_dir/cost-after.json"

python3 - "$evidence_dir/cost-after.json" "$max_spend_usd" <<'PY' || \
  die "The captured ARES-7 resource-group cost exceeds the 10 USD workflow ceiling."
import json
import sys
cost = json.load(open(sys.argv[1]))
amount = cost.get("amount")
currency = str(cost.get("currency") or "").upper()
limit = float(sys.argv[2])
raise SystemExit(1 if currency == "USD" and isinstance(amount, (int, float)) and amount > limit else 0)
PY

python3 - "$evidence_dir" "$run_id" "$repository_commit" "$run_started_utc" "$evidence_archive" <<'PY'
import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
run_id = sys.argv[2]
repository_commit = sys.argv[3]
run_started_utc = sys.argv[4]
evidence_archive = sys.argv[5]

def load(name):
    return json.loads((root / name).read_text())

clock = load("clock.json")
habitat = load("habitat.json")
viewer = load("live-viewer-messages.json")
viewer_endpoints = load("live-viewer-endpoints.json")
browser_state = load("browser/browser-state.json")
snapshots = load("snapshots.json")
models = load("digital-twin-models.json")
devices = load("device-identities.json")
event_subscriptions = load("event-subscriptions.json")
tagged_resources = load("ares-tagged-resources-after.json")
scene_validation = load("scene-configuration-validation.json")
scene_storage = load("scene-storage-account.json")
scene_container = load("scene-container.json")
scene_blobs = load("scene-blobs.json")
pending_habitat = load("pending-habitat.json")
approved_habitat = load("approved-habitat.json")
cost_before = load("cost-before.json")
cost_after = load("cost-after.json")

pending_controls = {}
approved_controls = {}
for twin_id, fields in {
    "ares7-module-lab": ("isolated",),
    "ares7-module-greenhouse": ("isolated",),
    "ares7-airlock-main": ("sealed",),
    "ares7-battery-alpha": ("nonCriticalLoadShed",),
    "ares7-life-support": ("priorityMode",),
}.items():
    pending = load(f"pending-{twin_id}.json")
    approved = load(f"approved-{twin_id}.json")
    pending_controls[twin_id] = {field: pending.get(field) for field in fields}
    approved_controls[twin_id] = {field: approved.get(field) for field in fields}

scenario_text = (root / "scenario.log").read_text(errors="replace")
sent_ticks = [int(value) for value in re.findall(r"^sent tick=(\d+)", scenario_text, re.MULTILINE)]
snapshot_ticks = sorted(item.get("tick") for item in snapshots)
snapshot_hashes = [item.get("payloadHash") for item in snapshots]
messages = viewer.get("messages") if isinstance(viewer, dict) else None
last_viewer = messages[-1] if messages else {}
trace_text = json.dumps(load("function-traces.json"))
trace_status = load("trace-evidence-status.json")
browser_video_path = pathlib.Path((root / "browser/browser-video-path.txt").read_text().strip())
try:
    browser_video_relative = str(browser_video_path.relative_to(root))
except ValueError:
    browser_video_relative = ""

checks = {
    "repositoryCommitReviewed": bool(re.fullmatch(r"[0-9a-f]{40}", repository_commit, re.IGNORECASE)),
    "deploymentBoundaryValidated": (
        len(models) == 9
        and len(devices) == 1
        and devices[0].get("deviceId") == "ares7-simulator"
        and str(devices[0].get("status", "")).lower() == "enabled"
        and devices[0].get("authenticationType") == "sas"
        and {
            "ares7-device-telemetry-to-ingest",
            "ares7-twin-updates-to-controller",
        }.issubset({str(item.get("name", "")).split("/")[-1] for item in event_subscriptions})
    ),
    "scenarioRunIdIsUuid": bool(re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
        run_id,
        re.IGNORECASE,
    )),
    "twelveOrderedImmutableSnapshots": (
        isinstance(snapshots, list)
        and len(snapshots) == 12
        and snapshot_ticks == list(range(12))
        and all(item.get("scenarioRunId") == run_id for item in snapshots)
        and len(set(snapshot_hashes)) == 12
    ),
    "thirteenSimulatorDeliveries": (
        len(sent_ticks) == 13
        and all(sent_ticks.count(tick) == (2 if tick == 11 else 1) for tick in range(12))
        and f"resent exact duplicate tick=11 scenarioRunId={run_id}" in scenario_text
    ),
    "exactDuplicateIgnored": (
        len(sent_ticks) == 13
        and sent_ticks.count(11) == 2
        and f"resent exact duplicate tick=11 scenarioRunId={run_id}" in scenario_text
        and len(snapshots) == 12
        and snapshot_ticks == list(range(12))
        and len(set(snapshot_hashes)) == 12
    ),
    "pendingGateAtTickFour": (
        pending_habitat.get("scenarioRunId") == run_id
        and pending_habitat.get("lastProcessedTick") == 4
        and pending_habitat.get("operationalState") == "LIFE_SUPPORT_RISK"
        and pending_habitat.get("operatorDecision") == "PENDING"
    ),
    "pendingControlsRemainFalse": all(
        value is False
        for controls in pending_controls.values()
        for value in controls.values()
    ),
    "approvalReconciledOnSameTick": (
        approved_habitat.get("scenarioRunId") == run_id
        and approved_habitat.get("lastProcessedTick") == pending_habitat.get("lastProcessedTick") == 4
        and approved_habitat.get("operationalState") == "CONTAINMENT"
        and approved_habitat.get("operatorDecision") == "APPROVED"
        and approved_habitat.get("lastActionSource") == "approval"
        and approved_habitat.get("decisionScenarioRunId") == run_id
        and approved_habitat.get("decisionTick") == 4
        and approved_habitat.get("lastDecisionId") == approved_habitat.get("decisionId")
        and approved_habitat.get("lastActionId")
            == f"{run_id}:tick:4:decision:{approved_habitat.get('decisionId')}"
    ),
    "approvedControlsBecomeTrue": all(
        value is True
        for controls in approved_controls.values()
        for value in controls.values()
    ),
    "finalStateResolved": (
        clock.get("scenarioRunId") == run_id
        and clock.get("tick") == 11
        and habitat.get("scenarioRunId") == run_id
        and habitat.get("lastProcessedTick") == 11
        and habitat.get("operationalState") == "RESOLVED"
        and habitat.get("operatorDecision") == "APPROVED"
        and habitat.get("controllerAction") == "MONITOR_POST_INCIDENT"
        and habitat.get("decisionScenarioRunId") == run_id
        and habitat.get("decisionTick") == 4
        and habitat.get("lastDecisionId") == habitat.get("decisionId")
    ),
    "finalBroadcastReconciled": (
        isinstance(habitat.get("lastActionId"), str)
        and habitat.get("lastActionId") == habitat.get("lastBroadcastActionId")
    ),
    "receiveOnlyViewerCapturedFinalState": (
        viewer.get("permissions") == "receive-only"
        and isinstance(messages, list)
        and len(messages) > 0
        and last_viewer.get("scenarioRunId") == run_id
        and last_viewer.get("tick") == 11
        and last_viewer.get("controllerState") == "RESOLVED"
        and last_viewer.get("operatorDecision") == "APPROVED"
    ),
    "portfolioBrowserCapturedFinalState": (
        browser_state.get("dataSource") == "AZURE LIVE · READ ONLY"
        and browser_state.get("scenarioRunId") == run_id
        and browser_state.get("tick") == "11"
        and browser_state.get("controllerState") == "RESOLVED"
        and (root / "browser/azure-live-first-update.png").is_file()
        and (root / "browser/azure-live-final-resolved.png").is_file()
        and bool(browser_video_relative)
        and browser_video_path.is_file()
    ),
    "private3DScenesBundleUploaded": (
        scene_validation.get("schemaVersion") == "v1.0.0"
        and scene_validation.get("elementCount") == 10
        and scene_validation.get("behaviorCount") == 4
        and scene_validation.get("layerCount") == 1
        and scene_storage.get("allowBlobPublicAccess") is False
        and scene_storage.get("allowSharedKeyAccess") is False
        and scene_storage.get("defaultToOAuthAuthentication") is True
        and scene_storage.get("minimumTlsVersion") == "TLS1_2"
        and scene_container.get("publicAccess") in (None, "")
        and {item.get("name") for item in scene_blobs}
            == {"ares7-habitat-segmented.glb", "3DScenesConfiguration.json"}
    ),
    "cleanupExcluded": True,
}

failed = [name for name, passed in checks.items() if not passed]
summary = {
    "status": "ARES7_LIVE_EVIDENCE_COMPLETE" if not failed else "ARES7_LIVE_EVIDENCE_FAILED",
    "repositoryCommit": repository_commit,
    "scenarioRunId": run_id,
    "runStartedUtc": run_started_utc,
    "runCompletedUtc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "checks": checks,
    "failedChecks": failed,
    "deliveriesSent": len(sent_ticks),
    "immutableSnapshots": len(snapshots),
    "snapshotTicks": snapshot_ticks,
    "deployment": {
        "digitalTwinModelCount": len(models),
        "deviceIdentities": devices,
        "eventSubscriptionNames": sorted(
            str(item.get("name", "")).split("/")[-1] for item in event_subscriptions
        ),
        "taggedResourceCount": len(tagged_resources),
        "skus": sorted(
            [
                {
                    "type": item.get("type"),
                    "name": item.get("name"),
                    "sku": item.get("sku"),
                }
                for item in tagged_resources
                if item.get("sku")
            ],
            key=lambda item: (str(item["type"]), str(item["name"])),
        ),
    },
    "pendingGate": {
        "tick": pending_habitat.get("lastProcessedTick"),
        "operationalState": pending_habitat.get("operationalState"),
        "operatorDecision": pending_habitat.get("operatorDecision"),
        "controls": pending_controls,
    },
    "sameTickApproval": {
        "tick": approved_habitat.get("lastProcessedTick"),
        "operationalState": approved_habitat.get("operationalState"),
        "operatorDecision": approved_habitat.get("operatorDecision"),
        "controls": approved_controls,
    },
    "clock": clock,
    "habitat": habitat,
    "viewer": {
        "permissions": viewer.get("permissions"),
        "messageCount": viewer.get("messageCount"),
        "finalMessage": last_viewer,
    },
    "browserProof": {
        "functionAppName": viewer_endpoints.get("functionAppName"),
        "negotiateEndpoint": viewer_endpoints.get("negotiateEndpoint"),
        "publicViewerUrl": viewer_endpoints.get("publicViewerUrl"),
        "state": browser_state,
        "firstUpdateScreenshot": "browser/azure-live-first-update.png",
        "finalResolvedScreenshot": "browser/azure-live-final-resolved.png",
        "video": browser_video_relative,
        "grantOrWebSocketUrlIncluded": False,
    },
    "sceneBundle": {
        "status": "validated private bundle uploaded; Studio UI rendering remains provisional",
        "schemaVersion": scene_validation.get("schemaVersion"),
        "schemaSha256": scene_validation.get("schemaSha256"),
        "sceneId": scene_validation.get("sceneId"),
        "assetUrl": scene_validation.get("assetUrl"),
        "elementCount": scene_validation.get("elementCount"),
        "behaviorCount": scene_validation.get("behaviorCount"),
        "layerCount": scene_validation.get("layerCount"),
        "storageAccountName": scene_storage.get("name"),
        "container": scene_container.get("name"),
        "publicAccess": scene_container.get("publicAccess"),
        "blobs": scene_blobs,
        "studioUiVerified": False,
    },
    "supplementalTraceEvidence": {
        **trace_status,
        "duplicateTraceObserved": f"duplicate run={run_id} tick=11" in trace_text,
        "sameTickApprovalTraceObserved": (
            " approval state=CONTAINMENT " in trace_text
            and f"run={run_id} tick=4" in trace_text
        ),
    },
    "costBefore": cost_before,
    "costAfter": cost_after,
    "declaredMaximumSpendUsd": 10,
    "cleanupPerformed": False,
    "evidenceArchive": pathlib.Path(evidence_archive).name,
}
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print("\n=== COPY THIS REDACTED RESULT BACK TO CHATGPT ===")
print(json.dumps(summary, indent=2))
print("=== END REDACTED RESULT ===")
if failed:
    raise SystemExit(1)
PY

echo "Live evidence is complete. Cleanup was intentionally excluded and still requires separate confirmation."
