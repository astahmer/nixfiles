import { useLayoutEffect, useRef, useState } from "react";
import "./app.css";
import {
  definePluginApp,
  experimental_SidebarNavigationIcon,
  experimental_useSidebarNavigation,
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
  const navigationRef = useRef<HTMLElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;

    const observer = new ResizeObserver(([entry]) => {
      setIsCollapsed(entry.contentRect.height <= compactNavigationThreshold);
    });
    observer.observe(navigation);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      ref={navigationRef}
      aria-label="Sidebar destinations"
      data-sidebar-navigation-collapsed={isCollapsed}
      style={{
        alignItems: isCollapsed ? "center" : "stretch",
        display: "flex",
        flexDirection: isCollapsed ? "row" : "column",
        gap: 4,
        height: "100%",
        minHeight: 0,
        overflowX: isCollapsed ? "auto" : "hidden",
        overflowY: isCollapsed ? "hidden" : "auto",
        padding: isCollapsed ? "0 8px" : "4px 8px",
        width: "100%",
      }}
    >
      {items.filter((item) => item.isVisible).map((item) => (
        <button
          key={item.id}
          className="sidebar-resize-navigation-item"
          type="button"
          title={item.label}
          aria-label={item.label}
          aria-current={activeItemId === item.id ? "page" : undefined}
          aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
          data-active={activeItemId === item.id}
          disabled={item.isDisabled}
          onClick={(event) => actions.activate(item.id, { openInSplit: event.metaKey || event.ctrlKey })}
          style={{
            alignItems: "center",
            border: 0,
            borderRadius: 8,
            cursor: item.isDisabled ? "default" : "pointer",
            display: "flex",
            flex: "0 0 32px",
            fontSize: 14,
            gap: 8,
            justifyContent: isCollapsed ? "center" : "flex-start",
            lineHeight: "20px",
            minWidth: 0,
            opacity: item.isDisabled ? 0.5 : 1,
            padding: isCollapsed ? 0 : "0 8px",
            textAlign: "left",
            whiteSpace: "nowrap",
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
            background: "transparent",
            border: 0,
            cursor: "pointer",
            flex: "0 0 32px",
            fontSize: 13,
            textAlign: "left",
          }}
        >
          Customize sidebar
        </button>
      )}
    </nav>
  );
};

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "compact-navigation",
    title: "Compact sidebar navigation",
    description: "Use a horizontal icon row when the navigation pane is collapsed.",
    component: SidebarNavigation,
  });
  app.contentScripts.register({ id: "sidebar-resizer", mount: mountResizer });
});
