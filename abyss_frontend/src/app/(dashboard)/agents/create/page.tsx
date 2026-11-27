import type { Metadata } from "next";
import { AgentCreatePage } from "@/components/pages/agent-create";

export const metadata: Metadata = {
  title: "Agent Studio",
};

const Page = () => <AgentCreatePage />;

export default Page;
