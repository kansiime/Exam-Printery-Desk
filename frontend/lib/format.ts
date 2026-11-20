export const fmt = (v: number | null | undefined) => (v == null ? "–" : Math.round(v).toLocaleString("en-US"));
export const ugx = (v: number | null | undefined) => "UGX " + fmt(v ?? 0);
export const today = () => new Date().toLocaleDateString("en-CA");

export function when(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return iso.length > 10 ? `${date} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : date;
}

export const ROLE_LABEL: Record<string, string> = { owner: "Owner", printer: "Printer", store: "Store keeper", sales: "Sales person" };

/** Shrink a phone photo before upload so it sends fast on a weak network. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.8));
  } catch {
    return file;
  }
}
