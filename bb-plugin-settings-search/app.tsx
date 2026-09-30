import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { CatalogPlugin, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

function PluginFinderPage() {
  const rpc = useRpc<typeof rpcContract>();
  const searchGeneration = useRef(0);
  const [query, setQuery] = useState("");
  const [plugins, setPlugins] = useState<CatalogPlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<CatalogPlugin | null>(null);
  const [plan, setPlan] = useState<{ displayName: string; sourceDetails: string; sourceFingerprint: string } | null>(null);
  const [workingEntryId, setWorkingEntryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const search = useCallback(async (searchQuery: string) => {
    const generation = searchGeneration.current + 1;
    searchGeneration.current = generation;
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery === "") {
      setPlugins([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await rpc.call("catalog_search", { query: normalizedQuery });
      if (searchGeneration.current !== generation) return;
      setPlugins(result.plugins);
    } catch (cause) {
      if (searchGeneration.current !== generation) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (searchGeneration.current === generation) setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    const timer = setTimeout(() => void search(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query, search]);

  const review = async (entry: CatalogPlugin) => {
    setWorkingEntryId(entry.entryId);
    setReviewing(entry);
    setPlan(null);
    setNotice(null);
    setError(null);
    try {
      const nextPlan = await rpc.call("catalog_plan", {
        entryId: entry.entryId,
        marketplace: entry.marketplace,
      });
      setPlan(nextPlan);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setReviewing(null);
    } finally {
      setWorkingEntryId(null);
    }
  };

  const install = async () => {
    if (reviewing === null || plan === null) return;
    setWorkingEntryId(reviewing.entryId);
    setError(null);
    try {
      const result = await rpc.call("catalog_install", {
        entryId: reviewing.entryId,
        marketplace: reviewing.marketplace,
        sourceFingerprint: plan.sourceFingerprint,
      });
      setNotice(`${result.displayName} was added.`);
      setReviewing(null);
      setPlan(null);
      await search(query.trim());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      if (message.startsWith("Install source changed since review.")) {
        setPlan(null);
        try {
          const updatedPlan = await rpc.call("catalog_plan", {
            entryId: reviewing.entryId,
            marketplace: reviewing.marketplace,
          });
          setPlan(updatedPlan);
          setError("The install source changed. Review the updated source before confirming.");
        } catch (planCause) {
          setError(planCause instanceof Error ? planCause.message : String(planCause));
        }
      }
    } finally {
      setWorkingEntryId(null);
    }
  };

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-8 pt-5 md:px-6 md:pt-7">
        <h1 className="text-xl font-semibold tracking-tight">Find a plugin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search the BB plugin catalog and add what you need here.
        </p>

        <div className="relative mt-5">
          <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or what you need…"
            aria-label="Search plugins"
            className="pl-9"
          />
        </div>

        {notice === null ? null : (
          <p role="status" className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            {notice}
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {reviewing === null ? null : (
          <section aria-label="Review plugin install" className="mt-4 rounded-lg border border-primary/40 bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-medium">Add {reviewing.displayName}?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {reviewing.official
                    ? "This entry is from BB’s reviewed catalog."
                    : `${reviewing.marketplaceDisplayName} is a third-party marketplace and is not reviewed by BB.`}
                </p>
              </div>
              <Icon name="ShieldCheck" className="size-5 shrink-0 text-muted-foreground" />
            </div>
            {plan === null ? (
              <p className="mt-3 text-sm text-muted-foreground">Checking the current install source…</p>
            ) : (
              <>
                <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">{plan.sourceDetails}</pre>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => { setReviewing(null); setPlan(null); }} disabled={workingEntryId !== null}>
                    Cancel
                  </Button>
                  <Button onClick={() => void install()} disabled={workingEntryId !== null || plan === null}>
                    {workingEntryId === reviewing.entryId ? <Icon name="LoaderCircle" className="size-4 animate-spin" /> : <Icon name="Plus" className="size-4" />}
                    Add plugin
                  </Button>
                </div>
              </>
            )}
          </section>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground" aria-live="polite">
          <span>{loading ? "Searching…" : query.trim() === "" ? "Search the catalog" : `${plugins.length} ${plugins.length === 1 ? "result" : "results"}`}</span>
          <span>Plugin installs are managed by BB</span>
        </div>

        {loading && plugins.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Loading the catalog…</div>
        ) : error !== null && plugins.length === 0 ? null : plugins.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {query.trim() === "" ? "Type a plugin name or capability to search the catalog." : "No matches. Try a shorter search or a different phrase."}
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {plugins.map((entry) => (
              <li key={`${entry.marketplace}:${entry.entryId}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{entry.displayName}</h2>
                    {entry.official ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">BB catalog</span> : null}
                    {entry.installed ? <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Icon name="Check" className="size-3" /> Added</span> : null}
                    {!entry.compatible ? <span className="text-[11px] text-destructive">Incompatible</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{entry.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {entry.author === null ? entry.marketplaceDisplayName : `By ${entry.author} · ${entry.marketplaceDisplayName}`}
                    {entry.installs === null ? "" : ` · ${entry.installs.toLocaleString()} installs`}
                  </p>
                  {!entry.compatible && entry.incompatibleReason !== null ? <p className="mt-1 text-xs text-destructive">{entry.incompatibleReason}</p> : null}
                </div>
                <Button
                  variant={entry.installed ? "outline" : "default"}
                  disabled={entry.installed || !entry.compatible || workingEntryId !== null}
                  onClick={() => void review(entry)}
                  className="shrink-0"
                >
                  {workingEntryId === entry.entryId ? <Icon name="LoaderCircle" className="size-4 animate-spin" /> : <Icon name={entry.installed ? "Check" : "Plus"} className="size-4" />}
                  {entry.installed ? "Added" : "Add"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Before adding a plugin, review its publisher and install source. Third-party marketplace entries are not reviewed by BB.
        </p>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "plugin-catalog",
    title: "Find plugins",
    description: "Search the BB plugin catalog and add a plugin without leaving Settings.",
    component: PluginFinderPage,
  });
  app.slots.navPanel({
    id: "plugin-finder",
    title: "Add plugins",
    icon: "Puzzle",
    path: "add-plugins",
    component: PluginFinderPage,
  });
});
