"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "What's missing" },
  { href: "/upload", label: "Upload" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-rule bg-sheet">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 sm:px-6">
        <span className="py-3 font-semibold text-stamp">Tara Mini</span>
        <ul className="flex gap-1">
          {LINKS.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`block border-b-2 px-2 py-3 text-sm focus-visible:outline-2 focus-visible:outline-stamp ${
                    active ? "border-stamp font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink"
                  }`}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
