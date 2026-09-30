import { definePluginApp } from "@get-bb/plugin-sdk/app";

const storageKey = "bb.sidebar-resize.navigation-ratio.v1";
const handleAttribute = "data-bb-sidebar-resize-handle";
const minimumNavigationHeight = 112;
const minimumThreadListHeight = 180;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const readRatio = () => {
  try {
    const value = Number(localStorage.getItem(storageKey));
    return Number.isFinite(value) && value > 0 ? clamp(value, 0.12, 0.82) : null;
  } catch {
    return null;
  }
};

const writeRatio = (value: number) => {
  try {
    localStorage.setItem(storageKey, String(clamp(value, 0.12, 0.82)));
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
    handle.setAttribute("aria-valuemin", "12");
    handle.setAttribute("aria-valuemax", "82");
    handle.setAttribute("tabindex", "0");
    Object.assign(handle.style, {
      alignItems: "center",
      background: "var(--background)",
      borderBlock: "1px solid var(--border)",
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

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "sidebar-resizer", mount: mountResizer });
});
