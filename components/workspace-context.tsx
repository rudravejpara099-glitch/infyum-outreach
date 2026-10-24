"use client";
import { createContext, useContext, type ReactNode } from "react";

const WorkspaceContext = createContext("");
export function WorkspaceProvider({ id, children }: { id: string; children: ReactNode }) {
  return <WorkspaceContext.Provider value={id}>{children}</WorkspaceContext.Provider>;
}
export function WorkspaceField() {
  return <input type="hidden" name="__workspace" value={useContext(WorkspaceContext)} />;
}
