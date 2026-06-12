/**
 * Compute effective modules for the current member.
 * - If allowedModules is null/undefined: return workspace modules exactly as-is (owner/assistant sees everything)
 * - If allowedModules is set: return only the keys that are true in allowedModules, everything else false
 */
export function getEffectiveModules(
  modules: Record<string, boolean> | null | undefined,
  allowedModules: Record<string, boolean> | null | undefined,
): Record<string, boolean> | null {
  // No member restrictions → workspace modules pass through unchanged
  if (allowedModules === null || allowedModules === undefined) {
    return modules ?? null;
  }
  // Member has restrictions → only show modules explicitly allowed
  // Keys NOT in allowedModules are set to false so sidebar hides them
  const effective: Record<string, boolean> = {};
  // Start with all known module keys set to false
  if (modules) {
    for (const key of Object.keys(modules)) {
      effective[key] = false;
    }
  }
  // Enable only modules that are true in allowedModules (and not disabled at workspace level)
  for (const [key, val] of Object.entries(allowedModules)) {
    if (val) {
      effective[key] = modules ? modules[key] !== false : true;
    } else {
      effective[key] = false;
    }
  }
  return effective;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModuleValue = boolean | { enabled: boolean; [key: string]: any };

/**
 * Check if a user has a specific sub-permission within a module.
 * Handles both legacy format (module: true) and nested format (module: { enabled: true, sub: true }).
 * If the module value is `true` (legacy), all sub-permissions are considered granted.
 * If the module value is an object, checks the specific sub-permission key.
 */
export function hasSubPermission(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allowedModules: Record<string, any> | null | undefined,
  moduleKey: string,
  subPermission: string,
): boolean {
  if (!allowedModules) return false;
  const val: ModuleValue | undefined = allowedModules[moduleKey];
  if (val === undefined || val === false) return false;
  // Legacy: module is just `true` → all sub-permissions granted
  if (val === true) return true;
  // Nested object: check if the module is enabled AND the sub-permission is true
  if (typeof val === 'object' && val.enabled) {
    return val[subPermission] !== false; // default to true if not explicitly set
  }
  return false;
}

/**
 * Check if a module is enabled, supporting both boolean and object formats.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isModuleEnabled(allowedModules: Record<string, any> | null | undefined, moduleKey: string): boolean {
  if (!allowedModules) return false;
  const val = allowedModules[moduleKey];
  if (val === true) return true;
  if (typeof val === 'object' && val?.enabled) return true;
  return false;
}
