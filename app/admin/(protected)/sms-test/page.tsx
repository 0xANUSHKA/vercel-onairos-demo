import type { Metadata } from "next";
import SmsTestForm from "@/components/admin/sms/SmsTestForm";

export const metadata: Metadata = {
  title: "SMS Test | inyoAdmin",
  description: "Send a Telnyx test SMS from admin",
};

export default function AdminSmsTestPage() {
  return <SmsTestForm />;
}
