"use client";
import { useSyncExternalStore } from "react";
import { Icon } from "./icon";

type Mode = "light" | "dark" | "system";
const event = "outreach-appearance-change";
const subscribe = (notify: () => void) => {
  window.addEventListener(event, notify);
  return () => window.removeEventListener(event, notify);
};
const snapshot = (): Mode => {
  const value = document.documentElement.getAttribute("data-theme");
  return value === "light" || value === "dark" ? value : "system";
};
const serverSnapshot = (): Mode => "system";

export function Appearance() {
  const mode = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  function select(value: Mode) {
    if (value === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", value);
    try { localStorage.setItem("outreach-appearance", value); } catch { /* Appearance still works without storage. */ }
    window.dispatchEvent(new Event(event));
  }
  return <div className="appearance glass" role="group" aria-label="Appearance">
    {(["light", "dark", "system"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} aria-label={`Use ${value} appearance`} title={`${value[0].toUpperCase()}${value.slice(1)} appearance`} onClick={() => select(value)}><Icon name={value === "light" ? "sun" : value === "dark" ? "moon" : "system"} size={17} /></button>)}
  </div>;
}
