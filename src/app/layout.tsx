import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import { db } from "@/lib/db";
import { BRAND } from "./_components/brand";
import { Nav } from "./_components/Nav";
import "./globals.css";

// Public Sans: TARA's corporate typeface (headings, body and buttons on taratax.ai).
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "600", "700"],
});

// The nav shows a live review count, so nothing is prerendered at build time
// (the build must not need a running database).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${BRAND.productName} | ${BRAND.firmName}`,
  description: "What each client still owes the firm, and by when",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const reviewCount = await db.document.count({ where: { status: "PROPOSED" } });
  return (
    <html lang="en">
      <body className={`${publicSans.variable} font-sans text-ink antialiased`}>
        <Nav reviewCount={reviewCount} />
        {children}
      </body>
    </html>
  );
}
