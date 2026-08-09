export const connectedReadOnlyLabel = "AZURE LIVE · READ ONLY";

export function hasConnectedReadOnlySemanticState(documentLike) {
  const label = documentLike.querySelector("#data-source-label");
  const connectionChip = documentLike.querySelector("#connection-chip");

  return (
    label?.textContent === connectedReadOnlyLabel &&
    connectionChip?.getAttribute("data-source") === "live"
  );
}

// Keep this function self-contained: Playwright serializes it into the browser
// page, where module-scope bindings do not exist.
export function isConnectedReadOnlyViewerReady(documentLike = document) {
  const label = documentLike.querySelector("#data-source-label");
  const connectionChip = documentLike.querySelector("#connection-chip");
  if (
    label?.textContent !== "AZURE LIVE · READ ONLY" ||
    connectionChip?.getAttribute("data-source") !== "live"
  ) {
    return false;
  }

  const viewportWidth = Number(documentLike.defaultView?.innerWidth ?? 0);
  const viewportHeight = Number(documentLike.defaultView?.innerHeight ?? 0);
  const isRenderedInViewport = (element) => {
    const rectangle = element.getBoundingClientRect();
    return (
      rectangle.width > 0 &&
      rectangle.height > 0 &&
      rectangle.right > 0 &&
      rectangle.bottom > 0 &&
      rectangle.left < viewportWidth &&
      rectangle.top < viewportHeight
    );
  };

  return isRenderedInViewport(label) && isRenderedInViewport(connectionChip);
}
