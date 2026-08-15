import type { Metadata } from "next";
import { SignupPage } from "@/components/pages/auth";

export const metadata: Metadata = {
  title: "Create account",
};

const Page = () => <SignupPage />;

export default Page;
