import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Inter is the closest open-source stand-in for SF Pro. We pair it with the
// native -apple-system stack so macOS / iOS users see real SF.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "LotLens — Queensland Property Due Diligence",
  description:
    "AI-generated due diligence reports for Queensland properties. Plain-English summaries of flood, bushfire, coastal, koala habitat, heritage, easements, mining, and zoning overlays.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Inline no-flash script, applied before paint. DARK is the default —
  // light only when the user explicitly picked it via the toggle.
  const noFlashTheme = `(function(){try{var s=localStorage.getItem('theme');if(s!=='light'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
