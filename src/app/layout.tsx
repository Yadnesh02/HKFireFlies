import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FireFlies → Email",
  description: "Generate professional emails from meeting transcripts",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
