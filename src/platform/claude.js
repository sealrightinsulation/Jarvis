// Thin, defensive access to the claude.ai artifact runtime.
// Every capability can be absent (page opened outside a viewer, not granted, older app).
// `cap(name)` resolves the namespace or null and never throws.

const memo = new Map();

export function cap(name) {
  if (memo.has(name)) return memo.get(name);
  const p = (async () => {
    try {
      const use = globalThis.claude && globalThis.claude.use;
      if (typeof use !== 'function') return null;
      const ns = await use.call(globalThis.claude, name);
      return ns ?? null;
    } catch {
      return null;
    }
  })();
  memo.set(name, p);
  return p;
}

/** Read one permission state without prompting. Never rejects. */
export async function permissionState(name) {
  const perms = await cap('permissions');
  if (!perms) return 'unavailable';
  try {
    return await perms.state(name);
  } catch {
    return 'unavailable';
  }
}

/** Ask for several permissions in one dialog. Never rejects; returns {} when unavailable. */
export async function requestPermissions(names) {
  const perms = await cap('permissions');
  if (!perms) return {};
  try {
    return (await perms.request(names)) || {};
  } catch {
    return {};
  }
}

/** Open the platform's Permissions panel (only from a click). Resolves false if it could not open. */
export async function managePermissions() {
  const perms = await cap('permissions');
  if (!perms) return false;
  try {
    await perms.manage();
    return true;
  } catch {
    return false;
  }
}
