import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useLanguage } from "@/lib/i18n/language";

export type ActionResult = {
  tone: "pending" | "success" | "warning" | "error";
  message: string;
};

const appearances = {
  pending: { icon: LoaderCircle, color: "border-blue-300 bg-blue-50 text-blue-950" },
  success: { icon: CheckCircle2, color: "border-emerald-400 bg-emerald-50 text-emerald-950" },
  warning: { icon: AlertCircle, color: "border-amber-400 bg-amber-50 text-amber-950" },
  error: { icon: AlertCircle, color: "border-red-400 bg-red-50 text-red-950" },
};

export default function ActionFeedback({ result }: { result: ActionResult | null }) {
  const { t } = useLanguage();
  const appearance = result ? appearances[result.tone] : null;
  const Icon = appearance?.icon;

  return (
    <div
      role={result?.tone === "error" ? "alert" : "status"}
      aria-atomic="true"
      className={appearance ? `flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold ${appearance.color}` : "sr-only"}
    >
      {Icon && <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />}
      {result && t(result.message)}
    </div>
  );
}
