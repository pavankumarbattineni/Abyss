import type { Metadata } from "next";
import { Suspense } from "react";

import { TracingPage } from "@/components/pages/tracing";

export const metadata: Metadata = {
  title: "Tracing",
};

// Suspense: the page reads its filters from the URL (nuqs).
const Page = () => (
  <Suspense>
    <TracingPage />
  </Suspense>
);

export default Page;
