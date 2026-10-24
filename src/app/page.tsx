import type { Metadata } from "next";
import localFont from "next/font/local";

import { OpenHiggsfieldApp } from "@/openhiggsfield/openhiggsfield-app";

import "@/openhiggsfield/openhiggsfield.css";

/* Self-hosted so the studio never depends on a network font request: this
   repository has to build and run offline (and inside sandboxes that cannot
   reach fonts.googleapis.com). The file is Inter's variable latin subset,
   shipped by @fontsource-variable/inter. */
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--font-ohf-inter",
  display: "swap",
  weight: "100 900",
});

/* Title, description and the Open Graph block all come from the root, which
   already describes this surface. Only the canonical link is route-specific. */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function OpenHiggsfieldPage() {
  return <OpenHiggsfieldApp fontClassName={inter.variable} />;
}
