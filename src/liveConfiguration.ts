const azureFunctionHost = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?\.azurewebsites\.net$/i;

export function negotiateOverrideFromSearch(search: string): string | undefined {
  const raw = new URLSearchParams(search).get("negotiate");
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The live negotiate override is not a valid URL");
  }
  if (
    url.protocol !== "https:" ||
    !azureFunctionHost.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== "/api/viewer/negotiate"
  ) {
    throw new Error(
      "The live negotiate override must be an HTTPS azurewebsites.net Function endpoint",
    );
  }
  return url.toString();
}
