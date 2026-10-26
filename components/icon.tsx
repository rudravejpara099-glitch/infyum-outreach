import type { CSSProperties } from "react";

const paths = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  campaign: "m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3",
  pipeline: "M5 20V12 M12 20V4 M19 20V8 M3 20h18",
  approval: "m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Zm-4 9 3 3 5-6",
  inbox: "M4 4h16v12H4z M4 12h5l2 3h2l2-3h5 M8 20h8",
  accounts: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  activity: "M2 12h5l3-8 4 16 3-8h5",
  billing: "M3 5h18v14H3z M3 10h18 M7 15h3",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5",
  moon: "M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z",
  system: "M3 4h18v13H3z M8 21h8 M12 17v4",
  chevron: "m9 5 7 7-7 7",
  arrow: "M4 12h16 m-6-6 6 6-6 6",
  back: "M20 12H4 m6-6-6 6 6 6",
  pause: "M8 5v14 M16 5v14",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l4 2",
  check: "m5 12 4 4L19 6",
  plus: "M12 5v14 M5 12h14",
  logout: "M9 3H4v18h5 M10 12h11 m-5-5 5 5-5 5",
  menu: "M4 6h16 M4 12h16 M4 18h16",
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
