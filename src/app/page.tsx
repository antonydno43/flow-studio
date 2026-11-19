"use client";

import dynamic from "next/dynamic";

/**
 * Flow Studio - single-page application.
 * All views render client-side inside this route; APIs are served from /api/*.
 */
const FlowStudioApp = dynamic(
  () => import("@/components/flow-studio/app").then((m) => m.default),
  { ssr: false, loading: () => <div className="min-h-screen bg-background" /> }
);

export default function Page() {
  return <FlowStudioApp />;
}
