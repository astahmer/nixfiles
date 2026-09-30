export const providerIconOptions = [
  "Bot",
  "BriefcaseBusiness",
  "Code",
  "FlaskConical",
  "Rocket",
  "Sparkles",
  "Terminal",
  "Layers",
  "Brain",
  "Globe",
  "Command",
  "Gem",
] as const;
export type ProviderIcon = (typeof providerIconOptions)[number];
