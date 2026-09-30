import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./settings-search.css";

type SettingSearchEntry = {
  section: string;
  title: string;
  description?: string;
  keywords?: string;
};

const settingsRoute = /^\/settings(?:\/|$)/;
const settingsIndex: SettingSearchEntry[] = [
  { section: "General", title: "Navigate to threads on creation", description: "Threads & editing" },
  { section: "General", title: "Markdown formatting in prompt box", description: "Threads & editing" },
  { section: "General", title: "Default thread followup behavior", description: "Threads & editing · Queue · Steer", keywords: "queue steer enter follow-up followup" },
  { section: "General", title: "Open links in the in-app browser", description: "Links" },
  { section: "General", title: "Rewrite localhost links", description: "Links · localhost" },
  { section: "General", title: "New branch prefix", description: "Git · worktree branches" },
  { section: "General", title: "bb CLI skills", description: "Skills · install" },
  { section: "General", title: "Microphone", description: "Voice Input · prompt voice input" },
  { section: "General", title: "Streamer mode", description: "Privacy & diagnostics" },
  { section: "General", title: "Share anonymous usage data", description: "Privacy & diagnostics" },
  { section: "General", title: "Show provider environment resolution and unhandled provider events", description: "Privacy & diagnostics · troubleshooting" },
  { section: "General", title: "Changelog preview", description: "Updates · release notes" },
  { section: "General", title: "Legacy plugin loader (JITI)", description: "Plugins · restart" },
  { section: "General", title: "Mobile app", description: "Pairing · remote access" },
  { section: "General", title: "Server move", description: "Machines · export and import" },
  { section: "General", title: "Sidebar progressive disclosure", description: "Sidebar · projects · machines" },
  { section: "General", title: "Experiments", description: "Early features" },
  { section: "Providers", title: "Providers", description: "Default agent · provider order" },
  { section: "AI services", title: "AI services", description: "Thread titles · branch names · voice input" },
  { section: "Appearance", title: "Theme", description: "System · light · dark · colors" },
  { section: "Appearance", title: "Palette", description: "Favicon color · browser tabs" },
  { section: "Appearance", title: "Directory default", description: "File Preferences · open directories" },
  { section: "Appearance", title: "File default", description: "File Preferences · open files" },
  { section: "Appearance", title: "Local editor integration", description: "Enable · editor" },
  { section: "Appearance", title: "Sidebar thread list", description: "Sidebar · plugin" },
  { section: "Appearance", title: "Sidebar navigation", description: "Navigation · destinations" },
  { section: "Appearance", title: "Sidebar header", description: "Header · sidebar toggle" },
  { section: "Appearance", title: "Sidebar footer", description: "Drag to reorder · actions" },
  { section: "Appearance", title: "Fade inactive splits", description: "Split panes" },
  { section: "Appearance", title: "File openers", description: "Default opener · file types" },
  { section: "Keyboard", title: "Keyboard shortcuts", description: "Search shortcuts · reset all" },
  { section: "Keyboard", title: "Show keyboard hints when holding CMD / Control", description: "Shortcut badges" },
  { section: "Browser", title: "Browsers", description: "Installed browsers · refresh" },
  { section: "Files", title: "File Preferences", description: "Open files · folders · editor" },
  { section: "Machines", title: "Machine information", description: "This machine · server" },
  { section: "Machines", title: "Machine updates", description: "Update bb · provider CLIs" },
  { section: "Environment variables", title: "Environment variables", description: "Machine · server" },
  { section: "Updates", title: "Update", description: "Download and restart bb" },
  { section: "Plugin marketplaces", title: "Plugin marketplaces", description: "Add · remove · refresh marketplace" },
  { section: "Community", title: "Community", description: "Discord · GitHub · support" },
  { section: "Archived", title: "Archived threads", description: "Search archived threads" },
];

const normalize = (value: string) =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

const isSettingsPage = () =>
  settingsRoute.test(window.location.pathname) ||
  settingsRoute.test(window.location.hash.replace(/^#/, ""));

const isSettingsLink = (link: HTMLAnchorElement) => {
  try {
    return settingsRoute.test(new URL(link.href, window.location.href).pathname);
  } catch {
    return false;
  }
};

const navRow = (link: HTMLAnchorElement) =>
  link.closest("li, [role='listitem']") ?? link.parentElement ?? link;

const rankEntry = (entry: SettingSearchEntry, query: string) => {
  const title = normalize(entry.title);
  const section = normalize(entry.section);
  const haystack = normalize(`${entry.title} ${entry.description ?? ""} ${entry.keywords ?? ""}`);
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.includes(query)) return 2;
  if (section.includes(query)) return 3;
  return haystack.includes(query) ? 4 : -1;
};

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "settings-search",
    mount: ({ signal }) => {
      let query = "";
      let pendingTitle: string | null = null;
      let pendingPath: string | null = null;
      let searchField: HTMLInputElement | null = null;
      let searchStatus: HTMLSpanElement | null = null;
      let searchContainer: HTMLDivElement | null = null;
      let resultList: HTMLDivElement | null = null;
      const decoratedRows = new Set<HTMLElement>();
      const hiddenRows = new Set<HTMLElement>();

      const clearDecorations = () => {
        for (const row of decoratedRows) row.classList.remove("bb-settings-search-match");
        for (const row of hiddenRows) row.classList.remove("bb-settings-search-hidden");
        decoratedRows.clear();
        hiddenRows.clear();
      };

      const setSearchStatus = (value: string) => {
        if (searchStatus && searchStatus.textContent !== value) searchStatus.textContent = value;
      };

      const findNavigationLink = (section: string, links: HTMLAnchorElement[]) =>
        links.find((link) => normalize(link.textContent ?? "").trim() === normalize(section)) ??
        links.find((link) => normalize(link.textContent ?? "").trim().includes(normalize(section)));

      const findMatchingRow = (main: HTMLElement, title: string) => {
        const normalizedTitle = normalize(title);
        const matches = Array.from(main.querySelectorAll<HTMLElement>("h1,h2,h3,h4,label,button,[role='switch'],[role='combobox'],input,select,textarea"))
          .filter((element) => normalize(element.textContent ?? element.getAttribute("aria-label") ?? "").includes(normalizedTitle));
        const match = matches.sort((left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0))[0];
        if (!match) return null;

        let row = match;
        while (row.parentElement && row.parentElement !== main) {
          const parent = row.parentElement;
          const text = parent.textContent?.trim() ?? "";
          if (text.length > 500) break;
          row = parent;
          if (row.matches("section,fieldset,[role='group']")) break;
        }
        return row;
      };

      const highlightCurrentSettings = (main: HTMLElement, normalizedQuery: string, links: HTMLAnchorElement[]) => {
        const candidates = Array.from(main.querySelectorAll<HTMLElement>("h1,h2,h3,h4,label,button,[role='switch'],[role='combobox'],input,select,textarea"));

        for (const candidate of candidates) {
          const text = candidate.textContent ?? candidate.getAttribute("aria-label") ?? candidate.getAttribute("placeholder") ?? "";
          if (!normalize(text).includes(normalizedQuery)) continue;
          let row = candidate;
          while (row.parentElement && row.parentElement !== main && (row.parentElement.textContent?.length ?? 0) < 500) {
            row = row.parentElement;
            if (row.matches("section,fieldset,[role='group']")) break;
          }
          row.classList.add("bb-settings-search-match");
          decoratedRows.add(row);
        }

        if (pendingTitle && pendingPath === window.location.pathname) {
          const row = findMatchingRow(main, pendingTitle);
          if (row) {
            row.classList.add("bb-settings-search-match");
            row.scrollIntoView({ block: "center", behavior: "smooth" });
            decoratedRows.add(row);
            pendingTitle = null;
            pendingPath = null;
          }
        }
      };

      const renderResults = (matches: SettingSearchEntry[], links: HTMLAnchorElement[]) => {
        if (!resultList) return;
        resultList.replaceChildren();
        for (const entry of matches.slice(0, 30)) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "bb-settings-search-result";
          const title = document.createElement("span");
          title.className = "bb-settings-search-result-title";
          title.textContent = entry.title;
          const detail = document.createElement("span");
          detail.className = "bb-settings-search-result-detail";
          detail.textContent = [entry.section, entry.description].filter(Boolean).join(" · ");
          button.append(title, detail);
          button.addEventListener("click", () => {
            const link = findNavigationLink(entry.section, links);
            if (!link) return;
            const destination = new URL(link.href, window.location.href);
            const current = new URL(window.location.href);
            if (destination.pathname === current.pathname && destination.hash === current.hash) {
              const main = document.querySelector<HTMLElement>("main");
              const row = main && findMatchingRow(main, entry.title);
              row?.scrollIntoView({ block: "center", behavior: "smooth" });
              row?.classList.add("bb-settings-search-match");
              if (row) decoratedRows.add(row);
              return;
            }
            pendingTitle = entry.title;
            pendingPath = destination.pathname;
            link.click();
          });
          resultList.append(button);
        }
      };

      const ensureSearchField = (links: HTMLAnchorElement[]) => {
        if (links.length === 0) {
          searchContainer?.remove();
          searchContainer = null;
          searchField = null;
          searchStatus = null;
          resultList = null;
          return;
        }
        const firstRow = navRow(links[0]!);
        if (searchContainer?.isConnected && searchContainer.parentElement === firstRow.parentElement) return;

        searchContainer?.remove();
        searchContainer = document.createElement("div");
        searchContainer.className = "bb-settings-search";
        searchField = document.createElement("input");
        searchField.type = "search";
        searchField.className = "bb-settings-search-input";
        searchField.placeholder = "Search settings…";
        searchField.setAttribute("aria-label", "Search settings");
        searchField.autocomplete = "off";
        searchField.value = query;
        searchStatus = document.createElement("span");
        searchStatus.className = "bb-settings-search-status";
        searchStatus.setAttribute("aria-live", "polite");
        resultList = document.createElement("div");
        resultList.className = "bb-settings-search-results";

        searchField.addEventListener("input", () => {
          query = searchField?.value ?? "";
          update();
        });
        searchField.addEventListener("keydown", (event) => {
          if (event.key === "Escape" && searchField?.value) {
            event.preventDefault();
            searchField.value = "";
            query = "";
            update();
          }
        });
        searchContainer.append(searchField, searchStatus, resultList);
        firstRow.parentElement?.insertBefore(searchContainer, firstRow);
      };

      const update = () => {
        if (!isSettingsPage()) {
          clearDecorations();
          searchContainer?.remove();
          searchContainer = null;
          searchField = null;
          searchStatus = null;
          resultList = null;
          return;
        }

        const main = document.querySelector<HTMLElement>("main");
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .filter((link) => isSettingsLink(link) && !main?.contains(link));
        ensureSearchField(links);
        clearDecorations();

        const normalizedQuery = normalize(query.trim());
        if (!normalizedQuery) {
          renderResults([], links);
          setSearchStatus("");
          return;
        }

        for (const link of links) {
          const row = navRow(link) as HTMLElement;
          const matches = normalize(link.textContent ?? "").includes(normalizedQuery);
          const isCurrent = (() => {
            try {
              return new URL(link.href, window.location.href).pathname === window.location.pathname;
            } catch {
              return false;
            }
          })();
          if (!matches && !isCurrent) {
            row.classList.add("bb-settings-search-hidden");
            hiddenRows.add(row);
          } else if (matches) {
            row.classList.add("bb-settings-search-match");
            decoratedRows.add(row);
          }
        }

        const matches = settingsIndex
          .map((entry) => ({ entry, rank: rankEntry(entry, normalizedQuery) }))
          .filter(({ rank }) => rank >= 0)
          .sort((left, right) => left.rank - right.rank || left.entry.title.localeCompare(right.entry.title))
          .map(({ entry }) => entry);
        renderResults(matches, links);
        if (main) highlightCurrentSettings(main, normalizedQuery, links);
        setSearchStatus(`${matches.length} match${matches.length === 1 ? "" : "es"}`);
      };

      const dispose = () => {
        observer.disconnect();
        window.removeEventListener("popstate", update);
        window.removeEventListener("hashchange", update);
        clearDecorations();
        searchContainer?.remove();
      };

      const observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => !searchContainer?.contains(mutation.target))) update();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener("popstate", update);
      window.addEventListener("hashchange", update);
      signal.addEventListener("abort", dispose, { once: true });
      update();
      return dispose;
    },
  });
});
