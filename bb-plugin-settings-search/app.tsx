import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./settings-search.css";

const settingsRoute = /^\/settings(?:\/|$)/;
const settingControls = "input, select, textarea, [role='switch'], [role='combobox']";

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

const settingRow = (control: Element, main: HTMLElement) => {
  let candidate = control.parentElement;

  while (candidate && candidate !== main) {
    const controls = candidate.querySelectorAll(settingControls);
    const text = candidate.textContent?.trim() ?? "";

    if (controls.length === 1 && text.length > 2 && text.length < 500) {
      return candidate;
    }

    candidate = candidate.parentElement;
  }

  return null;
};

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "settings-search",
    mount: ({ signal }) => {
      let query = "";
      let searchField: HTMLInputElement | null = null;
      let searchStatus: HTMLSpanElement | null = null;
      let searchContainer: HTMLDivElement | null = null;
      const hiddenRows = new Set<HTMLElement>();
      const highlightedRows = new Set<HTMLElement>();

      const setSearchStatus = (value: string) => {
        if (searchStatus && searchStatus.textContent !== value) {
          searchStatus.textContent = value;
        }
      };

      const clearDecorations = () => {
        for (const row of hiddenRows) row.classList.remove("bb-settings-search-hidden");
        for (const row of highlightedRows) row.classList.remove("bb-settings-search-match");
        hiddenRows.clear();
        highlightedRows.clear();
      };

      const ensureSearchField = (links: HTMLAnchorElement[]) => {
        if (links.length === 0) {
          searchContainer?.remove();
          searchContainer = null;
          searchField = null;
          searchStatus = null;
          return;
        }

        const firstRow = navRow(links[0]!);
        if (searchContainer?.isConnected && searchContainer.parentElement === firstRow.parentElement) {
          return;
        }

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

        searchContainer.append(searchField, searchStatus);
        firstRow.parentElement?.insertBefore(searchContainer, firstRow);
      };

      const update = () => {
        if (!isSettingsPage()) {
          clearDecorations();
          searchContainer?.remove();
          searchContainer = null;
          searchField = null;
          searchStatus = null;
          return;
        }

        const main = document.querySelector<HTMLElement>("main");
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .filter((link) => isSettingsLink(link) && !main?.contains(link));
        ensureSearchField(links);
        clearDecorations();

        const normalizedQuery = normalize(query.trim());
        if (!normalizedQuery) {
          setSearchStatus("");
          return;
        }

        let matchCount = 0;
        for (const link of links) {
          const row = navRow(link) as HTMLElement;
          const matches = normalize(link.textContent ?? "").includes(normalizedQuery);
          const isCurrent = new URL(link.href, window.location.href).pathname === window.location.pathname;

          if (!matches && !isCurrent) {
            row.classList.add("bb-settings-search-hidden");
            hiddenRows.add(row);
          } else if (matches) {
            row.classList.add("bb-settings-search-match");
            highlightedRows.add(row);
            matchCount += 1;
          }
        }

        if (main) {
          const rows = new Set<HTMLElement>();
          for (const control of Array.from(main.querySelectorAll(settingControls))) {
            const row = settingRow(control, main);
            if (!row || rows.has(row)) continue;
            rows.add(row);

            if (normalize(row.textContent ?? "").includes(normalizedQuery)) {
              row.classList.add("bb-settings-search-match");
              highlightedRows.add(row);
              matchCount += 1;
            }
          }
        }

        setSearchStatus(`${matchCount} match${matchCount === 1 ? "" : "es"}`);
      };

      const dispose = () => {
        observer.disconnect();
        window.removeEventListener("popstate", update);
        window.removeEventListener("hashchange", update);
        clearDecorations();
        searchContainer?.remove();
      };

      const observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => !searchContainer?.contains(mutation.target))) {
          update();
        }
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
