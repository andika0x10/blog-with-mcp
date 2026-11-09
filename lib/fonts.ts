export const fonts = [
  { id: "public-sans", name: "Public Sans", family: "Public Sans Variable", tracking: "-0.065em", serif: false },
  { id: "source-sans-3", name: "Source Sans 3", family: "Source Sans 3 Variable", tracking: "-0.035em", serif: false },
  { id: "ibm-plex-sans", name: "IBM Plex Sans", family: "IBM Plex Sans Variable", tracking: "-0.035em", serif: false },
  { id: "dm-sans", name: "DM Sans", family: "DM Sans Variable", tracking: "-0.045em", serif: false },
  { id: "manrope", name: "Manrope", family: "Manrope Variable", tracking: "-0.035em", serif: false },
  { id: "lato", name: "Lato", family: "Lato", tracking: "-0.025em", serif: false },
  { id: "noto-sans", name: "Noto Sans", family: "Noto Sans Variable", tracking: "-0.035em", serif: false },
  { id: "atkinson-hyperlegible-next", name: "Atkinson Hyperlegible Next", family: "Atkinson Hyperlegible Next Variable", tracking: "-0.02em", serif: false },
  { id: "source-serif-4", name: "Source Serif 4", family: "Source Serif 4 Variable", tracking: "-0.015em", serif: true },
  { id: "literata", name: "Literata", family: "Literata Variable", tracking: "-0.01em", serif: true },
] as const;
export type FontId = (typeof fonts)[number]["id"];
export const defaultFont: FontId = "public-sans";

// Kept serializable so the same profiles can be restored before hydration.
export const fontProfiles = Object.fromEntries(
  fonts.map((font) => [
    font.id,
    {
      "--visitor-font": `"${font.family}", ${font.serif ? "Georgia, serif" : "ui-sans-serif, system-ui, sans-serif"}`,
      "--heading-tracking": font.tracking,
      "--heading-leading": font.serif ? "1.25" : "1.15",
      "--reading-leading": font.serif ? "1.95" : "1.85",
      "--reading-leading-mobile": font.serif ? "1.9" : "1.8",
      "--title-tracking": font.id === defaultFont ? "-0.055em" : font.tracking,
      "--subheading-tracking": font.id === defaultFont ? "-0.045em" : font.tracking,
      "--section-tracking": font.id === defaultFont ? "-0.06em" : font.tracking,
      "--minor-heading-tracking": font.id === defaultFont ? "-0.035em" : font.tracking,
    },
  ])
);
export function resolveFont(value: string | null | undefined): FontId {
  return fonts.find((font) => font.id === value)?.id ?? defaultFont;
}
export function applyFont(value: string) {
  const id = resolveFont(value);
  // Let the active reveal clean up so the new font can reflow naturally.
  window.dispatchEvent(new Event("blog-typography-change"));
  document.documentElement.dataset.font = id;
  for (const [name, setting] of Object.entries(fontProfiles[id])) document.documentElement.style.setProperty(name, setting);
}
export const fontBootstrap = `(function(){var p=${JSON.stringify(fontProfiles)},f='${defaultFont}';try{var v=localStorage.getItem('blog-font');if(Object.prototype.hasOwnProperty.call(p,v))f=v}catch(e){}var r=document.documentElement;r.dataset.font=f;Object.keys(p[f]).forEach(function(k){r.style.setProperty(k,p[f][k])})})();`;
