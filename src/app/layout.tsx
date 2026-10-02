import type { Metadata } from "next";
import { Fira_Sans } from "next/font/google";
import { db } from "@/lib/db";
import { Nav } from "./_components/Nav";
import "./globals.css";

// Fira Sans: Spiekermann's humanist sans with tabular figures, at home in a German office tool.
const fira = Fira_Sans({
  variable: "--font-fira",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Tara Mini",
  description: "What each client still owes the firm, and by when",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const reviewCount = await db.document.count({ where: { status: "PROPOSED" } });
  return (
    <html lang="en">
      <body className={`${fira.variable} font-sans antialiased`}>
        <Nav reviewCount={reviewCount} />
        {children}
      </body>
    </html>
  );
}
