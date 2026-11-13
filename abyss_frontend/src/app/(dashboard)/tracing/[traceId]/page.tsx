import type { Metadata } from "next";

import { TraceDetailPage } from "@/components/pages/trace-detail";

export const metadata: Metadata = {
  title: "Trace",
};

const Page = async ({ params }: { params: Promise<{ traceId: string }> }) => {
  const { traceId } = await params;
  return <TraceDetailPage traceId={traceId} />;
};

export default Page;
