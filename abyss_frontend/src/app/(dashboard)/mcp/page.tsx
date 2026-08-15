import type { Metadata } from "next";
import { McpPage } from "@/components/pages/mcp";

export const metadata: Metadata = {
  title: "MCP Servers",
};

const Page = () => <McpPage />;

export default Page;
