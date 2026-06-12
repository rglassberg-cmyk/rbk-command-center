// Centralized registry of in-development features behind the testing
// flag system. Adding a feature here makes it appear in the admin
// permissions page's "🧪 Testing & Preview" section so Becca can grant
// individual users access without flipping any other module
// permissions. Removing a feature from this array hides it from the
// admin UI but does NOT clear the array values stored on
// workspace_members.testing_features — those remain until explicitly
// removed (intentional: leftover keys are harmless and let us re-add
// a feature later without losing existing grants).

export interface TestingFeature {
  /** Stable key stored in workspace_members.testing_features. */
  key: string;
  /** Which dashboard module this feature lives under (drives the
   *  grouping in the admin UI). */
  module: string;
  /** Human-readable label shown next to the checkbox. */
  label: string;
  /** Short description shown muted below the label. */
  description: string;
}

export const TESTING_FEATURES: TestingFeature[] = [
  {
    key: 'development_overview',
    module: 'development',
    label: 'Development Overview Tab',
    description: 'Segment giving, YoY comparison, lapsed donors — being validated with development team',
  },
  // Add new test features here as they are built.
];

export function getTestingFeaturesForModule(module: string): TestingFeature[] {
  return TESTING_FEATURES.filter(f => f.module === module);
}

// Visibility check used by gated components. A feature is visible when
// either (a) the user has an explicit per-user grant in
// workspace_members.testing_features, or (b) the feature has been
// promoted workspace-wide via workspaces.promoted_features.
//
// Promoting moves a flag from "Becca's preview list" to "all users with
// the relevant module access" without changing any component code or
// per-user grants. Demoting reverses the promotion in one click.
export function canSeeTestingFeature(
  key: string,
  testingFeatures: string[] | null | undefined,
  promotedFeatures: string[] | null | undefined,
): boolean {
  return (
    (Array.isArray(testingFeatures) && testingFeatures.includes(key)) ||
    (Array.isArray(promotedFeatures) && promotedFeatures.includes(key))
  );
}
