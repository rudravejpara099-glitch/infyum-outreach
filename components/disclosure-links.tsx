"use client";
import { useEffect } from "react";

/** Native details remain usable without JS; in-page links also open their destination. */
export function DisclosureLinks() {
  useEffect(() => {
    function open(hash: string) {
      const target = document.getElementById(hash.slice(1));
      if (target instanceof HTMLDetailsElement && target.classList.contains("disclosure")) target.open = true;
    }
    const onHash = () => open(window.location.hash);
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href^="#"]');
      if (link) open(link.hash);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    document.addEventListener("click", onClick);
    return () => { window.removeEventListener("hashchange", onHash); document.removeEventListener("click", onClick); };
  }, []);
  return null;
}
