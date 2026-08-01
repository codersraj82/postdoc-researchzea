import "./globals.css";

const siteUrl = "https://postdoc.researchzeal.com";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Postdoc ResearchZeal | Find Postdoc Positions Worldwide",
    template: "%s | Postdoc ResearchZeal",
  },
  description:
    "Search recent Postdoc positions worldwide by research area, country, language, and deadline. Browse and apply without creating an account.",
  keywords: [
    "postdoc positions",
    "postdoctoral jobs",
    "research opportunities",
    "academic jobs",
    "Postdoc ResearchZeal",
    "international postdoc",
  ],
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Postdoc ResearchZeal",
    title: "Postdoc ResearchZeal | Find Postdoc Positions Worldwide",
    description:
      "Search demonstration Postdoc listings by research area, country, language, and deadline—without creating an account.",
  },
  twitter: {
    card: "summary",
    title: "Postdoc ResearchZeal | Find Postdoc Positions Worldwide",
    description:
      "Browse demonstration Postdoc listings worldwide with no signup required.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07111f",
  colorScheme: "dark",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="scroll-smooth">
      <body>{children}</body>
    </html>
  );
}
