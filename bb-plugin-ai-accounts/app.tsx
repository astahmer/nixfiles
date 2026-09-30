import { useEffect, useState } from "react";
import { definePluginApp, experimental_ProviderModelPicker as ProviderModelPicker, useRpc } from "@get-bb/plugin-sdk/app";
import type { AccountProfile, rpcContract } from "./server";
import "./app.css";

const AccountPage = () => {
  const rpc = useRpc<typeof rpcContract>();
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [identityEmail, setIdentityEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState({ displayName: "", path: "", hiddenText: "" });
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
    if (selected?.email) setIdentityEmail(selected.email);
    else setIdentityEmail(null);
  }, [selected?.id, selected?.email]);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      displayName: selected.displayName,
      path: selected.path,
      hiddenText: selected.hiddenModelIds.join("\n"),
    });
  }, [selected?.id]);

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
    const root = provider === "codex" ? "/Users/your-user/.local/share/bb-ai-accounts/codex" : "/Users/your-user/.local/share/bb-ai-accounts/opencode";
    setSaving(true);
    try {
      const result = await rpc.call("save", {
        provider,
        displayName: provider === "codex" ? "Codex " + count : "OpenCode Go " + count,
        path: root + "/" + count,
        enabled: true,
        hiddenModelIds: [],
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
    const quotedPath = "'" + selected.path.replaceAll("'", "'\\''") + "'";
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
      const result = await rpc.call("identity", { id: selected.id });
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

  const liveProviderId = selected ? "ai-account-" + selected.id.replaceAll("-", "").slice(0, 24) : "";

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
              <p className="aa-help">{selected.provider === "codex" ? "Codex keeps auth.json, config, and its local state in this account home." : "OpenCode keeps auth and data below this XDG data root. Go sign-in uses its API key flow."}</p>
            </section>

            <section className="aa-section aa-model-section">
              <div className="aa-section-heading"><div><span className="aa-index">03</span><h3>Model picker</h3></div><span className="aa-live"><i /> LIVE CATALOG</span></div>
              <p className="aa-help">BB reads model availability from this account’s provider. Open the selector to inspect its current catalog.</p>
              <div className="aa-picker-wrap">
                <ProviderModelPicker value={{ providerId: liveProviderId, model: "", reasoningLevel: "medium" }} onChange={() => undefined} allowProviderChange={false} />
              </div>
              <label className="aa-model-filter">Hide these model IDs<textarea value={draft.hiddenText} onChange={(event) => setDraft((current) => ({ ...current, hiddenText: event.currentTarget.value }))} placeholder="One exact provider model ID per line" spellCheck={false} /></label>
              <p className="aa-help">Model IDs come from the live provider catalog. Hidden IDs are removed from this account’s BB model list; blank keeps every discovered model available.</p>
            </section>

            <footer className="aa-footer">
              <button className="aa-primary" onClick={() => void signIn()}>↗ Copy sign-in command</button>
              <button onClick={() => void persist({
                displayName: draft.displayName,
                path: draft.path,
                hiddenModelIds: Array.from(new Set(draft.hiddenText.split(/\s+/u).map((model) => model.trim()).filter(Boolean))),
              })}>Save changes</button>
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
