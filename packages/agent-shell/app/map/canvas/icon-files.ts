// Figure icon registration for image icons.
//
// A kind in Julian's map-kinds.md may name a picture instead of a drawing. Excalidraw draws an
// image element only once the bytes behind its file id are registered, and it keeps one decoded
// picture per id, so each id is registered exactly once. Two jobs live here. `prepareFigureIconImages`
// turns the catalog's image icons into the form the Map's theme draws correctly, which for an SVG
// under the dark theme means rasterizing it to a PNG. `IconFileRegistry` registers the bytes a
// projection's figures need and reports each newly registered id through the `map-icon-files`
// diagnostic the figure-images browser suite listens for.
//
// The rasterizer, the cache and the clock are injected so the logic runs under Node with no DOM.

import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { KINDS } from "../copy.ts";
import { figureIconFiles } from "../kernel/kernel-boundary.ts";
import type { EpochMilliseconds, MapIcon, MapImageIcon, MapKindsCatalog, MapKindsProblem, SceneElement } from "../kernel/kernel-types.ts";
import { LAYOUT } from "../layout/layout-tokens.ts";

/** Excalidraw's two themes. */
export type MapTheme = AppState["theme"];

/** The theme the Map always runs in. Its inverting canvas filter is why an SVG icon is rasterized. */
export const MAP_THEME: MapTheme = "dark";

/** The one image type Excalidraw draws without its own inversion, and the type it is rasterized to. */
const SVG_MIME_TYPE = "image/svg+xml";
const PNG_MIME_TYPE = "image/png";

/** Turns one image icon into the form the theme draws correctly. Injected so a test needs no canvas. */
export type IconRasterizer = (icon: MapImageIcon, theme: MapTheme) => Promise<MapImageIcon>;

/** The theme-ready bytes of every image icon drawn so far, keyed by icon, content and theme. */
export type IconImageCache = Map<string, MapImageIcon>;

/** One coordinate-free diagnostic: the file ids just registered with Excalidraw. */
export type MapIconFilesEvent = {
  readonly name: "map-icon-files";
  readonly at: EpochMilliseconds;
  readonly files: readonly FileId[];
};

/** What the registry is built on. */
export type IconFileRegistryDependencies = {
  readonly api: () => Pick<ExcalidrawImperativeAPI, "addFiles"> | null;
  readonly emit: (event: MapIconFilesEvent) => void;
  readonly now: () => EpochMilliseconds;
};

/** The module's own cache, shared by every catalog read for the life of the page. */
const sharedIconImageCache: IconImageCache = new Map();

/** Decodes one data URL into an image the Map can redraw. Rejects when the browser cannot read it. */
export function decodeIconImage(dataURL: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    /** Hands back the decoded picture. */
    image.onload = () => resolve(image);
    /** Fails the conversion so the kind falls back to a card, never a broken picture. */
    image.onerror = () => reject(new Error(KINDS.imageDidNotDecode));
    image.src = dataURL;
  });
}

/** Reads a blob back as the data URL Excalidraw registers. */
function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    /** Hands back the encoded bytes. */
    reader.onload = () => resolve(String(reader.result));
    /** Fails the conversion the same way an undecodable image does. */
    reader.onerror = () => reject(new Error(KINDS.imageDidNotDecode));
    reader.readAsDataURL(blob);
  });
}

/**
 * Draws one SVG icon onto an offscreen canvas and returns it as a PNG. The catalog read the drawn
 * size out of the file itself, from the width and height or the viewBox; the browser invents 300
 * by 150 for an SVG that declares neither, so the catalog's size is trusted first. A vector icon
 * has no pixels of its own, so it is rasterized large enough to stay sharp when the Map zooms in;
 * one already larger keeps its own size.
 */
async function rasterizeSvgIcon(icon: MapImageIcon, theme: MapTheme): Promise<MapImageIcon> {
  const image = await decodeIconImage(icon.dataURL);
  const naturalWidth = Number(icon.width) || image.naturalWidth || 1;
  const naturalHeight = Number(icon.height) || image.naturalHeight || 1;
  const scale = Math.max(1, LAYOUT.iconRasterLongEdge / Math.max(1, naturalWidth, naturalHeight));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(naturalWidth * scale)), Math.max(1, Math.round(naturalHeight * scale)));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error(KINDS.noCanvasContext);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataURL = await dataUrlOf(await canvas.convertToBlob({ type: PNG_MIME_TYPE }));
  // The bytes are new, so the file id has to be new: Excalidraw keeps one decoded picture per id.
  return { ...icon, mimeType: PNG_MIME_TYPE, dataURL, contentHash: `${icon.contentHash}-${theme}` };
}

/**
 * Returns one image icon's bytes in the form the Map's theme draws correctly.
 *
 * The dark theme puts `invert(0.93) hue-rotate(180deg)` on the canvas element. Excalidraw already
 * pre-inverts every raster image it draws in that theme, so a picture comes back out of the filter
 * as it was supplied. It makes one exception, an SVG, which it draws untouched and the filter then
 * washes out. So an SVG is drawn once and registered as a PNG, which puts it on the path every
 * other picture takes. No filter is applied here: a second inversion would cancel Excalidraw's own.
 */
export function themeIconImage(icon: MapImageIcon, theme: MapTheme): Promise<MapImageIcon> {
  if (theme !== "dark" || icon.mimeType !== SVG_MIME_TYPE) return Promise.resolve(icon);
  return rasterizeSvgIcon(icon, theme);
}

/** The names of the icons in a catalog that are pictures rather than drawings. */
function imageIconNames(icons: Readonly<Record<string, MapIcon>>): string[] {
  return Object.keys(icons).filter((name) => icons[name]?.kind === "image");
}

/** The words of one icon that failed conversion, as the kinds notice prints them. */
function iconProblem(name: string, error: unknown): MapKindsProblem {
  const message = error instanceof Error ? error.message : String(error);
  return { scope: "icon", name, message: KINDS.iconProblem(name, message) };
}

/**
 * Returns the catalog with every image icon carried in the form the theme draws correctly. An
 * image the browser cannot read becomes a problem and leaves the catalog, so the kind that names
 * it falls back to a card. The result is cached per icon, content and theme, so the resource
 * cadence converts nothing twice and a theme change converts once more.
 */
export async function prepareFigureIconImages(
  catalog: MapKindsCatalog | null,
  theme: MapTheme = MAP_THEME,
  rasterize: IconRasterizer = themeIconImage,
  cache: IconImageCache = sharedIconImageCache,
): Promise<MapKindsCatalog | null> {
  if (catalog === null) return null;
  const names = imageIconNames(catalog.icons);
  if (names.length === 0) return catalog;
  const icons: Record<string, MapIcon> = { ...catalog.icons };
  const problems: MapKindsProblem[] = [...catalog.problems];
  for (const name of names) {
    const icon = catalog.icons[name];
    if (icon === undefined || icon.kind !== "image") continue;
    const key = `${name}:${icon.contentHash}:${theme}`;
    try {
      const ready = cache.get(key) ?? (await rasterize(icon, theme));
      cache.set(key, ready);
      icons[name] = ready;
    } catch (error) {
      delete icons[name];
      problems.push(iconProblem(name, error));
    }
  }
  return { ...catalog, revision: `${catalog.revision}:${theme}`, icons, problems };
}

/** Registers each icon file id with Excalidraw exactly once and reports the new ones. */
export class IconFileRegistry {
  private readonly deps: IconFileRegistryDependencies;
  private readonly registered = new Set<FileId>();

  /** Builds a registry over the injected api, diagnostic sink and clock. */
  constructor(deps: IconFileRegistryDependencies) {
    this.deps = deps;
  }

  /**
   * Registers the bytes of every image icon the projection draws that Excalidraw does not hold
   * yet. The bytes have to reach Excalidraw before the elements that name them, so the caller runs
   * this before it pushes a projection. Returns the ids registered this time; empty when none.
   */
  register(elements: readonly SceneElement[], icons: Readonly<Record<string, MapIcon>>): readonly FileId[] {
    const api = this.deps.api();
    if (api === null) return [];
    const files = figureIconFiles(elements, icons, this.deps.now());
    const missing = files.filter((file) => !this.registered.has(file.id));
    if (missing.length === 0) return [];
    for (const file of missing) this.registered.add(file.id);
    api.addFiles([...missing]);
    const ids = missing.map((file) => file.id);
    this.deps.emit({ name: "map-icon-files", at: this.deps.now(), files: ids });
    return ids;
  }
}
