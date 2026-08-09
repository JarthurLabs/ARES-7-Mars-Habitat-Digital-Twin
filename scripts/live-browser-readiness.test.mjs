import assert from "node:assert/strict";
import test from "node:test";
import {
  connectedReadOnlyLabel,
  hasConnectedReadOnlySemanticState,
  isConnectedReadOnlyViewerReady,
} from "./live-browser-readiness.mjs";

function documentState({
  label = connectedReadOnlyLabel,
  source = "live",
  hidden = false,
  outsideViewport = false,
} = {}) {
  const visibleRectangle = outsideViewport
    ? { bottom: 912, height: 12, left: 1700, right: 1820, top: 900, width: 120 }
    : { bottom: 54, height: 12, left: 1380, right: 1500, top: 42, width: 120 };
  const hiddenRectangle = {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
  };
  const labelElement = {
    getBoundingClientRect: () => (hidden ? hiddenRectangle : visibleRectangle),
    hidden,
    style: { display: hidden ? "none" : "block" },
    textContent: label,
  };
  const connectionChip = {
    getBoundingClientRect: () => ({
      bottom: 66,
      height: 66,
      left: 1360,
      right: 1520,
      top: 0,
      width: 160,
    }),
    getAttribute(name) {
      return name === "data-source" ? source : null;
    },
  };

  return {
    defaultView: { innerHeight: 900, innerWidth: 1600 },
    querySelector(selector) {
      if (selector === "#data-source-label") return labelElement;
      if (selector === "#connection-chip") return connectionChip;
      return null;
    },
  };
}

test("accepts the exact semantic state but does not declare hidden text browser-ready", () => {
  assert.equal(
    hasConnectedReadOnlySemanticState(documentState({ hidden: true })),
    true,
  );
  assert.equal(isConnectedReadOnlyViewerReady(documentState({ hidden: true })), false);
});

test("accepts only the exact rendered, in-viewport live read-only contract", () => {
  assert.equal(isConnectedReadOnlyViewerReady(documentState()), true);
  assert.equal(
    isConnectedReadOnlyViewerReady(
      documentState({ label: "AZURE · CONNECTING", source: "live" }),
    ),
    false,
  );
  assert.equal(
    isConnectedReadOnlyViewerReady(
      documentState({ label: connectedReadOnlyLabel, source: "connecting" }),
    ),
    false,
  );
  assert.equal(
    isConnectedReadOnlyViewerReady(
      documentState({ label: `${connectedReadOnlyLabel} `, source: "live" }),
    ),
    false,
  );
  assert.equal(
    isConnectedReadOnlyViewerReady({
      defaultView: { innerHeight: 900, innerWidth: 1600 },
      querySelector: () => null,
    }),
    false,
  );
  assert.equal(
    isConnectedReadOnlyViewerReady(documentState({ outsideViewport: true })),
    false,
  );
});

test("the Playwright readiness predicate has no module closure dependency", () => {
  const serialized = isConnectedReadOnlyViewerReady.toString();
  assert.doesNotMatch(serialized, /connectedReadOnlyLabel|hasConnectedReadOnlySemanticState/);
  const revived = (0, eval)(`(${serialized})`);
  assert.equal(revived(documentState()), true);
  assert.equal(revived(documentState({ hidden: true })), false);
});
