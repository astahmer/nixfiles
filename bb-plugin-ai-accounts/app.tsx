import { useEffect, useState } from "react";
import { definePluginApp, useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import type { AccountProfile, rpcContract } from "./server";
import "./app.css";

const AccountPage = () => {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [identityEmail, setIdentityEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState({ displayName: "", path: "", hiddenText: "" });
  const [machines, setMachines] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [selectedHostId, setSelectedHostId] = useState("");
  const [catalog, setCatalog] = useState<Array<{ id: string; displayName: string; isDefault: boolean }>>([]);
  const [customDraft, setCustomDraft] = useState({ id: "", displayName: "" });
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
      const connected = result.machines.find((machine) => machine.status === "connected");
      if (connected) {
        setSelectedHostId(connected.id);
        setScopeHostId(connected.id);
      }
    }).catch(() => setMachines([]));
  }, []);

  useEffect(() => {
    if (selected?.email) setIdentityEmail(selected.email);
    else setIdentityEmail(null);
  }, [selected?.id, selected?.email]);

  useEffect(() => {
    if (!selected) return;
    setScopeMode("default");
    setScopeHostId("");
    setDraft({
      displayName: selected.displayName,
      path: selected.path,
      hiddenText: selected.hiddenModelIds.join("\n"),
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
        path: root + "/" + count,
        enabled: true,
        hiddenModelIds: [],
        favoriteModelIds: [],
        modelOrder: [],
        customModels: [],
        pathOverrides: [],
      });
      setAccounts((current) => [...current, result.account]);
      setSelectedId(result.account.id);
      setNotice("Account added. Set the absolute path that exists on the machine running its provider.");
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
      ? "CODEX_HOME=" + quotedPath + " codex login"
      : "XDG_DATA_HOME=" + quotedPath + " opencode auth login";
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

  const saveAccount = async () => {
    if (!selected) return;
    const hiddenModelIds = Array.from(new Set(draft.hiddenText.split(/\s+/u).map((model) => model.trim()).filter(Boolean)));
    if (scopeMode === "default") {
      await persist({ displayName: draft.displayName, path: draft.path, hiddenModelIds });
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
    await persist({ displayName: draft.displayName, hiddenModelIds, pathOverrides });
  };

  const hiddenModelIds = new Set(draft.hiddenText.split(/\s+/u).filter(Boolean));
  const catalogModels = selected
    ? [
      ...catalog,
      ...selected.customModels.filter((custom) => !catalog.some((model) => model.id === custom.id)).map((custom) => ({ ...custom, isDefault: false })),
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
        <div className="aa-model-actions"><button title="Move up" aria-label="Move up" disabled={globalIndex === 0} onClick={() => moveModel(model.id, -1)}>↑</button><button title="Move down" aria-label="Move down" disabled={globalIndex === orderedModels.length - 1} onClick={() => moveModel(model.id, 1)}>↓</button><label className="aa-model-switch" title={isHidden ? "Show in picker" : "Hide from picker"}><input type="checkbox" checked={!isHidden} onChange={(event) => updateModelVisibility(model.id, event.currentTarget.checked)} /><span /></label>{isCustom ? <button title="Remove custom model" aria-label="Remove custom model" onClick={() => removeCustomModel(model.id)}>×</button> : null}</div>
      </div>
    );
  });

  return (
    <main className="aa-page">
      <header className="aa-header">
        <div>
          <p className="aa-kicker">ACCOUNT DESK</p>
          <h1>AI Accounts</h1>
          <p className="aa-subtitle">Keep subscription logins separate and choose exactly which provider models BB can offer.</p>
        </div>
        <div className="aa-add-actions">
          <button disabled={saving} onClick={() => void addAccount("codex")}>＋ Codex account</button>
          <button disabled={saving} onClick={() => void addAccount("opencode-go")}>＋ OpenCode Go</button>
        </div>
      </header>

      <div className="aa-layout">
        <aside className="aa-rail" aria-label="Provider accounts">
          <div className="aa-rail-heading"><span>YOUR ACCOUNTS</span><span>{accounts.length}</span></div>
          {accounts.length === 0 && <p className="aa-empty">Add an account to give it a private provider entry in the model picker.</p>}
          {(["codex", "opencode-go"] as const).map((provider) => {
            const providerAccounts = accounts.filter((account) => account.provider === provider);
            if (!providerAccounts.length) return null;
            return (
              <section className="aa-group" key={provider}>
                <h2>{provider === "codex" ? "CODEX" : "OPENCODE GO"}</h2>
                {providerAccounts.map((account) => (
                  <button className={"aa-account-row " + (selectedId === account.id ? "is-selected" : "")} key={account.id} onClick={() => setSelectedId(account.id)}>
                    <span className={"aa-mark " + (provider === "codex" ? "codex" : "opencode")}>{provider === "codex" ? "C" : "O"}</span>
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
                <span className={"aa-mark large " + (selected.provider === "codex" ? "codex" : "opencode")}>{selected.provider === "codex" ? "C" : "O"}</span>
                <div><p className="aa-kicker">{selected.provider === "codex" ? "CHATGPT SUBSCRIPTION" : "OPENCODE SUBSCRIPTION"}</p><h2>{selected.displayName}</h2></div>
              </div>
              <label className="aa-switch-label"><span>{selected.enabled ? "Enabled in model picker" : "Hidden from model picker"}</span><input type="checkbox" checked={selected.enabled} onChange={(event) => void persist({ enabled: event.currentTarget.checked })} /><span className="aa-switch" /></label>
            </div>

            <div className="aa-scope-bar">
              <span>Applying runtime path for</span>
              <select value={scopeMode} onChange={(event) => selectScope(event.currentTarget.value as typeof scopeMode)}>
                <option value="default">All projects · all machines</option>
                <option value="project" disabled={!context.projectId}>This project · all machines</option>
                <option value="machine">All projects · selected machine</option>
                <option value="project-machine" disabled={!context.projectId}>This project · selected machine</option>
              </select>
              {(scopeMode === "machine" || scopeMode === "project-machine") ? <select value={scopeHostId} onChange={(event) => { setScopeHostId(event.currentTarget.value); selectScope(scopeMode, event.currentTarget.value); }}>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select> : null}
            </div>

            <section className="aa-section">
              <div className="aa-section-heading"><div><span className="aa-index">01</span><h3>Account identity</h3></div><button className="aa-quiet" onClick={() => void refreshIdentity()} disabled={selected.provider !== "codex"}>↻ Refresh</button></div>
              <div className="aa-field-grid identity">
                <label>Display name<input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.currentTarget.value }))} /></label>
                <label>Signed-in email<input readOnly value={identityEmail ?? (selected.provider === "codex" ? "Sign in, then refresh" : "OpenCode Go key login")} /></label>
              </div>
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
              }}>{catalogModels.length > 0 && catalogModels.every((model) => hiddenModelIds.has(model.id)) ? "Enable all" : "Disable all"}</button><span>{catalogModels.length} models · {favoriteModels.length} favorites · {hiddenModels.length} hidden</span><button className="aa-quiet" onClick={() => document.getElementById("aa-custom-model-id")?.focus()}>＋ Add custom model</button></div>
              {catalogModels.length ? <>
                {favoriteModels.length > 0 ? <section className="aa-model-group"><h4>Favorites</h4>{renderModelRows(favoriteModels)}</section> : null}
                <section className="aa-model-group"><h4>All</h4>{renderModelRows(availableModels)}</section>
                {hiddenModels.length > 0 ? <section className="aa-model-group"><h4>Hidden from picker</h4>{renderModelRows(hiddenModels)}</section> : null}
              </> : <p className="aa-empty">{selectedHostId ? "No models returned yet. Sign in on this machine, then refresh the provider catalog." : "Choose a machine to read the provider’s model catalog."}</p>}
              <div className="aa-custom-model-form"><label>Model ID<input id="aa-custom-model-id" value={customDraft.id} onChange={(event) => setCustomDraft((current) => ({ ...current, id: event.currentTarget.value }))} placeholder="provider/model-id" /></label><label>Display name<input value={customDraft.displayName} onChange={(event) => setCustomDraft((current) => ({ ...current, displayName: event.currentTarget.value }))} placeholder="Custom model" /></label><button className="aa-quiet" onClick={addCustomModel}>Add model</button></div>
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
  app.slots.navPanel({
    id: "accounts",
    title: "AI Accounts",
    icon: "UsersRound",
    path: "accounts",
    component: AccountPage,
  });
});
