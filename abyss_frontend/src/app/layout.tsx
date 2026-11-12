import type { Metadata } from "next";
import { cookies } from "next/headers";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";
import { AuthProvider, QueryProvider, ThemeProvider } from "@/providers";
import { Toaster } from "@/components/ui";

// Same typography as Trench, loaded straight from Google Fonts (display=swap)
// rather than next/font/google, whose Turbopack loader can't resolve some of
// Google's dynamic font URLs. Applied via the font-* tokens in globals.css.
//   Inter 400/500/600        -- UI and user messages
//   Source Serif 4 400/600   -- agent responses
//   JetBrains Mono 400/500   -- code
const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2" +
  "?family=Inter:wght@400;500;600" +
  "&family=JetBrains+Mono:wght@400;500" +
  "&family=Source+Serif+4:wght@400;600" +
  "&display=swap";

export const metadata: Metadata = {
  title: {
    default: "Abyss",
    template: "%s | Abyss",
  },
  description: "Intelligence without limits",
  icons: {
    icon: [{ url: "/favicon.ico?v=2", type: "image/png" }],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const isAuthenticated = !!cookieStore.get("a_token")?.value;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={GOOGLE_FONTS_URL} />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <NuqsAdapter>
          <QueryProvider>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
              <AuthProvider initialIsAuthenticated={isAuthenticated}>
                {children}
                <Toaster />
              </AuthProvider>
            </ThemeProvider>
          </QueryProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
