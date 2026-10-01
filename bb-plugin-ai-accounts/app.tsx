import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, flip, offset, shift, size, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { definePluginApp, useBbContext, useBbNavigate, useComposer, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { providerIconOptions, type ProviderIcon } from "./provider-icons";
import type { AccountProfile, rpcContract, UsageSummary } from "./server";
import "./app.css";

const reasoningEffortValues = ["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"] as const;
type ReasoningEffort = typeof reasoningEffortValues[number];
const isReasoningEffort = (value: string): value is ReasoningEffort => reasoningEffortValues.some((effort) => effort === value);

const GlobalModelPicker = () => {
  const composer = useComposer();
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeProviderId, setActiveProviderId] = useState("all");
  const [accountProviders, setAccountProviders] = useState<Array<{ providerId: string; providerName: string; badge: string; color: string }>>([]);
  const [models, setModels] = useState<Array<{ providerId: string; providerName: string; badge: string; color: string; id: string; model: string; displayName: string; reasoningEffort: ReasoningEffort; isFavorite: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { refs, floatingStyles, context: floatingContext } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top-start",
    strategy: "fixed",
    middleware: [
      offset(8),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(floatingContext);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);
  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const providerModels = activeProviderId === "all"
      ? models
      : activeProviderId === "favorites"
        ? models.filter((entry) => entry.isFavorite)
        : models.filter((entry) => entry.providerId === activeProviderId);
    if (!normalizedQuery) return providerModels;
    const terms = normalizedQuery.split(/\s+/u);
    return providerModels.filter((entry) => {
      const searchable = `${entry.displayName} ${entry.model} ${entry.providerName} ${entry.badge}`.toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    });
  }, [activeProviderId, models, query]);

  useEffect(() => {
    if (open) return;
    setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([sdk.providers.list(), rpc.call("list", null)]).then(async ([providers, profileResult]) => {
      const configuredProviders = providers.filter((provider) => provider.id.startsWith("ai-account-"));
      const catalogs = await Promise.all(configuredProviders.map(async (provider) => {
        const profile = profileResult.accounts.find((account) => "ai-account-" + account.id === provider.id);
        const providerDetails = {
          providerId: provider.id,
          providerName: provider.displayName.replace(/^[^·]+·\s*/u, ""),
          badge: provider.displayName.match(/^([^·]+)·/u)?.[1]?.trim() ?? provider.displayName.slice(0, 2).toUpperCase(),
          color: provider.strings?.iconTint?.dark ?? "#64748B",
        };
        try {
          const result = await sdk.providers.models({ providerId: provider.id });
          return {
            provider: providerDetails,
            models: result.models.map((model) => ({
              ...providerDetails,
              id: model.id,
              model: model.model,
              displayName: model.displayName.endsWith(" · " + providerDetails.badge)
                ? model.displayName.slice(0, -providerDetails.badge.length - 3)
                : model.displayName,
              reasoningEffort: model.defaultReasoningEffort,
              isFavorite: profile?.favoriteModelIds.includes(model.id) ?? false,
            })),
          };
        } catch {
          return { provider: providerDetails, models: [] };
        }
      }));
      if (active) {
        setAccountProviders(catalogs.map((catalog) => catalog.provider));
        setModels(catalogs.flatMap((catalog) => catalog.models).sort((left, right) => left.displayName.localeCompare(right.displayName) || left.providerName.localeCompare(right.providerName)));
      }
    }).catch(() => {
      if (active) setError("Could not load account models. Check the selected machine and provider sign-in.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [open]);

  const selectModel = async (entry: typeof models[number]) => {
    setError("");
    try {
      await composer.experimental_setSelection({ providerId: entry.providerId, model: entry.model, reasoningLevel: entry.reasoningEffort });
      setOpen(false);
      setQuery("");
    } catch {
      setError("BB could not apply this model to the current composer.");
    }
  };

  const toggleFavorite = async (entry: typeof models[number]) => {
    setError("");
    try {
      const result = await rpc.call("list", null);
      const account = result.accounts.find((profile) => "ai-account-" + profile.id === entry.providerId);
      if (!account) throw new Error("Account profile unavailable.");
      const favoriteModelIds = account.favoriteModelIds.includes(entry.id)
        ? account.favoriteModelIds.filter((modelId) => modelId !== entry.id)
        : [...account.favoriteModelIds, entry.id];
      await rpc.call("save", { ...account, favoriteModelIds });
      setModels((current) => current.map((model) => model.providerId === entry.providerId && model.id === entry.id
        ? { ...model, isFavorite: favoriteModelIds.includes(model.id) }
        : model));
    } catch {
      setError("Could not update this model’s favorite status.");
    }
  };

  return <div className="aa-global-picker">
    <button ref={refs.setReference} className="aa-global-picker-trigger" type="button" aria-expanded={open} {...getReferenceProps({ onClick: () => setOpen((current) => !current) })}>All models <svg className="aa-global-picker-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg></button>
    {open ? createPortal(<section ref={refs.setFloating} className="aa-global-picker-popover" style={floatingStyles} aria-label="Search all account models" {...getFloatingProps()}>
      <nav className="aa-global-picker-sidebar" aria-label="Filter by provider">
        <button className={activeProviderId === "all" ? "is-active" : ""} type="button" title="All models" aria-label="All models" aria-pressed={activeProviderId === "all"} onClick={() => setActiveProviderId("all")}><svg className="aa-global-picker-all-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" /><rect x="10" y="1" width="5" height="5" rx="1" fill="currentColor" /><rect x="1" y="10" width="5" height="5" rx="1" fill="currentColor" /><rect x="10" y="10" width="5" height="5" rx="1" fill="currentColor" /></svg></button>
        <button className={activeProviderId === "favorites" ? "is-active" : ""} type="button" title="Favorites" aria-label="Favorites" aria-pressed={activeProviderId === "favorites"} onClick={() => setActiveProviderId("favorites")}><svg className="aa-global-picker-favorites-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m8 1.2 2.05 4.16 4.59.67-3.32 3.23.78 4.57L8 11.67l-4.1 2.16.78-4.57L1.36 6.03l4.59-.67L8 1.2Z" fill="currentColor" /></svg></button>
        {accountProviders.map((provider) => <button className={activeProviderId === provider.providerId ? "is-active" : ""} type="button" key={provider.providerId} title={provider.providerName} aria-label={provider.providerName} aria-pressed={activeProviderId === provider.providerId} onClick={() => setActiveProviderId(provider.providerId)}><span className="aa-account-badge" style={{ backgroundColor: provider.color }}>{provider.badge}</span></button>)}
      </nav>
      <div className="aa-global-picker-main">
        <label className="aa-global-picker-search"><span aria-hidden="true">⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={activeProviderId === "all" ? "Search all models…" : activeProviderId === "favorites" ? "Search favorites…" : `Search ${accountProviders.find((provider) => provider.providerId === activeProviderId)?.providerName ?? "provider"}…`} /></label>
        <div className="aa-global-picker-results">
          {loading ? <p className="aa-global-picker-empty">Loading account models…</p> : null}
          {!loading && error ? <p className="aa-global-picker-empty">{error}</p> : null}
          {!loading && !error && visibleModels.length === 0 ? <p className="aa-global-picker-empty">{activeProviderId === "favorites" ? "No favorites yet. Star a model to add it here." : "No matching account models."}</p> : null}
          {visibleModels.map((entry) => <div className={"aa-global-picker-row " + (activeProviderId !== "all" ? "is-compact" : "")} key={`${entry.providerId}:${entry.model}`}>
            <button className="aa-global-picker-select" type="button" onClick={() => void selectModel(entry)}>
              {activeProviderId === "all" ? <span className="aa-account-badge" style={{ backgroundColor: entry.color }}>{entry.badge}</span> : null}
              <span className="aa-global-picker-row-copy"><strong>{entry.displayName}</strong>{activeProviderId === "all" ? <small>{entry.providerName}</small> : null}</span>
              <span className="aa-global-picker-effort">{entry.reasoningEffort}</span>
            </button>
            <button className={"aa-global-picker-star " + (entry.isFavorite ? "is-favorite" : "")} type="button" aria-label={entry.isFavorite ? `Remove ${entry.displayName} from favorites` : `Add ${entry.displayName} to favorites`} title={entry.isFavorite ? "Remove favorite" : "Add to favorites"} onClick={() => void toggleFavorite(entry)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m8 1.2 2.05 4.16 4.59.67-3.32 3.23.78 4.57L8 11.67l-4.1 2.16.78-4.57L1.36 6.03l4.59-.67L8 1.2Z" /></svg>
            </button>
          </div>)}
        </div>
        <footer className="aa-global-picker-footer">Reasoning effort follows each model’s default. Change it separately in the composer.</footer>
      </div>
    </section>, document.body) : null}
  </div>;
};

const AccountPage = () => {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [identityEmail, setIdentityEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ displayName: string; path: string; hiddenText: string; badge: string; accentColor: string; providerIcon: ProviderIcon }>({ displayName: "", path: "", hiddenText: "", badge: "", accentColor: "#2563EB", providerIcon: providerIconOptions[0] });
  const [machines, setMachines] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [selectedHostId, setSelectedHostId] = useState("");
  const [catalog, setCatalog] = useState<Array<{ id: string; displayName: string; isDefault: boolean; supportedReasoningEfforts: Array<{ reasoningEffort: ReasoningEffort; description: string }>; defaultReasoningEffort: ReasoningEffort }>>([]);
  const [customDraft, setCustomDraft] = useState({ id: "", displayName: "" });
  const [customModelFormOpen, setCustomModelFormOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [scopeMode, setScopeMode] = useState<"default" | "project" | "machine" | "project-machine">("default");
  const [scopeHostId, setScopeHostId] = useState("");
  const selected = accounts.find((account) => account.id === selectedId) ?? null;

  async function loadAccounts() {
    const result = await rpc.call("list", null);
    return result.accounts;
  }

  useEffect(() => {
    void loadAccounts().then((loaded) => {
      setAccounts(loaded);
      setSelectedId(loaded[0]?.id ?? null);
    }).catch(() => setNotice("Could not load account profiles."));
  }, []);

  useEffect(() => {
    void rpc.call("machines", null).then((result) => {
      setMachines(result.machines);
      const selectedMachine = result.machines.find((machine) => machine.status === "connected") ?? result.machines[0];
      if (selectedMachine) {
        setSelectedHostId(selectedMachine.id);
        setScopeHostId(selectedMachine.id);
        setScopeMode("machine");
      }
    }).catch(() => setMachines([]));
  }, []);

  useEffect(() => {
    if (selected?.email) setIdentityEmail(selected.email);
    else setIdentityEmail(null);
  }, [selected?.id, selected?.email]);

  useEffect(() => {
    if (!selected || selected.provider !== "codex" || selected.email || !draft.path) return;
    let current = true;
    let checking = false;
    const checkForSignIn = async () => {
      if (checking) return;
      checking = true;
      try {
        const result = await rpc.call("identity", { id: selected.id, path: draft.path });
        const email = result.email;
        if (!current || email === null) return;
        setIdentityEmail(email);
        setAccounts((profiles) => profiles.map((profile) => profile.id === selected.id ? { ...profile, email } : profile));
        setNotice("Codex sign-in detected. Account identity refreshed.");
      } catch {
        // The account home may not exist until the sign-in command creates it.
      } finally {
        checking = false;
      }
    };
    void checkForSignIn();
    const timer = window.setInterval(() => void checkForSignIn(), 2500);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [selected?.id, selected?.provider, selected?.email, draft.path]);

  useEffect(() => {
    if (!selected) return;
    setScopeMode(selectedHostId ? "machine" : "default");
    setScopeHostId(selectedHostId);
    setDraft({
      displayName: selected.displayName,
      path: selected.path,
      hiddenText: selected.hiddenModelIds.join("\n"),
      badge: selected.badge ?? selected.displayName.split(/\s+/u).filter(Boolean).map((part) => part[0]).join("").slice(0, 3).toUpperCase(),
      accentColor: selected.accentColor ?? (selected.provider === "codex" ? "#2563EB" : "#7C3AED"),
      providerIcon: selected.providerIcon ?? providerIconOptions[0],
    });
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || !selectedHostId) {
      setCatalog([]);
      return;
    }
    let current = true;
    setCatalog([]);
    void rpc.call("catalog", { id: selected.id, hostId: selectedHostId }).then((result) => {
      if (current) setCatalog(result.models);
    }).catch(() => {
      if (current) setCatalog([]);
    });
    return () => { current = false; };
  }, [selected?.id, selected?.email, selectedHostId]);

  const persist = async (patch: Partial<NonNullable<typeof selected>>) => {
    if (!selected) return;
    setSaving(true);
    setNotice("");
    try {
      const result = await rpc.call("save", { ...selected, ...patch });
      setAccounts((current) => current.map((account) => account.id === result.account.id ? result.account : account));
      setSelectedId(result.account.id);
      setNotice("Saved. New sessions will use the updated provider settings.");
    } catch {
      setNotice("Could not save account settings.");
    } finally {
      setSaving(false);
    }
  };

  const updateAccountEnabled = async (account: AccountProfile, enabled: boolean) => {
    setSaving(true);
    setNotice("");
    try {
      const result = await rpc.call("save", { ...account, enabled });
      setAccounts((current) => current.map((profile) => profile.id === result.account.id ? result.account : profile));
      setNotice(`${account.displayName} ${enabled ? "enabled in" : "hidden from"} the model picker.`);
    } catch {
      setNotice(`Could not update ${account.displayName}.`);
    } finally {
      setSaving(false);
    }
  };

  const addAccount = async (provider: "codex" | "opencode-go") => {
    const count = accounts.filter((account) => account.provider === provider).length + 1;
    setSaving(true);
    try {
      const defaults = await rpc.call("defaults", null);
      const root = provider === "codex" ? defaults.codex : defaults.opencodeGo;
      const result = await rpc.call("save", {
        provider,
        displayName: provider === "codex" ? "Codex " + count : "OpenCode Go " + count,
        badge: provider === "codex" ? "C" + count : "O" + count,
        accentColor: provider === "codex" ? "#2563EB" : "#7C3AED",
        providerIcon: providerIconOptions.find((icon) => !accounts.some((account) => account.providerIcon === icon)) ?? providerIconOptions[0],
        path: root + "/" + count,
        enabled: true,
        hiddenModelIds: [],
        favoriteModelIds: [],
        modelOrder: [],
        modelReasoningDefaults: {},
        customModels: [],
        pathOverrides: [],
      });
      setAccounts((current) => [...current, result.account]);
      setSelectedId(result.account.id);
      setNotice("Account added. Sign in once to create its isolated home and connect this profile.");
    } catch {
      setNotice("Could not add the account.");
    } finally {
      setSaving(false);
    }
  };

  const signIn = async () => {
    if (!selected) return;
    const quotedPath = "'" + draft.path.replaceAll("'", "'\\''") + "'";
    const command = selected.provider === "codex"
      ? "mkdir -p " + quotedPath + " && chmod 700 " + quotedPath + " && CODEX_HOME=" + quotedPath + " codex login"
      : "mkdir -p " + quotedPath + " && XDG_DATA_HOME=" + quotedPath + " opencode auth login";
    try {
      await navigator.clipboard.writeText(command);
      setNotice("Sign-in command copied. Run it in a terminal on the machine using this account.");
    } catch {
      setNotice(command);
    }
  };

  const refreshIdentity = async () => {
    if (!selected) return;
    try {
      const result = await rpc.call("identity", { id: selected.id, path: draft.path });
      setIdentityEmail(result.email);
      if (result.email) {
        const updated = { ...selected, email: result.email };
        setAccounts((current) => current.map((account) => account.id === updated.id ? updated : account));
        setNotice("Codex account email refreshed.");
      } else {
        setNotice("No signed-in Codex account was found at this path yet.");
      }
    } catch {
      setNotice("Could not read the Codex account identity.");
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm("Remove this BB profile? Its local login files will be left in place.")) return;
    const result = await rpc.call("remove", { id: selected.id });
    setAccounts(result.accounts);
    setSelectedId(result.accounts[0]?.id ?? null);
    setNotice("Profile removed. Provider credentials were left on disk.");
  };

  const selectScope = (mode: typeof scopeMode, hostId = scopeHostId) => {
    setScopeMode(mode);
    if (!selected) return;
    const projectId = mode === "project" || mode === "project-machine" ? context.projectId : null;
    const machineId = mode === "machine" || mode === "project-machine" ? hostId.trim() : null;
    if (machineId) setSelectedHostId(machineId);
    const candidates = selected.pathOverrides.filter((entry) =>
      (entry.projectId === null || entry.projectId === projectId) &&
      (entry.hostId === null || entry.hostId === machineId),
    );
    candidates.sort((left, right) =>
      Number(right.projectId !== null) + Number(right.hostId !== null) -
      Number(left.projectId !== null) - Number(left.hostId !== null),
    );
    const override = candidates[0];
    setDraft((current) => ({ ...current, path: override?.path ?? selected.path }));
  };

  const projectScope = scopeMode === "project" || scopeMode === "project-machine" ? "project" : "all";
  const machineScope = scopeMode === "machine" || scopeMode === "project-machine" ? scopeHostId : "all";

  const updateProjectScope = (value: string) => {
    const hasMachine = machineScope !== "all";
    const mode = value === "project"
      ? hasMachine ? "project-machine" : "project"
      : hasMachine ? "machine" : "default";
    selectScope(mode, scopeHostId);
  };

  const updateMachineScope = (value: string) => {
    setScopeHostId(value === "all" ? "" : value);
    const hasProject = projectScope === "project";
    const mode = value === "all"
      ? hasProject ? "project" : "default"
      : hasProject ? "project-machine" : "machine";
    selectScope(mode, value === "all" ? "" : value);
  };

  const saveAccount = async () => {
    if (!selected) return;
    const hiddenModelIds = Array.from(new Set(draft.hiddenText.split(/\s+/u).map((model) => model.trim()).filter(Boolean)));
    if (scopeMode === "default") {
      await persist({ displayName: draft.displayName, path: draft.path, hiddenModelIds, badge: draft.badge, accentColor: draft.accentColor, providerIcon: draft.providerIcon });
      return;
    }
    if ((scopeMode === "project" || scopeMode === "project-machine") && !context.projectId) {
      setNotice("Open a project to configure a project-specific path.");
      return;
    }
    if ((scopeMode === "machine" || scopeMode === "project-machine") && !scopeHostId.trim()) {
      setNotice("Choose a machine before saving this path override.");
      return;
    }
    const projectId = scopeMode === "project" || scopeMode === "project-machine" ? context.projectId : null;
    const hostId = scopeMode === "machine" || scopeMode === "project-machine" ? scopeHostId.trim() : null;
    const pathOverrides = selected.pathOverrides.filter((entry) => entry.projectId !== projectId || entry.hostId !== hostId);
    if (draft.path !== selected.path) pathOverrides.push({ projectId, hostId, path: draft.path });
    await persist({ displayName: draft.displayName, hiddenModelIds, pathOverrides, badge: draft.badge, accentColor: draft.accentColor, providerIcon: draft.providerIcon });
  };

  const hiddenModelIds = new Set(draft.hiddenText.split(/\s+/u).filter(Boolean));
  const catalogModels = selected
    ? [
      ...catalog,
      ...selected.customModels.filter((custom) => !catalog.some((model) => model.id === custom.id)).map((custom) => ({ ...custom, isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }], defaultReasoningEffort: "medium" })),
    ]
    : catalog;
  const modelIndex = new Map(catalogModels.map((model, index) => [model.id, index]));
  const orderedModels = [...catalogModels].sort((left, right) => {
    const leftOrder = selected?.modelOrder.indexOf(left.id) ?? -1;
    const rightOrder = selected?.modelOrder.indexOf(right.id) ?? -1;
    if (leftOrder >= 0 || rightOrder >= 0) {
      if (leftOrder < 0) return 1;
      if (rightOrder < 0) return -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }
    return (modelIndex.get(left.id) ?? 0) - (modelIndex.get(right.id) ?? 0);
  });
  const favoriteModels = orderedModels.filter((model) => selected?.favoriteModelIds.includes(model.id) && !hiddenModelIds.has(model.id));
  const availableModels = orderedModels.filter((model) => !hiddenModelIds.has(model.id) && !selected?.favoriteModelIds.includes(model.id));
  const hiddenModels = orderedModels.filter((model) => hiddenModelIds.has(model.id));

  const updateModelVisibility = (modelId: string, enabled: boolean) => {
    if (!selected) return;
    const next = new Set(hiddenModelIds);
    if (enabled) next.delete(modelId);
    else next.add(modelId);
    setDraft((current) => ({ ...current, hiddenText: Array.from(next).join("\n") }));
    void persist({ hiddenModelIds: Array.from(next) });
  };

  const updateFavorites = (modelId: string) => {
    if (!selected) return;
    const favorites = new Set(selected.favoriteModelIds);
    if (favorites.has(modelId)) favorites.delete(modelId);
    else favorites.add(modelId);
    const modelOrder = [
      ...orderedModels.filter((model) => favorites.has(model.id)).map((model) => model.id),
      ...orderedModels.filter((model) => !favorites.has(model.id)).map((model) => model.id),
    ];
    void persist({ favoriteModelIds: Array.from(favorites), modelOrder });
  };

  const moveModel = (modelId: string, direction: -1 | 1, groupModels: typeof catalogModels) => {
    if (!selected) return;
    const groupIndex = groupModels.findIndex((model) => model.id === modelId);
    const neighbor = groupModels[groupIndex + direction];
    if (groupIndex < 0 || !neighbor) return;
    const order = orderedModels.map((model) => model.id);
    const modelIndex = order.indexOf(modelId);
    if (modelIndex < 0) return;
    order.splice(modelIndex, 1);
    const neighborIndex = order.indexOf(neighbor.id);
    if (neighborIndex < 0) return;
    order.splice(neighborIndex + (direction > 0 ? 1 : 0), 0, modelId);
    void persist({ modelOrder: order });
  };

  const updateReasoningDefault = (modelId: string, effort: ReasoningEffort) => {
    if (!selected) return;
    void persist({ modelReasoningDefaults: { ...selected.modelReasoningDefaults, [modelId]: effort } });
  };

  const addCustomModel = () => {
    if (!selected) return;
    const id = customDraft.id.trim();
    const displayName = customDraft.displayName.trim();
    if (!id || !displayName) {
      setNotice("Enter both a model ID and a display name.");
      return;
    }
    if (catalogModels.some((model) => model.id === id)) {
      setNotice("That model ID is already in this account’s catalog.");
      return;
    }
    void persist({ customModels: [...selected.customModels, { id, displayName }], modelOrder: [...selected.modelOrder, id] });
    setCustomDraft({ id: "", displayName: "" });
    setCustomModelFormOpen(false);
  };

  const removeCustomModel = (modelId: string) => {
    if (!selected) return;
    const customModels = selected.customModels.filter((model) => model.id !== modelId);
    const hiddenModelIds = selected.hiddenModelIds.filter((id) => id !== modelId);
    const favoriteModelIds = selected.favoriteModelIds.filter((id) => id !== modelId);
    const modelOrder = selected.modelOrder.filter((id) => id !== modelId);
    setDraft((current) => ({ ...current, hiddenText: hiddenModelIds.join("\n") }));
    void persist({ customModels, hiddenModelIds, favoriteModelIds, modelOrder });
  };

  const refreshCatalog = async () => {
    if (!selected || !selectedHostId) return;
    setRefreshingCatalog(true);
    try {
      const result = await rpc.call("catalog", { id: selected.id, hostId: selectedHostId });
      setCatalog(result.models);
      setNotice("Provider model catalog refreshed.");
    } catch {
      setNotice("Could not refresh this provider’s model catalog.");
    } finally {
      setRefreshingCatalog(false);
    }
  };

  const renderModelRows = (models: typeof catalogModels) => models.map((model) => {
    const isFavorite = selected?.favoriteModelIds.includes(model.id) ?? false;
    const isHidden = hiddenModelIds.has(model.id);
    const isCustom = selected?.customModels.some((custom) => custom.id === model.id) ?? false;
    const groupIndex = models.findIndex((entry) => entry.id === model.id);
    return (
      <div className={"aa-model-row " + (isHidden ? "is-hidden" : "")} key={model.id}>
        <button className="aa-favorite" aria-label={isFavorite ? "Remove favorite" : "Add favorite"} onClick={() => updateFavorites(model.id)}>{isFavorite ? "★" : "☆"}</button>
        <span className="aa-model-copy"><strong>{model.displayName}</strong><small>{model.id}{model.isDefault ? " · default" : ""}</small></span>
        <div className="aa-model-actions">
          <select className="aa-reasoning-default" aria-label={"Default reasoning effort for " + model.displayName} value={selected?.modelReasoningDefaults[model.id] ?? model.defaultReasoningEffort} onChange={(event) => { if (isReasoningEffort(event.currentTarget.value)) updateReasoningDefault(model.id, event.currentTarget.value); }}>
            {model.supportedReasoningEfforts.map((effort) => <option key={effort.reasoningEffort} value={effort.reasoningEffort}>{effort.description}</option>)}
          </select>
          <button title="Move up" aria-label="Move up" disabled={groupIndex === 0} onClick={() => moveModel(model.id, -1, models)}>↑</button><button title="Move down" aria-label="Move down" disabled={groupIndex === models.length - 1} onClick={() => moveModel(model.id, 1, models)}>↓</button><label className="aa-model-enable" title={!isHidden ? "In model picker" : "Hidden from model picker"}><input type="checkbox" checked={!isHidden} onChange={(event) => updateModelVisibility(model.id, event.currentTarget.checked)} /><span className="aa-switch" /><span className="aa-model-enable-copy">In picker</span></label>{isCustom ? <button title="Remove custom model" aria-label="Remove custom model" onClick={() => removeCustomModel(model.id)}>×</button> : null}
        </div>
      </div>
    );
  });

  return (
    <main className="aa-page">
      <header className="aa-page-toolbar">
        <div className="aa-scope-bar">
          <span>Applying settings for</span>
          <select aria-label="Project scope" value={projectScope} onChange={(event) => updateProjectScope(event.currentTarget.value)}>
            <option value="all">All projects</option>
            <option value="project" disabled={!context.projectId}>This project</option>
          </select>
          <span>on</span>
          <select aria-label="Machine scope" value={machineScope} onChange={(event) => updateMachineScope(event.currentTarget.value)}>
            <option value="all">All machines</option>
            {machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
          </select>
        </div>
      </header>

      <div className="aa-layout">
        <aside className="aa-rail" aria-label="Provider accounts">
          <div className="aa-rail-heading">
            <span>YOUR ACCOUNTS <i>{accounts.length}</i></span>
            <div className="aa-add-menu-anchor">
              <button className="aa-add-trigger" type="button" aria-label="Add account" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen((current) => !current)}>＋</button>
              {addMenuOpen ? <div className="aa-add-menu" role="menu">
                <button type="button" role="menuitem" disabled={saving} onClick={() => { setAddMenuOpen(false); void addAccount("codex"); }}>Codex account</button>
                <button type="button" role="menuitem" disabled={saving} onClick={() => { setAddMenuOpen(false); void addAccount("opencode-go"); }}>OpenCode Go account</button>
              </div> : null}
            </div>
          </div>
          {accounts.length === 0 && <p className="aa-empty">Add an account to give it a private provider entry in the model picker.</p>}
          {(["codex", "opencode-go"] as const).map((provider) => {
            const providerAccounts = accounts.filter((account) => account.provider === provider);
            if (!providerAccounts.length) return null;
            return (
              <section className="aa-group" key={provider}>
                <h2>{provider === "codex" ? "CODEX" : "OPENCODE GO"}</h2>
                {providerAccounts.map((account) => (
                  <div className={"aa-account-row " + (selectedId === account.id ? "is-selected" : "")} key={account.id}>
                    <button className="aa-account-select" onClick={() => setSelectedId(account.id)} aria-current={selectedId === account.id ? "true" : undefined}>
                      <span className={"aa-mark " + (provider === "codex" ? "codex" : "opencode")} style={{ backgroundColor: account.accentColor ?? "#2563EB" }}>{account.badge ?? account.displayName.slice(0, 2).toUpperCase()}</span>
                      <span className="aa-row-copy"><strong>{account.displayName}</strong><small>{account.email ?? "Email not detected"}</small></span>
                    </button>
                    <label className="aa-account-toggle" title={account.enabled ? "Hide account from model picker" : "Show account in model picker"}>
                      <input type="checkbox" aria-label={`${account.enabled ? "Hide" : "Show"} ${account.displayName} in model picker`} checked={account.enabled} disabled={saving} onChange={(event) => void updateAccountEnabled(account, event.currentTarget.checked)} />
                      <span className="aa-switch" />
                    </label>
                  </div>
                ))}
              </section>
            );
          })}
          <div className="aa-rail-foot">Credentials stay in the provider’s own account directory.</div>
        </aside>

        {selected ? (
          <section className="aa-detail">
            <div className="aa-detail-top">
              <div className="aa-provider-title">
                <span className={"aa-mark large " + (selected.provider === "codex" ? "codex" : "opencode")} style={{ backgroundColor: draft.accentColor }}>{draft.badge || "AI"}</span>
                <div><p className="aa-kicker">{selected.provider === "codex" ? "CHATGPT SUBSCRIPTION" : "OPENCODE SUBSCRIPTION"}</p><h2>{selected.displayName}</h2></div>
              </div>
              <label className="aa-switch-label"><span>{selected.enabled ? "Enabled in model picker" : "Hidden from model picker"}</span><input type="checkbox" checked={selected.enabled} onChange={(event) => void persist({ enabled: event.currentTarget.checked })} /><span className="aa-switch" /></label>
            </div>

            <div className="aa-detail-content">
            <section className="aa-section">
              <div className="aa-section-heading"><div><span className="aa-index">01</span><h3>Account identity</h3></div><button className="aa-quiet" onClick={() => void refreshIdentity()} disabled={selected.provider !== "codex"}>↻ Refresh</button></div>
              <div className="aa-field-grid identity">
                <label>Display name<input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.currentTarget.value }))} /></label>
                <label>Signed-in email<input readOnly value={identityEmail ?? (selected.provider === "codex" ? "Sign in, then refresh" : "OpenCode Go key login")} /></label>
                <label>Picker tag<input value={draft.badge} maxLength={4} onChange={(event) => setDraft((current) => ({ ...current, badge: event.currentTarget.value.toUpperCase() }))} placeholder="EM" /></label>
                <label>Tag color<input className="aa-color-input" type="color" value={draft.accentColor} onChange={(event) => setDraft((current) => ({ ...current, accentColor: event.currentTarget.value }))} /></label>
                <label>Picker icon<select value={draft.providerIcon} onChange={(event) => setDraft((current) => ({ ...current, providerIcon: providerIconOptions.find((icon) => icon === event.currentTarget.value) ?? current.providerIcon }))}>{providerIconOptions.map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select></label>
              </div>
              <p className="aa-help">The short tag and color distinguish this account in BB’s provider picker. Change them any time.</p>
            </section>

            <section className="aa-section">
              <div className="aa-section-heading"><div><span className="aa-index">02</span><h3>Runtime paths</h3></div><span className="aa-muted">Absolute path on the provider machine</span></div>
              <label className="aa-path-field"><span>{selected.provider === "codex" ? "CODEX_HOME" : "XDG_DATA_HOME"}<small>{selected.provider === "codex" ? "Private Codex home and local state." : "OpenCode auth and local data root."}</small></span><input value={draft.path} onChange={(event) => setDraft((current) => ({ ...current, path: event.currentTarget.value }))} spellCheck={false} /></label>
              <p className="aa-help">Specific project and machine paths override the inherited account path.</p>
            </section>

            <section className="aa-section aa-model-section">
              <div className="aa-section-heading"><div><span className="aa-index">03</span><h3>Models</h3></div><button className="aa-quiet" disabled={refreshingCatalog || !selectedHostId} onClick={() => void refreshCatalog()}>{refreshingCatalog ? "Checking…" : "↻ Check now"}</button></div>
              <p className="aa-help">Use the switches to show models in the picker. Favorites and order are saved on this device; custom models are added to this account’s provider entry.</p>
              <div className="aa-model-card"><div className="aa-model-toolbar"><button className="aa-quiet" onClick={() => {
                if (!selected) return;
                const catalogModelIds = catalogModels.map((model) => model.id);
                const catalogIds = new Set(catalogModelIds);
                const allHidden = catalogModels.every((model) => hiddenModelIds.has(model.id));
                const unknownHiddenIds = Array.from(hiddenModelIds).filter((id) => !catalogIds.has(id));
                const next = allHidden ? unknownHiddenIds : [...unknownHiddenIds, ...catalogModelIds];
                setDraft((current) => ({ ...current, hiddenText: next.join("\n") }));
                void persist({ hiddenModelIds: next });
              }}>{catalogModels.length > 0 && catalogModels.every((model) => hiddenModelIds.has(model.id)) ? "Enable all" : "Disable all"}</button><span>{catalogModels.length} models · {favoriteModels.length} favorites · {hiddenModels.length} hidden</span><button className="aa-quiet" onClick={() => setCustomModelFormOpen((open) => !open)}>{customModelFormOpen ? "Cancel" : "＋ Add custom model"}</button></div>
              <div className="aa-model-list">{catalogModels.length ? <>
                {favoriteModels.length > 0 ? <section className="aa-model-group"><h4>Favorites</h4>{renderModelRows(favoriteModels)}</section> : null}
                <section className="aa-model-group"><h4>All</h4>{renderModelRows(availableModels)}</section>
                {hiddenModels.length > 0 ? <section className="aa-model-group"><h4>Hidden from picker</h4>{renderModelRows(hiddenModels)}</section> : null}
              </> : <p className="aa-empty">{selectedHostId ? "No models returned yet. Sign in on this machine, then refresh the provider catalog." : "Choose a machine to read the provider’s model catalog."}</p>}</div>
              {customModelFormOpen ? <div className="aa-custom-model-form"><label>Model ID<input id="aa-custom-model-id" value={customDraft.id} onChange={(event) => setCustomDraft((current) => ({ ...current, id: event.currentTarget.value }))} placeholder="provider/model-id" /></label><label>Display name<input value={customDraft.displayName} onChange={(event) => setCustomDraft((current) => ({ ...current, displayName: event.currentTarget.value }))} placeholder="Custom model" /></label><button className="aa-quiet" onClick={addCustomModel}>Add model</button></div> : null}
              </div>
            </section>
            </div>

            <footer className="aa-footer">
              <button className="aa-primary" onClick={() => void signIn()}>↗ Copy sign-in command</button>
              <button onClick={() => void saveAccount()}>Save changes</button>
              <span>{notice || (saving ? "Saving…" : "Provider and account are separate entries in the model picker.")}</span>
              <button className="aa-danger" onClick={() => void remove()}>Remove profile</button>
            </footer>
          </section>
        ) : (
          <section className="aa-welcome"><span className="aa-welcome-mark">✳</span><h2>Your accounts, side by side.</h2><p>Create a Codex or OpenCode Go profile. BB will add a dedicated provider entry for each account.</p></section>
        )}
      </div>
    </main>
  );
};

type UsageRange = { startAt: number; endAt: number };
type UsageRangePreset = "7d" | "30d" | "90d" | "this-year" | "last-year" | "past-year" | "custom";
const usageRangePresets: Array<{ value: Exclude<UsageRangePreset, "custom">; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "this-year", label: "This year" },
  { value: "last-year", label: "Last year" },
  { value: "past-year", label: "Past year" },
];
const localDateInput = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const localDayStart = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).getTime();
};
const dateRangeFromInputs = (from: string, to: string): UsageRange => {
  const end = new Date(localDayStart(to));
  end.setDate(end.getDate() + 1);
  return { startAt: localDayStart(from), endAt: end.getTime() };
};
const dateRangeForPreset = (preset: Exclude<UsageRangePreset, "custom">, now = new Date()): UsageRange => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const start = new Date(today);
  if (preset === "this-year") start.setMonth(0, 1);
  else if (preset === "last-year") {
    start.setFullYear(start.getFullYear() - 1, 0, 1);
    today.setMonth(0, 1);
  } else if (preset === "past-year") start.setFullYear(start.getFullYear() - 1);
  else start.setDate(start.getDate() - (Number.parseInt(preset, 10) - 1));
  return { startAt: start.getTime(), endAt: preset === "last-year" ? today.getTime() : tomorrow.getTime() };
};
const dateInputsFromRange = (range: UsageRange) => {
  const lastDay = new Date(range.endAt);
  lastDay.setDate(lastDay.getDate() - 1);
  return { from: localDateInput(new Date(range.startAt)), to: localDateInput(lastDay) };
};
const formatDateRange = (range: UsageRange) => {
  const { from, to } = dateInputsFromRange(range);
  return `${new Date(`${from}T12:00:00`).toLocaleDateString()} – ${new Date(`${to}T12:00:00`).toLocaleDateString()}`;
};

const formatCount = (count: number) => new Intl.NumberFormat(undefined, { notation: count >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(count);
const formatTimestamp = (timestamp: number | null) => timestamp === null ? "Not yet" : new Date(timestamp).toLocaleString();
const formatReset = (timestamp: string | null) => {
  if (!timestamp) return "Reset time unavailable";
  const remaining = Date.parse(timestamp) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return "Resetting now";
  const hours = Math.floor(remaining / 3_600_000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `Resets in ${days}d ${hours % 24}h` : `Resets in ${hours}h ${Math.floor((remaining % 3_600_000) / 60_000)}m`;
};

const quotaWindowRank = (label: string) => {
  if (label === "Current session") return 0;
  if (label === "Weekly limit") return 1;
  if (label === "Monthly limit") return 2;
  return 3;
};

const quotaTone = (remainingPercent: number) => remainingPercent <= 10 ? "is-critical" : remainingPercent <= 25 ? "is-low" : "is-healthy";

const sortQuotaWindows = (entries: UsageSummary["quota"]) => [...entries].sort((left, right) => quotaWindowRank(left.label) - quotaWindowRank(right.label));

const quotaHistoryChange = (entry: UsageSummary["quota"][number], history: UsageSummary["quotaHistory"]) => {
  const points = history.filter((point) => point.accountId === entry.accountId && point.hostId === entry.hostId && point.windowKey === entry.windowKey && point.resetsAt === entry.resetsAt).sort((left, right) => left.capturedAt - right.capturedAt);
  const first = points[0];
  const last = points.at(-1);
  return first && last && first.capturedAt !== last.capturedAt ? Math.round(last.remainingPercent - first.remainingPercent) : null;
};

const BankedResetDetails = ({ entry, compact = false }: { entry: UsageSummary["bankedResets"][number]; compact?: boolean }) => <details className={`aa-banked-reset-list ${compact ? "is-compact" : ""}`}>
  <summary>▣ {entry.balance} banked reset{entry.balance === 1 ? "" : "s"}{entry.expiresAt ? ` · earliest expires ${new Date(entry.expiresAt).toLocaleString()}` : ""}</summary>
  <ol>{entry.resets.map((reset, index) => <li key={`${reset.expiresAt ?? "unknown"}:${index}`}>Reset {index + 1} · {reset.expiresAt ? `expires ${new Date(reset.expiresAt).toLocaleString()}` : "expiry date not reported"}</li>)}</ol>
  {entry.balance > entry.resets.length ? <p>{entry.balance - entry.resets.length} reset{entry.balance - entry.resets.length === 1 ? "" : "s"} without an individual expiry date from the provider</p> : null}
</details>;

const FooterProviderMark = ({ provider }: { provider: "codex" | "opencode-go" }) => provider === "codex"
  ? <svg className="aa-footer-provider-mark is-codex" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" /></svg>
  : <svg className="aa-footer-provider-mark is-opencode-go" viewBox="-72 -42 384 384" aria-hidden="true"><path fill="currentColor" fillOpacity=".45" d="M180 240H60V120H180V240Z" /><path fill="currentColor" d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" /></svg>;

const QuotaSparkline = ({ history, range }: { history: UsageSummary["quotaHistory"]; range: UsageRange }) => {
  const ordered = history.slice().sort((left, right) => left.capturedAt - right.capturedAt);
  if (ordered.length < 2) return null;
  const gapLimitMs = Math.max(2 * 60 * 60 * 1000, (range.endAt - range.startAt) / 15);
  const segments: typeof ordered[] = [];
  for (const entry of ordered) {
    const current = segments.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous || entry.resetsAt !== previous.resetsAt || entry.capturedAt - previous.capturedAt > gapLimitMs) segments.push([entry]);
    else current.push(entry);
  }
  const firstAt = ordered[0]?.capturedAt ?? Date.now();
  const lastAt = ordered.at(-1)?.capturedAt ?? firstAt;
  return <svg className="aa-quota-sparkline" viewBox="0 0 100 28" role="img" aria-label={`Remaining quota history from ${formatDateRange(range)}`}>
    <line x1="0" x2="100" y1="3" y2="3" stroke="currentColor" strokeOpacity=".12" />
    <line x1="0" x2="100" y1="25" y2="25" stroke="currentColor" strokeOpacity=".12" />
    {segments.filter((segment) => segment.length > 1).map((segment) => <polyline key={`${segment[0]?.capturedAt}`} points={segment.map((entry) => {
      const x = lastAt === firstAt ? 50 : (entry.capturedAt - firstAt) / (lastAt - firstAt) * 100;
      const y = 25 - entry.remainingPercent / 100 * 22;
      return `${x},${y}`;
    }).join(" ")} fill="none" stroke="#24a484" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />)}
  </svg>;
};

const UsagePage = () => {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [range, setRange] = useState<UsageRange>(() => dateRangeForPreset("7d"));
  const [rangePreset, setRangePreset] = useState<UsageRangePreset>("7d");
  const [rangeDraft, setRangeDraft] = useState(() => dateInputsFromRange(dateRangeForPreset("7d")));
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [rangeError, setRangeError] = useState("");
  const [view, setView] = useState<"tokens" | "limits">("limits");
  const [limitsLayout, setLimitsLayout] = useState<"accounts" | "comparison">("accounts");
  const [accountId, setAccountId] = useState("all");
  const [provider, setProvider] = useState<"all" | "codex" | "opencode-go">("all");
  const [hostId, setHostId] = useState("all");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState(5);
  const [savingRefreshInterval, setSavingRefreshInterval] = useState(false);
  const [refreshIntervalError, setRefreshIntervalError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void rpc.call("usageSettings", null).then((settings) => {
      if (active) setRefreshIntervalMinutes(settings.refreshIntervalMinutes);
    }).catch(() => {
      if (active) setRefreshIntervalError("Could not load refresh settings.");
    });
    return () => { active = false; };
  }, []);

  const saveRefreshInterval = async (value: string) => {
    const nextInterval = Number(value);
    if (!Number.isInteger(nextInterval) || nextInterval < 1 || nextInterval > 60) return;
    const previousInterval = refreshIntervalMinutes;
    setRefreshIntervalMinutes(nextInterval);
    setSavingRefreshInterval(true);
    setRefreshIntervalError("");
    try {
      const settings = await rpc.call("setUsageRefreshInterval", { refreshIntervalMinutes: nextInterval });
      setRefreshIntervalMinutes(settings.refreshIntervalMinutes);
    } catch {
      setRefreshIntervalMinutes(previousInterval);
      setRefreshIntervalError("Could not save refresh interval.");
    } finally {
      setSavingRefreshInterval(false);
    }
  };

  const applyRangeDraft = () => {
    if (!rangeDraft.from || !rangeDraft.to || rangeDraft.from > rangeDraft.to) {
      setRangeError("Choose a valid start and end date.");
      return;
    }
    const selectedRange = dateRangeFromInputs(rangeDraft.from, rangeDraft.to);
    if (selectedRange.endAt - selectedRange.startAt > 366 * 24 * 60 * 60 * 1000) {
      setRangeError("Choose a range of one year or less.");
      return;
    }
    setRange(selectedRange);
    setRangePreset("custom");
    setRangeError("");
    setRangePickerOpen(false);
  };

  const selectRangePreset = (preset: Exclude<UsageRangePreset, "custom">) => {
    const selectedRange = dateRangeForPreset(preset);
    setRange(selectedRange);
    setRangeDraft(dateInputsFromRange(selectedRange));
    setRangePreset(preset);
    setRangeError("");
    setRangePickerOpen(false);
  };

  const load = async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const result = refresh ? await rpc.call("refreshUsage", { range }) : await rpc.call("usageSummary", { range });
      setSummary(result);
    } catch {
      setError("Usage data could not be loaded. Check that the provider machines are connected.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(false); }, [range]);
  useEffect(() => {
    const interval = setInterval(() => { void load(false); }, 60_000);
    return () => clearInterval(interval);
  }, [range]);

  const visibleQuota = summary?.quota.filter((entry) => (accountId === "all" || entry.accountId === accountId) && (provider === "all" || entry.provider === provider) && (hostId === "all" || entry.hostId === hostId)) ?? [];
  const visibleHistory = summary?.quotaHistory.filter((entry) => (accountId === "all" || entry.accountId === accountId) && (provider === "all" || entry.provider === provider) && (hostId === "all" || entry.hostId === hostId)) ?? [];
  const visibleSeries = summary?.tokenSeries.filter((entry) => (accountId === "all" || entry.accountId === accountId) && (provider === "all" || entry.provider === provider) && (hostId === "all" || entry.hostId === hostId)) ?? [];
  const visibleBreakdown = summary?.tokenBreakdown.filter((entry) => (accountId === "all" || entry.accountId === accountId) && (provider === "all" || entry.provider === provider) && (hostId === "all" || entry.hostId === hostId)) ?? [];
  const visibleTotals = useMemo(() => visibleSeries.reduce((totals, entry) => ({
    totalTokens: totals.totalTokens + entry.totalTokens,
    activeTokens: totals.activeTokens + entry.activeTokens,
    inputTokens: totals.inputTokens + entry.inputTokens,
    cachedInputTokens: totals.cachedInputTokens + entry.cachedInputTokens,
    cacheReadInputTokens: totals.cacheReadInputTokens + entry.cacheReadInputTokens,
    cacheWriteInputTokens: totals.cacheWriteInputTokens + entry.cacheWriteInputTokens,
    outputTokens: totals.outputTokens + entry.outputTokens,
    reasoningOutputTokens: totals.reasoningOutputTokens + entry.reasoningOutputTokens,
  }), { totalTokens: 0, activeTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 }), [visibleSeries]);
  const timeline = useMemo(() => {
    const points = new Map<number, number>();
    for (const entry of visibleSeries) points.set(entry.bucketAt, (points.get(entry.bucketAt) ?? 0) + entry.totalTokens);
    const ordered = Array.from(points, ([bucketAt, totalTokens]) => ({ bucketAt, totalTokens })).sort((left, right) => left.bucketAt - right.bucketAt);
    const maxTokens = Math.max(1, ...ordered.map((entry) => entry.totalTokens));
    const plotted = ordered.map((entry, index) => ({ x: ordered.length <= 1 ? 0 : index / (ordered.length - 1) * 100, y: 100 - entry.totalTokens / maxTokens * 92 }));
    return { points: plotted.map((point) => `${point.x},${point.y}`).join(" "), maxTokens, count: ordered.length };
  }, [visibleSeries]);

  const hostName = (id: string) => summary?.hosts.find((host) => host.id === id)?.name ?? id;
  return <main className="aa-usage-page">
    <header className="aa-usage-header">
      <div className="aa-usage-controls">
        <div className="aa-date-range-picker" onKeyDown={(event) => { if (event.key === "Escape") setRangePickerOpen(false); }}>
          <button className="aa-date-range-trigger" type="button" aria-haspopup="dialog" aria-expanded={rangePickerOpen} onClick={() => { setRangeDraft(dateInputsFromRange(range)); setRangeError(""); setRangePickerOpen((open) => !open); }}>
            {rangePreset === "custom" ? formatDateRange(range) : usageRangePresets.find((preset) => preset.value === rangePreset)?.label ?? formatDateRange(range)} <span aria-hidden="true">⌄</span>
          </button>
          {rangePickerOpen ? <div className="aa-date-range-popover" role="dialog" aria-label="Choose usage date range">
            <div className="aa-date-range-presets"><span>Presets</span>{usageRangePresets.map((preset) => <button key={preset.value} type="button" onClick={() => selectRangePreset(preset.value)}>{preset.label}</button>)}</div>
            <div className="aa-date-range-custom"><strong>Custom range</strong><label>From<input aria-label="Usage start date" type="date" max={localDateInput(new Date())} value={rangeDraft.from} onChange={(event) => { const from = event.currentTarget.value; setRangeDraft((draft) => ({ ...draft, from })); setRangePreset("custom"); setRangeError(""); }} /></label><label>To<input aria-label="Usage end date" type="date" min={rangeDraft.from} max={localDateInput(new Date())} value={rangeDraft.to} onChange={(event) => { const to = event.currentTarget.value; setRangeDraft((draft) => ({ ...draft, to })); setRangePreset("custom"); setRangeError(""); }} /></label>{rangeError ? <p role="alert">{rangeError}</p> : null}<button className="aa-date-range-apply" type="button" onClick={applyRangeDraft}>Apply range</button></div>
          </div> : null}
        </div>
        <select aria-label="Filter by account" value={accountId} onChange={(event) => setAccountId(event.currentTarget.value)}><option value="all">All accounts</option>{summary?.accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select>
        <select aria-label="Filter by provider" value={provider} onChange={(event) => setProvider(event.currentTarget.value === "codex" || event.currentTarget.value === "opencode-go" ? event.currentTarget.value : "all")}><option value="all">All providers</option><option value="codex">Codex</option><option value="opencode-go">OpenCode Go</option></select>
        <select aria-label="Filter by machine" value={hostId} onChange={(event) => setHostId(event.currentTarget.value)}><option value="all">All machines</option>{summary?.hosts.map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}</select>
        <label className="aa-usage-refresh-setting"><span>Provider refresh</span><select aria-label="Provider usage refresh interval" value={refreshIntervalMinutes} disabled={savingRefreshInterval} onChange={(event) => void saveRefreshInterval(event.currentTarget.value)}>{Array.from({ length: 60 }, (_, index) => index + 1).map((minutes) => <option key={minutes} value={minutes}>Every {minutes} min</option>)}</select></label>
        {refreshIntervalError ? <span className="aa-usage-refresh-error" role="alert">{refreshIntervalError}</span> : null}
        <button className="aa-quiet" type="button" disabled={refreshing} onClick={() => void load(true)}>{refreshing ? "Refreshing…" : "↻ Refresh"}</button>
      </div>
    </header>
    <nav className="aa-usage-tabs" aria-label="Usage view">
      <button className={view === "limits" ? "is-active" : ""} type="button" aria-pressed={view === "limits"} onClick={() => setView("limits")}>Limits</button>
      <button className={view === "tokens" ? "is-active" : ""} type="button" aria-pressed={view === "tokens"} onClick={() => setView("tokens")}>Tokens</button>
      <span>Updated {formatTimestamp(summary?.refreshedAt ?? null)}</span>
    </nav>
    {error ? <p className="aa-usage-message" role="alert">{error}</p> : null}
    {loading && !summary ? <p className="aa-usage-message">Loading usage history…</p> : null}
    {!loading && !error && summary && view === "limits" ? <>
      <section className="aa-usage-section"><div className="aa-usage-section-heading"><div><h2>Current plan windows</h2><p>Remaining is calculated as 100% minus the provider’s reported usage.</p></div><div className="aa-layout-switch" role="group" aria-label="Limits layout"><button className={limitsLayout === "accounts" ? "is-active" : ""} aria-pressed={limitsLayout === "accounts"} type="button" onClick={() => setLimitsLayout("accounts")}>Accounts</button><button className={limitsLayout === "comparison" ? "is-active" : ""} aria-pressed={limitsLayout === "comparison"} type="button" onClick={() => setLimitsLayout("comparison")}>Compare</button></div></div>
        {visibleQuota.length ? limitsLayout === "accounts" ? <div className="aa-provider-groups">{["codex", "opencode-go"].map((providerName) => {
          const providerEntries = visibleQuota.filter((entry) => entry.provider === providerName);
          if (providerEntries.length === 0) return null;
          const accountGroups = Array.from(new Map(providerEntries.map((entry) => [`${entry.accountId}:${entry.hostId}`, providerEntries.filter((candidate) => candidate.accountId === entry.accountId && candidate.hostId === entry.hostId)])).entries());
          return <section className="aa-provider-group" key={providerName}><h3>{providerName === "codex" ? "Codex" : "OpenCode Go"}</h3><div className="aa-account-groups">{accountGroups.map(([groupKey, entries]) => {
            const first = entries[0];
            if (!first) return null;
            const banked = summary.bankedResets.find((item) => item.accountId === first.accountId && item.hostId === first.hostId);
            return <article className={`aa-account-quota is-${first.provider}`} key={groupKey}><header><div className="aa-account-identity"><FooterProviderMark provider={first.provider} /><div><strong>{first.accountName}</strong><span>{hostName(first.hostId)}</span></div></div>{banked && banked.balance > 0 ? <BankedResetDetails entry={banked} /> : null}</header>
              {sortQuotaWindows(entries).map((entry) => <div className="aa-account-window" key={entry.windowKey}><div className="aa-window-heading"><strong>{entry.label}</strong><span className={`aa-quota-status ${entry.status === "ok" ? "is-ok" : "is-stale"}`}>{entry.status === "ok" ? "Current" : entry.status}</span></div><div className="aa-window-value"><strong>{entry.remainingPercent.toFixed(0)}% <small>left</small></strong><span>{entry.usedPercent.toFixed(0)}% used</span></div><div className="aa-quota-track" role="progressbar" aria-label={`${first.accountName} ${entry.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.remainingPercent}><span className={quotaTone(entry.remainingPercent)} style={{ width: `${entry.remainingPercent}%` }} /></div><div className="aa-window-meta"><span>{formatReset(entry.resetsAt)}</span><span>Updated {new Date(entry.capturedAt).toLocaleTimeString()}</span></div><QuotaSparkline range={range} history={visibleHistory.filter((point) => point.accountId === entry.accountId && point.hostId === entry.hostId && point.windowKey === entry.windowKey)} />{entry.message ? <p className="aa-quota-error">{entry.message}</p> : null}</div>)}
            </article>;
          })}</div></section>;
        })}</div> : <div className="aa-provider-groups">{["codex", "opencode-go"].map((providerName) => {
          const providerEntries = visibleQuota.filter((entry) => entry.provider === providerName);
          if (providerEntries.length === 0) return null;
          const windows = Array.from(new Set(providerEntries.map((entry) => entry.windowKey))).sort((left, right) => quotaWindowRank(providerEntries.find((entry) => entry.windowKey === left)?.label ?? "") - quotaWindowRank(providerEntries.find((entry) => entry.windowKey === right)?.label ?? ""));
          return <section className="aa-provider-group" key={providerName}><h3>{providerName === "codex" ? "Codex" : "OpenCode Go"}</h3><div className="aa-comparison-windows">{windows.map((windowKey) => {
            const entries = providerEntries.filter((entry) => entry.windowKey === windowKey);
            const first = entries[0];
            if (!first) return null;
            const averageRemaining = Math.round(entries.reduce((total, entry) => total + entry.remainingPercent, 0) / entries.length);
            const changes = entries.map((entry) => quotaHistoryChange(entry, visibleHistory)).filter((change) => change !== null);
            const averageChange = changes.length ? Math.round(changes.reduce((total, change) => total + change, 0) / changes.length) : null;
            return <article className="aa-comparison-window" key={windowKey}><header className="aa-comparison-summary"><div><h4>{first.label}</h4><span>{entries.length} {entries.length === 1 ? "account" : "accounts"}</span></div><strong className={quotaTone(averageRemaining)}>{averageRemaining}% <small>left</small></strong><span className={`aa-comparison-trend ${averageChange === null ? "is-empty" : averageChange >= 0 ? "is-rising" : "is-falling"}`}>{averageChange === null ? "Trend starts with next snapshot" : `${averageChange >= 0 ? "↗ +" : "↘ "}${averageChange}%`}</span></header><div className="aa-comparison-accounts">{entries.map((entry) => <div className="aa-comparison-account" key={`${entry.accountId}:${entry.hostId}`}><div className="aa-comparison-label"><strong>{entry.accountName}</strong><span>{hostName(entry.hostId)} · {entry.remainingPercent.toFixed(0)}% left · {formatReset(entry.resetsAt)}</span></div><div className="aa-comparison-track" role="progressbar" aria-label={`${entry.accountName} ${entry.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.remainingPercent}><span className={quotaTone(entry.remainingPercent)} style={{ width: `${entry.remainingPercent}%` }} /></div></div>)}</div></article>;
          })}</div></section>;
        })}</div> : <p className="aa-usage-empty">No quota snapshots yet. Refresh to query connected account providers.</p>}
      </section>
      <details className="aa-usage-section aa-history-details"><summary><span><strong>Limit history</strong><small>Deduplicated snapshots by account, machine and plan window</small></span><span>{visibleHistory.length} points</span></summary>
        {visibleHistory.length ? <div className="aa-usage-table-wrap"><table className="aa-usage-table"><thead><tr><th>Provider</th><th>Account</th><th>Window</th><th>Machine</th><th>Remaining</th><th>Reset</th><th>Captured</th></tr></thead><tbody>{visibleHistory.map((entry) => <tr key={`${entry.accountId}:${entry.hostId}:${entry.windowKey}:${entry.capturedAt}`}><td>{entry.provider === "codex" ? "Codex" : "OpenCode Go"}</td><td>{entry.accountName}</td><td>{entry.label}</td><td>{hostName(entry.hostId)}</td><td>{entry.remainingPercent.toFixed(0)}%</td><td>{formatReset(entry.resetsAt)}</td><td>{new Date(entry.capturedAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="aa-usage-empty">BB keeps new snapshots from the time the collector is enabled.</p>}
      </details>
    </> : null}
    {!loading && !error && summary && view === "tokens" ? <>
      <section className="aa-token-metrics"><article><span>Processed tokens</span><strong>{formatCount(visibleTotals.totalTokens)}</strong><small>{formatCount(visibleTotals.activeTokens)} in active turns</small></article><article><span>Input</span><strong>{formatCount(visibleTotals.inputTokens)}</strong><small>{formatCount(visibleTotals.cachedInputTokens)} cached input</small></article><article><span>Output</span><strong>{formatCount(visibleTotals.outputTokens)}</strong><small>{formatCount(visibleTotals.reasoningOutputTokens)} reasoning tokens</small></article><article><span>Cache detail</span><strong>{formatCount(visibleTotals.cacheReadInputTokens + visibleTotals.cacheWriteInputTokens)}</strong><small>{formatCount(visibleTotals.cacheReadInputTokens)} read · {formatCount(visibleTotals.cacheWriteInputTokens)} writes</small></article></section>
      <section className="aa-usage-section aa-token-chart-section"><div className="aa-usage-section-heading"><div><h2>Token volume</h2><p>Grouped by time and account. Hover points for exact counts.</p></div><strong>Peak {formatCount(timeline.maxTokens)}</strong></div>
        {timeline.count ? <div className="aa-token-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Token usage from ${formatDateRange(range)}; peak bucket ${formatCount(timeline.maxTokens)} tokens`}><defs><linearGradient id="aa-token-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#2e9a80" stopOpacity=".28" /><stop offset="100%" stopColor="#2e9a80" stopOpacity="0" /></linearGradient></defs><polyline points={timeline.points} fill="none" stroke="#2e9a80" strokeWidth="1.4" vectorEffect="non-scaling-stroke" /><polygon points={`0,100 ${timeline.points} 100,100`} fill="url(#aa-token-fill)" /></svg><div className="aa-token-chart-axis"><span>{new Date(visibleSeries[0]?.bucketAt ?? Date.now()).toLocaleDateString()}</span><span>{new Date(visibleSeries.at(-1)?.bucketAt ?? Date.now()).toLocaleDateString()}</span></div></div> : <p className="aa-usage-empty">No token history in this range. BB imports local provider history and records BB sessions.</p>}
      </section>
      <section className="aa-usage-section"><div className="aa-usage-section-heading"><div><h2>Breakdown</h2><p>Detailed token totals by account, model and source.</p></div></div>
        {visibleBreakdown.length ? <div className="aa-usage-table-wrap"><table className="aa-usage-table"><thead><tr><th>Account</th><th>Model</th><th>Source</th><th>Project</th><th>Thread</th><th>Total</th><th>Input</th><th>Output</th><th>Reasoning</th></tr></thead><tbody>{visibleBreakdown.map((entry) => { const threadId = entry.threadId; return <tr key={`${entry.accountId}:${entry.hostId}:${threadId ?? "local"}:${entry.model ?? "unknown"}:${entry.source}`}><td>{entry.accountName}</td><td>{entry.model ?? "Model unavailable"}</td><td>{entry.source}</td><td>{entry.projectId ?? "—"}</td><td>{threadId ? <button className="aa-usage-table-link" type="button" onClick={() => navigate.toThread(threadId)}>Open BB thread</button> : "—"}</td><td>{formatCount(entry.totalTokens)}</td><td>{formatCount(entry.inputTokens)}</td><td>{formatCount(entry.outputTokens)}</td><td>{formatCount(entry.reasoningOutputTokens)}</td></tr>; })}</tbody></table></div> : <p className="aa-usage-empty">No token breakdown yet. Provider history does not include transcript content.</p>}
      </section>
      <section className="aa-usage-section"><div className="aa-usage-section-heading"><div><h2>Collection coverage</h2><p>History stays in this plugin’s local database. Credential files and conversation text are never copied into it.</p></div></div><div className="aa-source-list">{summary.sources.map((source) => <article key={`${source.accountId}:${source.source}`}><strong>{summary.accounts.find((account) => account.id === source.accountId)?.displayName ?? source.accountId}</strong><span>{source.source}</span><span>{source.status}</span><small>{formatTimestamp(source.lastScannedAt)}{source.message ? ` · ${source.message}` : ""}</small></article>)}{summary.sources.length === 0 ? <p className="aa-usage-empty">Local history scans report here after the first refresh.</p> : null}</div></section>
    </> : null}
  </main>;
};

const recentUsageRange = () => ({ startAt: Date.now() - 24 * 60 * 60 * 1000, endAt: Date.now() });

const UsageFooter = ({ dismiss }: { dismiss(): void }) => {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [providerTab, setProviderTab] = useState<"all" | "codex" | "opencode-go">("all");
  const [hostFilter, setHostFilter] = useState("all");
  const refresh = async () => {
    setRefreshing(true);
    try { setSummary(await rpc.call("refreshUsage", { range: recentUsageRange() })); } catch { setSummary(null); }
    finally { setRefreshing(false); }
  };
  useEffect(() => { void rpc.call("usageSummary", { range: recentUsageRange() }).then(setSummary).catch(() => setSummary(null)); }, []);
  const hostName = (id: string) => summary?.hosts.find((host) => host.id === id)?.name ?? id;
  const visibleQuota = summary?.quota.filter((entry) => hostFilter === "all" || entry.hostId === hostFilter) ?? [];
  const providers = Array.from(new Set(visibleQuota.map((entry) => entry.provider)));
  const activeProvider = providerTab !== "all" && !providers.includes(providerTab) ? "all" : providerTab;
  const providerQuota = activeProvider === "all" ? visibleQuota : visibleQuota.filter((entry) => entry.provider === activeProvider);
  const accounts = Array.from(new Map(providerQuota.map((entry) => [`${entry.accountId}:${entry.hostId}`, providerQuota.filter((candidate) => candidate.accountId === entry.accountId && candidate.hostId === entry.hostId)])).values());
  return <section className="aa-usage-footer" aria-label="AI account usage">
    <header className="aa-footer-toolbar"><nav className="aa-footer-provider-tabs" role="tablist" aria-label="AI account provider"><button className={`is-all ${activeProvider === "all" ? "is-active" : ""}`} role="tab" aria-label="All accounts" title="All accounts" aria-selected={activeProvider === "all"} type="button" onClick={() => setProviderTab("all")}>All</button>{providers.map((entry) => <button key={entry} role="tab" aria-label={entry === "codex" ? "Codex" : "OpenCode Go"} title={entry === "codex" ? "Codex" : "OpenCode Go"} aria-selected={activeProvider === entry} className={activeProvider === entry ? "is-active" : ""} type="button" onClick={() => setProviderTab(entry)}><FooterProviderMark provider={entry} /></button>)}</nav>
      <select aria-label="Usage machine" value={hostFilter} onChange={(event) => setHostFilter(event.currentTarget.value)}><option value="all">All machines</option>{summary?.hosts.map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}</select>
      <button className="aa-footer-icon-button" type="button" aria-label={refreshing ? "Refreshing usage" : "Refresh usage"} disabled={refreshing} onClick={() => void refresh()}>{refreshing ? "…" : "↻"}</button>
      <button className="aa-footer-icon-button" type="button" aria-label="Close AI account usage" onClick={dismiss}><span className="aa-footer-chevron" aria-hidden="true" /></button>
    </header>
    <div className="aa-footer-accounts">{accounts.map((entries) => {
      const first = entries[0];
      if (!first) return null;
      const banked = summary?.bankedResets.find((item) => item.accountId === first.accountId && item.hostId === first.hostId);
      return <article className="aa-footer-account" key={`${first.accountId}:${first.hostId}`}><header><strong>{first.accountName}</strong><span>{hostName(first.hostId)}</span></header>
        {sortQuotaWindows(entries).map((entry) => <div className="aa-footer-window" key={entry.windowKey}><div className="aa-footer-window-heading"><span>{entry.label}</span><strong>{entry.remainingPercent.toFixed(0)}% left</strong></div><div className="aa-footer-track" role="progressbar" aria-label={`${entry.accountName} ${entry.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.remainingPercent}><span className={quotaTone(entry.remainingPercent)} style={{ width: `${entry.remainingPercent}%` }} /></div><div className="aa-footer-window-meta"><span>{formatReset(entry.resetsAt)}</span><span>{new Date(entry.capturedAt).toLocaleTimeString()}</span></div></div>)}
        {banked && banked.balance > 0 ? <BankedResetDetails entry={banked} compact /> : null}
      </article>;
    })}{accounts.length === 0 ? <p className="aa-footer-empty">No current usage windows for this provider.</p> : null}</div>
    <button className="aa-usage-footer-open" type="button" onClick={() => { dismiss(); navigate.toPluginPanel("accounts", { subPath: "usage" }); }}>Open usage history</button>
  </section>;
};

const AccountPanel = ({ subPath }: { subPath: string }) => {
  const navigate = useBbNavigate();
  return <div className="aa-account-panel"><nav className="aa-account-panel-tabs" aria-label="AI Accounts pages">
    <button className={subPath === "usage" ? "" : "is-active"} type="button" aria-current={subPath === "usage" ? undefined : "page"} onClick={() => navigate.toPluginPanel("accounts")}>Accounts</button>
    <button className={subPath === "usage" ? "is-active" : ""} type="button" aria-current={subPath === "usage" ? "page" : undefined} onClick={() => navigate.toPluginPanel("accounts", { subPath: "usage" })}>Usage</button>
  </nav>{subPath === "usage" ? <UsagePage /> : <AccountPage />}</div>;
};

export default definePluginApp((app) => {
  app.composer.customize({
    id: "ai-accounts-model-search",
    actions: [{ id: "global-model-picker", component: GlobalModelPicker }],
  });
  app.slots.navPanel({
    id: "accounts",
    title: "AI Accounts",
    icon: "Bot",
    path: "accounts",
    component: AccountPanel,
  });
  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "ai-accounts-usage",
    label: "AI account usage",
    icon: "ChartColumn",
    component: UsageFooter,
  });
});
