import "./globals.css";
import React, { ReactNode } from "react";
import { ApolloWrapper } from "@/components/providers/ApolloWrapper";

export const metadata = {
  title: "CrowdChat - AI Fake Stream Chat Portal",
  description: "Simulated stream audience responding to voice in real-time",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#030712] text-slate-100 antialiased selection:bg-cyan-500 selection:text-black">
        <ApolloWrapper>{children}</ApolloWrapper>
      </body>
    </html>
  );
}
