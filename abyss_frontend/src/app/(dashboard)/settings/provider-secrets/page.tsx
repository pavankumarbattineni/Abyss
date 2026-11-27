import type { Metadata } from "next";
import { ProviderSecretsSettingsPage } from "@/components/pages/settings";

export const metadata: Metadata = {
  title: "Provider Keys",
};

const Page = () => <ProviderSecretsSettingsPage />;

export default Page;
