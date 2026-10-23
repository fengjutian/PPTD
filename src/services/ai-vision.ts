import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Per-session cache of the visual-review capability probe.
 *
 * The probe sends one small image, so it must not run on every generation.
 * A `false` answer is a property of the provider + model pair, not of the
 * document, and stays valid until the app restarts or the settings change.
 */
const cache = new Map<string, Promise<boolean>>();

/**
 * Whether the selected model accepts image input.
 *
 * The backend distinguishes a capability rejection (`false`) from a failed
 * probe (`Err`). A network or key failure must not silently turn visual review
 * off for the rest of the session, so a rejected probe resolves to `true` and
 * lets the actual review report its own failure.
 */
export function probeVisionCapability(providerId: string, model: string): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  const key = `${providerId}:${model}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = invoke<boolean>("probe_vision_capability", { providerId, model }).catch(() => true);
    cache.set(key, pending);
  }
  return pending;
}

/** Drops cached answers, e.g. after the user changes the API key. */
export function clearVisionCapabilityCache(): void {
  cache.clear();
}
