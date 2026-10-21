import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({ src: "./fonts/inter-latin.woff2", variable: "--font-inter", weight: "100 900", display: "swap" });
const jakarta = localFont({ src: "./fonts/plus-jakarta-sans-latin.woff2", variable: "--font-jakarta", weight: "500 700", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Outreach", template: "%s · Outreach" },
  description: "Instagram outreach that books calls.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${inter.variable} ${jakarta.variable} h-full`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('outreach-appearance');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}})()` }} /></head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
