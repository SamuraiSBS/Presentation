"use client";

import { RouteErrorState } from "@/components/route-error-state";

export default function ExportError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteErrorState error={error} retry={retry} scope="export" />;
}
