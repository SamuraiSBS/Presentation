export function isStaleExport(
  item: { status: string; presentationRevision?: number } | undefined,
  presentationRevision: number | undefined,
) {
  return Boolean(
    item?.status === "ready" &&
    typeof item.presentationRevision === "number" &&
    typeof presentationRevision === "number" &&
    item.presentationRevision !== presentationRevision,
  );
}
