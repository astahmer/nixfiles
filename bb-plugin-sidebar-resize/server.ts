import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async (bb: BbPluginApi) => {
  bb.settings.define({
    density: {
      type: "select",
      label: "Navigation density",
      description: "Choose compact or comfortable spacing for the sidebar links.",
      options: ["Compact", "Comfortable"],
      default: "Compact",
    },
    overflow: {
      type: "select",
      label: "Collapsed navigation overflow",
      description: "Choose how navigation items are shown when the sidebar is collapsed.",
      options: ["Scroll", "Overflow menu", "Scroll + menu"],
      default: "Scroll + menu",
    },
  });
};
