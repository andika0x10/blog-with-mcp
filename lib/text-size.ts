export const textSizes = [
  { id: "90", label: "Kecil — 90%", scale: "0.9" },
  { id: "100", label: "Normal — 100%", scale: "1" },
  { id: "110", label: "Besar — 110%", scale: "1.1" },
  { id: "120", label: "Lebih besar — 120%", scale: "1.2" },
] as const;
export type TextSizeId = (typeof textSizes)[number]["id"];
export const defaultTextSize: TextSizeId = "100";
export function resolveTextSize(value: string | null | undefined): TextSizeId {
  return textSizes.find((size) => size.id === value)?.id ?? defaultTextSize;
}
export function applyTextSize(value: string) {
  const id = resolveTextSize(value);
  window.dispatchEvent(new Event("blog-typography-change"));
  document.documentElement.dataset.fontSize = id;
  document.documentElement.style.setProperty("--visitor-text-scale", textSizes.find((size) => size.id === id)!.scale);
}
export const textSizeBootstrap = `(function(){var s=${JSON.stringify(textSizes)},v='${defaultTextSize}';try{v=localStorage.getItem('blog-font-size')||v}catch(e){}var f=s.find(function(x){return x.id===v})||s[1],r=document.documentElement;r.dataset.fontSize=f.id;r.style.setProperty('--visitor-text-scale',f.scale)})();`;
