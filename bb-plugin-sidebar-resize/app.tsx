import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import "./app.css";
import {
  definePluginApp,
  experimental_SidebarNavigationIcon,
  experimental_useSidebarNavigation,
  useSettings,
} from "@get-bb/plugin-sdk/app";

const storageKey = "bb.sidebar-resize.navigation-ratio.v1";
const handleAttribute = "data-bb-sidebar-resize-handle";
const minimumNavigationHeight = 48;
const minimumThreadListHeight = 180;
const compactNavigationThreshold = 76;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const readRatio = () => {
  try {
    const value = Number(localStorage.getItem(storageKey));
    return Number.isFinite(value) && value > 0 ? clamp(value, 0.04, 0.82) : null;
  } catch {
    return null;
  }
};

const writeRatio = (value: number) => {
  try {
    localStorage.setItem(storageKey, String(clamp(value, 0.04, 0.82)));
  } catch {
    // Resizing still works for this session when storage is unavailable.
  }
};

const clearRatio = () => {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Resetting the visible size still works when storage is unavailable.
  }
};

const mountResizer = () => {
  let attachedNavigation: HTMLElement | null = null;
  let attachedHandle: HTMLDivElement | null = null;
  let originalStyles: { flex: string; height: string; minHeight: string; overflowY: string } | null = null;
  let originalUserSelect = "";

  const detach = () => {
    attachedHandle?.remove();
    if (attachedNavigation && originalStyles) {
      attachedNavigation.style.flex = originalStyles.flex;
      attachedNavigation.style.height = originalStyles.height;
      attachedNavigation.style.minHeight = originalStyles.minHeight;
      attachedNavigation.style.overflowY = originalStyles.overflowY;
    }
    document.body.style.userSelect = originalUserSelect;
    attachedNavigation = null;
    attachedHandle = null;
    originalStyles = null;
  };

  const attach = () => {
    const navigation = document.querySelector<HTMLElement>('[aria-label="Sidebar navigation"]');
    if (!navigation || navigation === attachedNavigation || navigation.closest("[hidden]")) return;

    detach();
    const parent = navigation.parentElement;
    if (!parent) return;

    attachedNavigation = navigation;
    originalStyles = {
      flex: navigation.style.flex,
      height: navigation.style.height,
      minHeight: navigation.style.minHeight,
      overflowY: navigation.style.overflowY,
    };
    originalUserSelect = document.body.style.userSelect;

    const handle = document.createElement("div");
    handle.setAttribute(handleAttribute, "");
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", "Resize sidebar navigation and project list");
    handle.setAttribute("aria-orientation", "horizontal");
    handle.setAttribute("aria-valuemin", "4");
    handle.setAttribute("aria-valuemax", "82");
    handle.setAttribute("tabindex", "0");
    Object.assign(handle.style, {
      alignItems: "center",
      background: "var(--border-seam)",
      cursor: "row-resize",
      display: "flex",
      flex: "0 0 8px",
      justifyContent: "center",
      minHeight: "8px",
      outline: "none",
      position: "relative",
      touchAction: "none",
      zIndex: "1",
    });

    const grip = document.createElement("span");
    Object.assign(grip.style, {
      background: "var(--muted-foreground)",
      borderRadius: "999px",
      height: "2px",
      pointerEvents: "none",
      width: "28px",
    });
    handle.append(grip);
    navigation.after(handle);
    attachedHandle = handle;

    const applyHeight = (height: number) => {
      const availableHeight = parent.clientHeight;
      if (availableHeight === 0) return;
      const maximum = Math.max(
        minimumNavigationHeight,
        availableHeight - minimumThreadListHeight - handle.offsetHeight,
      );
      const boundedHeight = clamp(height, minimumNavigationHeight, maximum);
      navigation.style.flex = `0 0 ${boundedHeight}px`;
      navigation.style.height = `${boundedHeight}px`;
      navigation.style.minHeight = `${minimumNavigationHeight}px`;
      navigation.style.overflowY = "auto";
      handle.setAttribute("aria-valuenow", String(Math.round((boundedHeight / availableHeight) * 100)));
    };

    const currentHeight = navigation.getBoundingClientRect().height;
    const ratio = readRatio();
    if (ratio !== null) applyHeight(parent.clientHeight * ratio);
    else applyHeight(Math.min(navigation.scrollHeight, parent.clientHeight - minimumThreadListHeight));

    let startY: number | null = null;
    let startHeight = currentHeight;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      startY = event.clientY;
      startHeight = navigation.getBoundingClientRect().height;
      handle.setPointerCapture(event.pointerId);
      document.body.style.userSelect = "none";
    });
    handle.addEventListener("pointermove", (event) => {
      if (startY === null) return;
      applyHeight(startHeight + event.clientY - startY);
    });
    const finishResize = () => {
      if (startY === null) return;
      startY = null;
      document.body.style.userSelect = originalUserSelect;
      const availableHeight = parent.clientHeight;
      if (availableHeight > 0) writeRatio(navigation.getBoundingClientRect().height / availableHeight);
    };
    handle.addEventListener("pointerup", finishResize);
    handle.addEventListener("pointercancel", finishResize);
    handle.addEventListener("keydown", (event) => {
      const increment = event.shiftKey ? 64 : 24;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? -1 : 1;
        applyHeight(navigation.getBoundingClientRect().height + direction * increment);
        const availableHeight = parent.clientHeight;
        if (availableHeight > 0) writeRatio(navigation.getBoundingClientRect().height / availableHeight);
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        applyHeight(event.key === "Home" ? minimumNavigationHeight : parent.clientHeight - minimumThreadListHeight);
        const availableHeight = parent.clientHeight;
        if (availableHeight > 0) writeRatio(navigation.getBoundingClientRect().height / availableHeight);
      }
    });
    handle.addEventListener("dblclick", () => {
      clearRatio();
      detach();
      attach();
    });

  };

  const observer = new MutationObserver(attach);
  observer.observe(document.body, { childList: true, subtree: true });
  attach();

  return () => {
    observer.disconnect();
    detach();
  };
};

const SidebarNavigationIcon = experimental_SidebarNavigationIcon;

const SidebarNavigation = () => {
  const { items, activeItemId, actions } = experimental_useSidebarNavigation();
  const { values } = useSettings();
  const navigationRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipTimer = useRef<number | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [navigationWidth, setNavigationWidth] = useState(0);
  const [tooltip, setTooltip] = useState<{ label: string; left: number; bottom: number } | null>(null);
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const [menuSearch, setMenuSearch] = useState("");
  const density = values?.density === "Comfortable" ? "comfortable" : "compact";
  const rowHeight = density === "compact" ? 30 : 34;
  const overflowMode = values?.overflow === "Scroll" || values?.overflow === "Overflow menu"
    ? values.overflow
    : "Scroll + menu";
  const visibleItems = items.filter((item) => item.isVisible);
  const collapsedButtonSize = 34;
  const collapsedGap = 4;
  const slots = Math.max(0, Math.floor((navigationWidth - collapsedButtonSize) / (collapsedButtonSize + collapsedGap)));
  const visibleCollapsedItems = overflowMode === "Overflow menu"
    ? visibleItems.slice(0, slots)
    : visibleItems;
  const menuItems = overflowMode === "Overflow menu"
    ? visibleItems.slice(visibleCollapsedItems.length)
    : visibleItems;
  const normalizedQuery = menuSearch.trim().toLocaleLowerCase();
  const filteredMenuItems = normalizedQuery
    ? menuItems.filter((item) => item.label.toLocaleLowerCase().includes(normalizedQuery))
    : menuItems;

  const clearTooltip = () => {
    if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current);
    tooltipTimer.current = null;
    setTooltip(null);
  };

  const showTooltip = (label: string, button: HTMLButtonElement, delayed: boolean) => {
    if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current);
    const bounds = button.getBoundingClientRect();
    const nextTooltip = {
      label,
      left: bounds.left + bounds.width / 2,
      bottom: window.innerHeight - bounds.top + 6,
    };
    if (delayed) {
      tooltipTimer.current = window.setTimeout(() => setTooltip(nextTooltip), 350);
      return;
    }
    setTooltip(nextTooltip);
  };

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;

    const observer = new ResizeObserver(([entry]) => {
      setIsCollapsed(entry.contentRect.height <= compactNavigationThreshold);
      setNavigationWidth(entry.contentRect.width);
    });
    observer.observe(navigation);
    return () => {
      observer.disconnect();
      if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current);
    };
  }, []);

  useLayoutEffect(() => {
    const tooltipElement = tooltipRef.current;
    if (!tooltip || !tooltipElement) return;
    const tooltipWidth = tooltipElement.getBoundingClientRect().width;
    const halfWidth = tooltipWidth / 2;
    const left = clamp(tooltip.left, halfWidth + 8, window.innerWidth - halfWidth - 8);
    if (left !== tooltip.left) setTooltip((current) => current ? { ...current, left } : null);
  }, [tooltip?.label]);

  useLayoutEffect(() => {
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuButtonRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setMenu(null);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const searchInput = searchInputRef.current;
      if (searchInput && document.activeElement === searchInput && searchInput.value) {
        event.preventDefault();
        setMenuSearch("");
        return;
      }
      setMenu(null);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, []);

  useLayoutEffect(() => {
    if (!menu) return;
    searchInputRef.current?.focus();
  }, [Boolean(menu)]);

  const openMenu = () => {
    const button = menuButtonRef.current;
    if (!button) return;
    setMenuSearch("");
    const bounds = button.getBoundingClientRect();
    const menuHeight = Math.min(360, (menuItems.length + 2) * rowHeight + 32);
    const opensAbove = window.innerHeight - bounds.bottom < menuHeight && bounds.top > menuHeight;
    setMenu({
      left: clamp(bounds.left, 8, Math.max(8, window.innerWidth - 280)),
      top: opensAbove
        ? Math.max(8, bounds.top - menuHeight - 6)
        : Math.min(bounds.bottom + 6, Math.max(8, window.innerHeight - menuHeight - 8)),
    });
  };

  const activate = (itemId: string, event: MouseEvent<HTMLButtonElement>) => {
    actions.activate(itemId, { openInSplit: event.metaKey || event.ctrlKey });
    setMenu(null);
    setMenuSearch("");
  };

  const menuButton = isCollapsed && overflowMode !== "Scroll";

  return (
    <>
      <nav
        ref={navigationRef}
        aria-label="Sidebar destinations"
        data-sidebar-navigation-collapsed={isCollapsed}
        style={{
          alignItems: "stretch",
          display: "flex",
          flexDirection: isCollapsed ? "row" : "column",
          gap: isCollapsed ? 4 : density === "compact" ? 2 : 4,
          height: "100%",
          minHeight: 0,
          overflow: "hidden",
          overflowY: isCollapsed ? "hidden" : "auto",
          padding: isCollapsed ? "0 8px" : density === "compact" ? "2px 8px" : "4px 8px",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: isCollapsed ? "center" : "stretch",
            display: "flex",
            flex: "1 1 auto",
            flexDirection: isCollapsed ? "row" : "column",
            gap: isCollapsed ? collapsedGap : density === "compact" ? 2 : 4,
            height: "100%",
            minHeight: 0,
            minWidth: 0,
            overflowX: isCollapsed && overflowMode !== "Overflow menu" ? "auto" : "hidden",
            overflowY: isCollapsed ? "hidden" : "auto",
            scrollbarWidth: "none",
          }}
        >
          {visibleCollapsedItems.map((item) => (
          <button
            key={item.id}
            className="sidebar-resize-navigation-item"
            type="button"
            title={isCollapsed ? undefined : item.label}
            aria-label={item.label}
            aria-describedby={tooltip?.label === item.label ? "sidebar-resize-tooltip" : undefined}
            aria-current={activeItemId === item.id ? "page" : undefined}
            aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
            data-active={activeItemId === item.id}
            disabled={item.isDisabled}
            onClick={(event) => activate(item.id, event)}
            onPointerEnter={(event) => {
              if (isCollapsed) showTooltip(item.label, event.currentTarget, true);
            }}
            onPointerLeave={clearTooltip}
            onFocus={(event) => {
              if (isCollapsed) showTooltip(item.label, event.currentTarget, false);
            }}
            onBlur={clearTooltip}
            style={{
              alignItems: "center",
              border: 0,
              borderRadius: 6,
              cursor: item.isDisabled ? "default" : "pointer",
              display: "flex",
              flex: isCollapsed ? `0 0 ${collapsedButtonSize}px` : `0 0 ${rowHeight}px`,
              fontSize: density === "compact" ? 13 : 14,
              gap: density === "compact" ? 6 : 8,
              height: isCollapsed ? collapsedButtonSize : rowHeight,
              justifyContent: isCollapsed ? "center" : "flex-start",
              lineHeight: "20px",
              minWidth: 0,
              opacity: item.isDisabled ? 0.5 : 1,
              padding: isCollapsed ? 0 : density === "compact" ? "0 6px" : "0 8px",
              textAlign: "left",
              whiteSpace: "nowrap",
              width: isCollapsed ? collapsedButtonSize : "100%",
            }}
          >
            <SidebarNavigationIcon icon={item.icon} className="sidebar-resize-navigation-icon" />
            {!isCollapsed && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>}
            {!isCollapsed && item.experimental_Accessory && <item.experimental_Accessory />}
          </button>
          ))}
          {!isCollapsed && (
            <button
              type="button"
              className="sidebar-resize-navigation-customize"
              onClick={actions.openCustomize}
              style={{
                alignItems: "center",
                border: 0,
                cursor: "pointer",
                display: "flex",
                flex: `0 0 ${rowHeight}px`,
                fontSize: 12,
                gap: density === "compact" ? 6 : 8,
                height: rowHeight,
                padding: density === "compact" ? "0 6px" : "0 8px",
                textAlign: "left",
              }}
            >
              <NavigationGlyph kind="customize" />
              Customize sidebar
            </button>
          )}
        </div>
        {menuButton && (
          <button
            ref={menuButtonRef}
            type="button"
            className="sidebar-resize-navigation-item sidebar-resize-navigation-overflow"
            aria-label="More sidebar destinations"
            aria-haspopup="menu"
            aria-controls="sidebar-resize-overflow-menu"
            aria-expanded={Boolean(menu)}
            title="More sidebar destinations"
            onClick={() => menu ? setMenu(null) : openMenu()}
            style={{
              alignItems: "center",
              border: 0,
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignSelf: "center",
              flex: `0 0 ${collapsedButtonSize}px`,
              height: collapsedButtonSize,
              justifyContent: "center",
              padding: 0,
              width: collapsedButtonSize,
            }}
          >
            <NavigationGlyph kind="more" />
          </button>
        )}
      </nav>
      {menu && createPortal(
        <div
          ref={menuRef}
          id="sidebar-resize-overflow-menu"
          role="dialog"
          aria-label="Sidebar destinations"
          onKeyDown={(event) => {
            const menuButtons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-overflow-item]:not(:disabled)") ?? []);
            const focusedIndex = menuButtons.findIndex((menuItem) => menuItem === document.activeElement);
            const isSearchFocused = searchInputRef.current === document.activeElement;
            const nextIndex = isSearchFocused
              ? event.key === "ArrowDown"
                ? 0
                : event.key === "ArrowUp"
                  ? menuButtons.length - 1
                  : -1
              : event.key === "ArrowDown"
                ? (focusedIndex + 1) % menuButtons.length
                : event.key === "ArrowUp"
                  ? (focusedIndex - 1 + menuButtons.length) % menuButtons.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? menuButtons.length - 1
                      : -1;
            if (nextIndex < 0 || menuButtons.length === 0) return;
            event.preventDefault();
            menuButtons[nextIndex]?.focus();
          }}
          style={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgb(0 0 0 / 20%)",
            color: "var(--popover-foreground)",
            fontSize: density === "compact" ? 13 : 14,
            fontWeight: 400,
            left: menu.left,
            lineHeight: "18px",
            maxHeight: "min(360px, calc(100vh - 16px))",
            maxWidth: "calc(100vw - 16px)",
            minWidth: "min(220px, calc(100vw - 16px))",
            overflowY: "auto",
            padding: 4,
            position: "fixed",
            top: menu.top,
            zIndex: 10001,
          }}
        >
          <input
            ref={searchInputRef}
            className="sidebar-resize-navigation-search"
            type="search"
            autoFocus
            aria-label="Filter sidebar destinations"
            placeholder="Filter destinations…"
            value={menuSearch}
            onChange={(event) => setMenuSearch(event.currentTarget.value)}
            style={{
              borderRadius: 5,
              boxSizing: "border-box",
              color: "inherit",
              font: "inherit",
              height: rowHeight,
              marginBottom: 4,
              padding: "0 8px",
              width: "100%",
            }}
          />
          {filteredMenuItems.map((item) => (
            <button
              key={item.id}
              type="button"
              data-overflow-item
              className="sidebar-resize-navigation-menu-item"
              aria-current={activeItemId === item.id ? "page" : undefined}
              disabled={item.isDisabled}
              onClick={(event) => activate(item.id, event)}
              style={{
                alignItems: "center",
                border: 0,
                borderRadius: 5,
                color: "inherit",
                cursor: item.isDisabled ? "default" : "pointer",
                display: "flex",
                font: "inherit",
                gap: 10,
                height: rowHeight,
                opacity: item.isDisabled ? 0.5 : 1,
                padding: "0 8px",
                textAlign: "left",
                width: "100%",
              }}
            >
              <SidebarNavigationIcon icon={item.icon} className="sidebar-resize-navigation-icon" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
            </button>
          ))}
          {filteredMenuItems.length === 0 && (
            <div role="status" style={{ color: "var(--muted-foreground)", padding: "8px" }}>
              No matching destinations
            </div>
          )}
          <div aria-hidden="true" style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
          <button
            type="button"
            data-overflow-item
            className="sidebar-resize-navigation-menu-item"
            onClick={() => {
              setMenu(null);
              actions.openCustomize();
            }}
            style={{
              alignItems: "center",
              border: 0,
              borderRadius: 5,
              color: "inherit",
              cursor: "pointer",
              display: "flex",
              font: "inherit",
              gap: 10,
              height: rowHeight,
              padding: "0 8px",
              textAlign: "left",
              width: "100%",
            }}
          >
            <NavigationGlyph kind="customize" />
            Customize sidebar
          </button>
        </div>,
        document.body,
      )}
      {tooltip && createPortal(
        <div
          ref={tooltipRef}
          id="sidebar-resize-tooltip"
          role="tooltip"
          style={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            bottom: tooltip.bottom,
            boxShadow: "0 4px 12px rgb(0 0 0 / 18%)",
            color: "var(--popover-foreground)",
            fontSize: 12,
            left: tooltip.left,
            lineHeight: "16px",
            padding: "4px 8px",
            pointerEvents: "none",
            position: "fixed",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            zIndex: 10000,
          }}
        >
          {tooltip.label}
        </div>,
        document.body,
      )}
    </>
  );
};

const NavigationGlyph = ({ kind }: { kind: "more" | "customize" }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" style={{ flex: "0 0 16px", height: 16, width: 16 }}>
    {kind === "more" ? (
      <>
        <circle cx="12" cy="5" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="19" r="1" fill="currentColor" />
      </>
    ) : (
      <>
        <line x1="4" y1="7" x2="7" y2="7" />
        <line x1="11" y1="7" x2="20" y2="7" />
        <line x1="4" y1="17" x2="13" y2="17" />
        <line x1="17" y1="17" x2="20" y2="17" />
        <circle cx="9" cy="7" r="2" />
        <circle cx="15" cy="17" r="2" />
      </>
    )}
  </svg>
);

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "compact-navigation",
    title: "Compact sidebar navigation",
    description: "Use a horizontal icon row when the navigation pane is collapsed.",
    component: SidebarNavigation,
  });
  app.contentScripts.register({ id: "sidebar-resizer", mount: mountResizer });
});
