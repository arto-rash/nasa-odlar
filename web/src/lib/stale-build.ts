/** After a deploy, a tab opened on the old build asks for script files that no
 *  longer exist (or hits the few seconds the server restarts). Navigation then
 *  fails; a fresh load of the page fixes it. These helpers spot that case and
 *  reload once, instead of leaving the reader on an error screen. */

const KEY = "odlar-reloaded-at";
const PATTERN =
  /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Failed to fetch|NetworkError|Load failed|Connection closed|fetch failed|server components render/i;

export function isStaleBuildError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || PATTERN.test(`${error.name} ${error.message}`);
}

/** Reloads the page unless it already did so in the last 30 seconds (no loops
 *  when the server really is down). Returns whether it reloaded. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // storage blocked: still reload, the browser's own history guards against loops
  }
  window.location.reload();
  return true;
}
