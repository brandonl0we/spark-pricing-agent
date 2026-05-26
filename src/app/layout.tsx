import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Pricing Agent",
  description: "Sales pricing guidance for discount approval."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
