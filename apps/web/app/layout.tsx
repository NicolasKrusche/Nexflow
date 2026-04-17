import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nexflow — Visual AI Automation",
  description:
    "Describe what you want to automate. Nexflow designs the agent graph, you tune it visually — then it runs itself.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} dark`}>
      <head>
        {/* Anti-flash: apply persisted theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('nexflow-theme');var themes=['dark','midnight-blue','graphite','emerald-terminal','rose-gold','cyberpunk-neon','light','liquid-glass'];if(t&&themes.includes(t)){var el=document.documentElement;el.className=el.className.replace(/\b(dark|midnight-blue|graphite|emerald-terminal|rose-gold|cyberpunk-neon|light|liquid-glass)\b/g,'').trim()+' '+t;}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
