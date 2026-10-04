"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BRAND } from "./brand";

const LINKS = [
  { href: "/", label: "What's missing" },
  { href: "/upload", label: "Upload" },
  { href: "/review", label: "Review" },
  { href: "/accuracy", label: "Accuracy" },
];

/** The firm's logo, or a same-sized placeholder until the file is added (see brand.ts). */
function BrandLogo() {
  const { logoSrc, logoWidth, logoHeight, firmName } = BRAND;
  if (logoSrc) {
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset; SVG needs no optimisation
    return <img src={logoSrc} alt={`${firmName} logo`} width={logoWidth} height={logoHeight} className="block" />;
  }
  return (
    <span
      role="img"
      aria-label={`${firmName} logo placeholder`}
      style={{ width: logoWidth, height: logoHeight }}
      className="flex items-center justify-center rounded-brand border border-dashed border-ink-muted text-xs font-medium tracking-wide text-ink-muted"
    >
      Logo
    </span>
  );
}

export function Nav({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();
  return (
    <nav className="border-b border-rule bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3" aria-label={`${BRAND.productName} home`}>
          <BrandLogo />
          <span className="border-l border-rule pl-3 text-sm font-semibold text-brand">{BRAND.productName}</span>
        </Link>
        <ul className="flex flex-wrap gap-1">
          {LINKS.map(({ href, label }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center border-b-2 px-2 py-2 text-[0.95rem] transition-colors ${
                    active ? "border-brand font-medium text-brand" : "border-transparent text-ink-muted hover:text-ink"
                  }`}
                >
                  {label}
                  {href === "/review" && reviewCount > 0 && (
                    <span className="ml-1.5 rounded-brand bg-brand px-1.5 py-0.5 text-xs font-semibold text-lime">
                      {reviewCount}
                      <span className="sr-only"> waiting</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
