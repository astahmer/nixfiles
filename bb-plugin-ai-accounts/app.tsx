import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { definePluginApp, useBbContext, useComposer, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { AccountProfile, rpcContract } from "./server";
import "./app.css";

const reasoningEffortValues = ["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"] as const;
type ReasoningEffort = typeof reasoningEffortValues[number];
const isReasoningEffort = (value: string): value is ReasoningEffort => reasoningEffortValues.some((effort) => effort === value);

const GlobalModelPicker = () => {
  const composer = useComposer();
  const sdk = useSdk();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<Array<{ providerId: string; providerName: string; badge: string; color: string; model: string; displayName: string; reasoningEffort: ReasoningEffort }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [popoverPosition, setPopoverPosition] = useState({ left: 12, top: 12, maxHeight: 560 });
  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return models;
    const terms = normalizedQuery.split(/\s+/u);
    return models.filter((entry) => {
      const searchable = `${entry.displayName} ${entry.model} ${entry.providerName} ${entry.badge}`.toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    });
  }, [models, query]);

  useEffect(() => {
    if (!open || models.length || loading) return;
    let active = true;
    setLoading(true);
    setError("");
    void sdk.providers.list().then(async (providers) => {
      const accountProviders = providers.filter((provider) => provider.id.startsWith("ai-account-"));
      const catalogs = await Promise.all(accountProviders.map(async (provider) => {
        try {
          const result = await sdk.providers.models({ providerId: provider.id });
          return result.models.map((model) => ({
            providerId: provider.id,
            providerName: provider.displayName.replace(/^[^·]+·\s*/u, ""),
            badge: provider.displayName.match(/^([^·]+)·/u)?.[1]?.trim() ?? provider.displayName.slice(0, 2).toUpperCase(),
            color: provider.strings?.iconTint?.dark ?? "#64748B",
            model: model.model,
            displayName: model.displayName,
            reasoningEffort: model.defaultReasoningEffort,
          }));
        } catch {
          return [];
        }
      }));
      if (active) setModels(catalogs.flat().sort((left, right) => left.displayName.localeCompare(right.displayName) || left.providerName.localeCompare(right.providerName)));
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

  return <div className="aa-global-picker">
    <button className="aa-global-picker-trigger" type="button" aria-expanded={open} onClick={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const roomBelow = window.innerHeight - bounds.bottom - 12;
      const roomAbove = bounds.top - 12;
      const placeBelow = roomBelow >= roomAbove;
      const maxHeight = Math.max(120, Math.min(560, placeBelow ? roomBelow : roomAbove - 8));
      setPopoverPosition({
        left: Math.max(12, Math.min(bounds.left, window.innerWidth - 452)),
        top: placeBelow ? bounds.bottom + 8 : Math.max(12, bounds.top - maxHeight - 8),
        maxHeight,
      });
      setOpen((current) => !current);
    }}>All models <span aria-hidden="true">⌄</span></button>
    {open ? createPortal(<section className="aa-global-picker-popover" style={{ left: `${popoverPosition.left}px`, top: `${popoverPosition.top}px`, maxHeight: `${popoverPosition.maxHeight}px` }} aria-label="Search all account models">
      <label className="aa-global-picker-search"><span aria-hidden="true">⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search all accounts and models" /></label>
      <div className="aa-global-picker-results">
        {loading ? <p className="aa-global-picker-empty">Loading account models…</p> : null}
        {!loading && error ? <p className="aa-global-picker-empty">{error}</p> : null}
        {!loading && !error && visibleModels.length === 0 ? <p className="aa-global-picker-empty">No matching account models.</p> : null}
        {visibleModels.map((entry) => <button className="aa-global-picker-row" type="button" key={`${entry.providerId}:${entry.model}`} onClick={() => void selectModel(entry)}>
          <span className="aa-account-badge" style={{ backgroundColor: entry.color }}>{entry.badge}</span>
          <span className="aa-global-picker-row-copy"><strong>{entry.displayName}</strong><small>{entry.providerName} · {entry.model}</small></span>
          <span className="aa-global-picker-effort">{entry.reasoningEffort}</span>
        </button>)}
      </div>
      <footer className="aa-global-picker-footer">Reasoning effort follows the model default. Change it separately in the composer.</footer>
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
  const [draft, setDraft] = useState({ displayName: "", path: "", hiddenText: "", badge: "", accentColor: "#2563EB" });
  const [machines, setMachines] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [selectedHostId, setSelectedHostId] = useState("");
  const [catalog, setCatalog] = useState<Array<{ id: string; displayName: string; isDefault: boolean; supportedReasoningEfforts: Array<{ reasoningEffort: ReasoningEffort; description: string }>; defaultReasoningEffort: ReasoningEffort }>>([]);
  const [customDraft, setCustomDraft] = useState({ id: "", displayName: "" });
  const [customModelFormOpen, setCustomModelFormOpen] = useState(false);
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
    if (!selected) return;
    setScopeMode(selectedHostId ? "machine" : "default");
    setScopeHostId(selectedHostId);
    setDraft({
      displayName: selected.displayName,
      path: selected.path,
      hiddenText: selected.hiddenModelIds.join("\n"),
      badge: selected.badge ?? selected.displayName.split(/\s+/u).filter(Boolean).map((part) => part[0]).join("").slice(0, 3).toUpperCase(),
      accentColor: selected.accentColor ?? (selected.provider === "codex" ? "#2563EB" : "#7C3AED"),
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
  }, [selected?.id, selectedHostId]);

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
      await persist({ displayName: draft.displayName, path: draft.path, hiddenModelIds, badge: draft.badge, accentColor: draft.accentColor });
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
    await persist({ displayName: draft.displayName, hiddenModelIds, pathOverrides, badge: draft.badge, accentColor: draft.accentColor });
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
    const next = new Set(selected.hiddenModelIds);
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

  const moveModel = (modelId: string, direction: -1 | 1) => {
    if (!selected) return;
    const order = orderedModels.map((model) => model.id);
    const index = order.indexOf(modelId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
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
    const globalIndex = orderedModels.findIndex((entry) => entry.id === model.id);
    return (
      <div className={"aa-model-row " + (isHidden ? "is-hidden" : "")} key={model.id}>
        <button className="aa-favorite" aria-label={isFavorite ? "Remove favorite" : "Add favorite"} onClick={() => updateFavorites(model.id)}>{isFavorite ? "★" : "☆"}</button>
        <span className="aa-model-copy"><strong>{model.displayName}</strong><small>{model.id}{model.isDefault ? " · default" : ""}</small></span>
        <div className="aa-model-actions">
          <select className="aa-reasoning-default" aria-label={"Default reasoning effort for " + model.displayName} value={selected?.modelReasoningDefaults[model.id] ?? model.defaultReasoningEffort} onChange={(event) => { if (isReasoningEffort(event.currentTarget.value)) updateReasoningDefault(model.id, event.currentTarget.value); }}>
            {model.supportedReasoningEfforts.map((effort) => <option key={effort.reasoningEffort} value={effort.reasoningEffort}>{effort.description}</option>)}
          </select>
          <button title="Move up" aria-label="Move up" disabled={globalIndex === 0} onClick={() => moveModel(model.id, -1)}>↑</button><button title="Move down" aria-label="Move down" disabled={globalIndex === orderedModels.length - 1} onClick={() => moveModel(model.id, 1)}>↓</button><label className="aa-model-switch" title={isHidden ? "Show in picker" : "Hide from picker"}><input type="checkbox" checked={!isHidden} onChange={(event) => updateModelVisibility(model.id, event.currentTarget.checked)} /><span /></label>{isCustom ? <button title="Remove custom model" aria-label="Remove custom model" onClick={() => removeCustomModel(model.id)}>×</button> : null}
        </div>
      </div>
    );
  });

  return (
    <main className="aa-page">
      <header className="aa-page-toolbar">
        <h1>AI Accounts</h1>
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
          <div className="aa-rail-heading"><span>YOUR ACCOUNTS <i>{accounts.length}</i></span><div className="aa-add-actions"><button disabled={saving} onClick={() => void addAccount("codex")}>＋ Codex</button><button disabled={saving} onClick={() => void addAccount("opencode-go")}>＋ OpenCode Go</button></div></div>
          {accounts.length === 0 && <p className="aa-empty">Add an account to give it a private provider entry in the model picker.</p>}
          {(["codex", "opencode-go"] as const).map((provider) => {
            const providerAccounts = accounts.filter((account) => account.provider === provider);
            if (!providerAccounts.length) return null;
            return (
              <section className="aa-group" key={provider}>
                <h2>{provider === "codex" ? "CODEX" : "OPENCODE GO"}</h2>
                {providerAccounts.map((account) => (
                  <button className={"aa-account-row " + (selectedId === account.id ? "is-selected" : "")} key={account.id} onClick={() => setSelectedId(account.id)}>
                    <span className={"aa-mark " + (provider === "codex" ? "codex" : "opencode")} style={{ backgroundColor: account.accentColor ?? "#2563EB" }}>{account.badge ?? account.displayName.slice(0, 2).toUpperCase()}</span>
                    <span className="aa-row-copy"><strong>{account.displayName}</strong><small>{account.email ?? "Email not detected"}</small></span>
                    <i className={account.enabled ? "aa-dot" : "aa-dot is-off"} />
                  </button>
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

            <section className="aa-section">
              <div className="aa-section-heading"><div><span className="aa-index">01</span><h3>Account identity</h3></div><button className="aa-quiet" onClick={() => void refreshIdentity()} disabled={selected.provider !== "codex"}>↻ Refresh</button></div>
              <div className="aa-field-grid identity">
                <label>Display name<input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.currentTarget.value }))} /></label>
                <label>Signed-in email<input readOnly value={identityEmail ?? (selected.provider === "codex" ? "Sign in, then refresh" : "OpenCode Go key login")} /></label>
                <label>Picker tag<input value={draft.badge} maxLength={4} onChange={(event) => setDraft((current) => ({ ...current, badge: event.currentTarget.value.toUpperCase() }))} placeholder="EM" /></label>
                <label>Tag color<input className="aa-color-input" type="color" value={draft.accentColor} onChange={(event) => setDraft((current) => ({ ...current, accentColor: event.currentTarget.value }))} /></label>
              </div>
              <p className="aa-help">The short tag and color distinguish this account in BB’s provider picker. Change them any time.</p>
            </section>

            <section className="aa-section">
              <div className="aa-section-heading"><div><span className="aa-index">02</span><h3>Runtime paths</h3></div><span className="aa-muted">Absolute path on the provider machine</span></div>
              <label className="aa-path-field">{selected.provider === "codex" ? "CODEX_HOME" : "XDG_DATA_HOME"}<input value={draft.path} onChange={(event) => setDraft((current) => ({ ...current, path: event.currentTarget.value }))} spellCheck={false} /></label>
              <p className="aa-help">{selected.provider === "codex" ? "Codex keeps auth.json, config, and its local state in this account home." : "OpenCode keeps auth and data below this XDG data root. Go sign-in uses its API key flow."} Specific project and machine paths override this inherited default.</p>
            </section>

            <section className="aa-section aa-model-section">
              <div className="aa-section-heading"><div><span className="aa-index">03</span><h3>Models</h3></div><button className="aa-quiet" disabled={refreshingCatalog || !selectedHostId} onClick={() => void refreshCatalog()}>{refreshingCatalog ? "Checking…" : "↻ Check now"}</button></div>
              <p className="aa-help">Favorites, visibility, and order are saved on this device. Custom models are added to this account’s provider entry.</p>
              <div className="aa-model-toolbar"><button className="aa-quiet" onClick={() => {
                if (!selected) return;
                const allHidden = catalogModels.every((model) => hiddenModelIds.has(model.id));
                const next = allHidden ? [] : catalogModels.map((model) => model.id);
                setDraft((current) => ({ ...current, hiddenText: next.join("\n") }));
                void persist({ hiddenModelIds: next });
              }}>{catalogModels.length > 0 && catalogModels.every((model) => hiddenModelIds.has(model.id)) ? "Enable all" : "Disable all"}</button><span>{catalogModels.length} models · {favoriteModels.length} favorites · {hiddenModels.length} hidden</span><button className="aa-quiet" onClick={() => setCustomModelFormOpen((open) => !open)}>{customModelFormOpen ? "Cancel" : "＋ Add custom model"}</button></div>
              {catalogModels.length ? <>
                {favoriteModels.length > 0 ? <section className="aa-model-group"><h4>Favorites</h4>{renderModelRows(favoriteModels)}</section> : null}
                <section className="aa-model-group"><h4>All</h4>{renderModelRows(availableModels)}</section>
                {hiddenModels.length > 0 ? <section className="aa-model-group"><h4>Hidden from picker</h4>{renderModelRows(hiddenModels)}</section> : null}
              </> : <p className="aa-empty">{selectedHostId ? "No models returned yet. Sign in on this machine, then refresh the provider catalog." : "Choose a machine to read the provider’s model catalog."}</p>}
              {customModelFormOpen ? <div className="aa-custom-model-form"><label>Model ID<input id="aa-custom-model-id" value={customDraft.id} onChange={(event) => setCustomDraft((current) => ({ ...current, id: event.currentTarget.value }))} placeholder="provider/model-id" /></label><label>Display name<input value={customDraft.displayName} onChange={(event) => setCustomDraft((current) => ({ ...current, displayName: event.currentTarget.value }))} placeholder="Custom model" /></label><button className="aa-quiet" onClick={addCustomModel}>Add model</button></div> : null}
            </section>

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

export default definePluginApp((app) => {
  app.composer.customize({
    id: "ai-accounts-model-search",
    scopes: ["new-thread"],
    actions: [{ id: "global-model-picker", component: GlobalModelPicker }],
  });
  app.slots.navPanel({
    id: "accounts",
    title: "AI Accounts",
    icon: "UsersRound",
    path: "accounts",
    component: AccountPage,
  });
});
