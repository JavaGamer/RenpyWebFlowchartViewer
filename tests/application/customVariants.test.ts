import { beforeEach, describe, expect, it } from "vitest";
import { useParserRuleSettingsStore } from "../../src/application/parserRuleSettingsStore.ts";
import {
  getParserVariantPlugin,
  isParserVariant,
} from "../../src/config/parserRules.ts";

describe("Custom Variants Application Slice", () => {
  beforeEach(() => {
    useParserRuleSettingsStore.setState({
      selectedVariant: "auto",
      customVariants: [],
      customRulesByVariant: {},
    });
  });

  it("adds, retrieves, and validates a custom variant", () => {
    const store = useParserRuleSettingsStore.getState();

    store.addCustomVariant({
      id: "my-mod-framework",
      label: "My Mod Framework",
      description: "Custom Ren'Py framework with custom branch statements.",
      stagingKeywords: ["superglitch", "warpzone"],
      branchStatements: [
        {
          pattern: "^\\s*warp_to\\s+([A-Za-z0-9_]+)",
          branchKind: "jump",
          targetGroup: 1,
        },
      ],
      screenActionRules: [
        { actionName: "WarpAction", actionKind: "jump" },
      ],
    });

    const updated = useParserRuleSettingsStore.getState();
    expect(updated.customVariants.length).toBe(1);
    expect(updated.customVariants[0].id).toBe("my-mod-framework");

    expect(isParserVariant("my-mod-framework")).toBe(true);
    const plugin = getParserVariantPlugin("my-mod-framework");
    expect(plugin.label).toBe("My Mod Framework");
    expect(plugin.isCustom).toBe(true);
    expect(plugin.stagingKeywords).toContain("superglitch");
    expect(plugin.stagingKeywords).toContain("warpzone");
    expect(plugin.branchStatements?.length).toBe(1);
    expect(
      plugin.defaultScreenActionRules.some((r) =>
        r.actionName === "WarpAction"
      ),
    ).toBe(true);
  });

  it("updates an existing custom variant", () => {
    const store = useParserRuleSettingsStore.getState();

    store.addCustomVariant({
      id: "test-update",
      label: "Original Label",
    });

    store.updateCustomVariant("test-update", {
      label: "Updated Label",
      stagingKeywords: ["newkeyword"],
    });

    const plugin = getParserVariantPlugin("test-update");
    expect(plugin.label).toBe("Updated Label");
    expect(plugin.stagingKeywords).toContain("newkeyword");
  });

  it("removes a custom variant and resets selected variant if active", () => {
    const store = useParserRuleSettingsStore.getState();

    store.addCustomVariant({
      id: "to-delete",
      label: "To Delete",
    });

    store.setSelectedVariant("to-delete");
    expect(useParserRuleSettingsStore.getState().selectedVariant).toBe(
      "to-delete",
    );

    store.removeCustomVariant("to-delete");

    const state = useParserRuleSettingsStore.getState();
    expect(state.customVariants.some((v) => v.id === "to-delete")).toBe(false);
    expect(state.selectedVariant).toBe("auto");
    expect(isParserVariant("to-delete")).toBe(false);
  });

  it("exports and imports custom variant JSON", () => {
    const store = useParserRuleSettingsStore.getState();

    store.addCustomVariant({
      id: "exportable",
      label: "Exportable Variant",
      description: "For community sharing",
      stagingKeywords: ["portal"],
    });

    const exported = store.exportCustomVariant("exportable");
    expect(typeof exported).toBe("string");
    const parsed = JSON.parse(exported);
    expect(parsed.id).toBe("exportable");
    expect(parsed.label).toBe("Exportable Variant");

    // Remove it
    store.removeCustomVariant("exportable");
    expect(isParserVariant("exportable")).toBe(false);

    // Import it back
    const result = store.importCustomVariant(exported);
    expect(result.success).toBe(true);
    expect(result.id).toBe("exportable");

    const reimported = getParserVariantPlugin("exportable");
    expect(reimported.label).toBe("Exportable Variant");
    expect(reimported.stagingKeywords).toContain("portal");
  });

  it("fails gracefully on invalid JSON import", () => {
    const store = useParserRuleSettingsStore.getState();

    const badJson = "{ not-valid-json";
    const res1 = store.importCustomVariant(badJson);
    expect(res1.success).toBe(false);

    const missingFields = JSON.stringify({ description: "Missing id/label" });
    const res2 = store.importCustomVariant(missingFields);
    expect(res2.success).toBe(false);

    // Dangerous ReDoS regex
    const redos = JSON.stringify({
      id: "redos-test",
      label: "ReDoS Test",
      branchStatements: [{ pattern: "(a+)+", branchKind: "jump" }],
    });
    const res3 = store.importCustomVariant(redos);
    expect(res3.success).toBe(false);
    expect(res3.error).toContain("nested quantifiers");
  });
});
