import axe from "axe-core";

/**
 * Accessibility rules that fail, as one readable line each, for an
 * `expect(...).toEqual([])`. Two rules are left out. Color contrast: a DOM
 * without a layout engine cannot compute it, and the tokens are checked by
 * hand. Landmarks: a component rendered on its own sits outside the app's
 * <main>, which says nothing about the component.
 */
export async function axeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  return results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
}
