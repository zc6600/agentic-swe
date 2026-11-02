"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function CopyCodeButtons() {
  const pathname = usePathname();

  useEffect(() => {
    const handleClick = async (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest<HTMLButtonElement>(".copy-button");
      if (!button) return;

      const wrapper = button.parentElement?.tagName === "P" ? button.parentElement : button;
      const code = wrapper?.previousElementSibling?.querySelector("pre code, code");
      if (!code) return;

      try {
        await navigator.clipboard.writeText(code.textContent ?? "");
        const label = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(() => { button.textContent = label; }, 1600);
      } catch {
        button.textContent = "Select and copy the code above";
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [pathname]);

  return null;
}
