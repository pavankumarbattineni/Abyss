import type { Metadata } from "next";
import { ProviderSecretsSettingsPage } from "@/components/pages/settings";

export const metadata: Metadata = {
  title: "Provider Secrets",
};

const Page = () => <ProviderSecretsSettingsPage />;

export default Page;
