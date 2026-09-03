// Image icon preparation and file registration under Node, with an injected rasterizer and a fake api.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import { figureIconFileId } from "../kernel/kernel-boundary.ts";
import type { MapImageIcon, MapKindsCatalog, SceneElement } from "../kernel/kernel-types.ts";
import { runtimeId } from "../units/ids.ts";
import { IconFileRegistry, MAP_THEME, prepareFigureIconImages, themeIconImage } from "./icon-files.ts";
import type { IconImageCache, MapIconFilesEvent } from "./icon-files.ts";

/** One image icon of the catalog. */
function imageIcon(name: string, mimeType: string, contentHash: string): MapImageIcon {
  return { name, kind: "image", mimeType, dataURL: `data:${mimeType};base64,AAAA`, width: 8, height: 4, contentHash, warning: null };
}

/** A catalog with the given icons and no problems. */
function catalog(icons: MapKindsCatalog["icons"]): MapKindsCatalog {
  return { revision: "kinds-1", kinds: [], icons, problems: [] };
}

/** A rasterizer that renames the bytes the way the browser one does, or fails for a named icon. */
function fakeRasterizer(failing: string | null) {
  const calls: string[] = [];
  /** Converts one icon, recording the call. */
  const rasterize = async (icon: MapImageIcon, theme: string): Promise<MapImageIcon> => {
    calls.push(icon.name);
    if (icon.name === failing) throw new Error("the image did not decode");
    if (icon.mimeType !== "image/svg+xml") return icon;
    return { ...icon, mimeType: "image/png", contentHash: `${icon.contentHash}-${theme}` };
  };
  return { rasterize, calls };
}

test("a catalog with no image icons is returned as it is", async () => {
  const drawingOnly = catalog({ pen: { name: "pen", kind: "drawing", width: 1, height: 1, elements: [], elementCount: 0 as never, warning: null } });
  assert.equal(await prepareFigureIconImages(drawingOnly, MAP_THEME, fakeRasterizer(null).rasterize, new Map()), drawingOnly);
  assert.equal(await prepareFigureIconImages(null), null);
});

test("image icons are converted through the rasterizer, the revision names the theme, and the cache stops a second conversion", async () => {
  const source = catalog({ worktree: imageIcon("worktree", "image/png", "aaaa"), repository: imageIcon("repository", "image/svg+xml", "bbbb") });
  const { rasterize, calls } = fakeRasterizer(null);
  const cache: IconImageCache = new Map();
  const prepared = await prepareFigureIconImages(source, "dark", rasterize, cache);
  assert.ok(prepared !== null);
  assert.equal(prepared.revision, "kinds-1:dark");
  assert.equal(prepared.icons.worktree?.kind === "image" ? prepared.icons.worktree.contentHash : "", "aaaa");
  assert.equal(prepared.icons.repository?.kind === "image" ? prepared.icons.repository.mimeType : "", "image/png");
  assert.equal(prepared.icons.repository?.kind === "image" ? prepared.icons.repository.contentHash : "", "bbbb-dark");
  assert.deepEqual(prepared.problems, []);
  assert.deepEqual(calls.sort(), ["repository", "worktree"]);
  await prepareFigureIconImages(source, "dark", rasterize, cache);
  assert.equal(calls.length, 2, "the cache answers the second read");
  assert.equal(source.icons.repository?.kind === "image" ? source.icons.repository.mimeType : "", "image/svg+xml", "the source catalog is untouched");
});

test("an icon the browser cannot read leaves the catalog as a problem so its kind falls back to a card", async () => {
  const source = catalog({ worktree: imageIcon("worktree", "image/svg+xml", "aaaa"), repository: imageIcon("repository", "image/png", "bbbb") });
  const prepared = await prepareFigureIconImages(source, "dark", fakeRasterizer("worktree").rasterize, new Map());
  assert.ok(prepared !== null);
  assert.deepEqual(Object.keys(prepared.icons), ["repository"]);
  assert.deepEqual(prepared.problems, [{ scope: "icon", name: "worktree", message: "worktree: the image did not decode" }]);
});

test("themeIconImage passes a raster icon through untouched in every theme and an SVG through under the light theme", async () => {
  const png = imageIcon("worktree", "image/png", "aaaa");
  assert.equal(await themeIconImage(png, "dark"), png);
  const svg = imageIcon("repository", "image/svg+xml", "bbbb");
  assert.equal(await themeIconImage(svg, "light"), svg);
});

/** A figure icon element of the projection, naming its icon and the file id its bytes register under. */
function figureElement(id: string, icon: string, contentHash: string): SceneElement {
  return {
    id: runtimeId(id), type: "image", x: 0, y: 0, width: 8, height: 4, isDeleted: false,
    fileId: figureIconFileId(icon, contentHash),
    customData: { tangentWorldEphemeral: { kind: "resource-figure-icon", icon } },
  } as unknown as SceneElement;
}

test("the registry registers each icon file once, hands the bytes to Excalidraw first, and reports the new ids", () => {
  const added: BinaryFileData[][] = [];
  const events: MapIconFilesEvent[] = [];
  const registry = new IconFileRegistry({
    /** Hands back a fake Excalidraw that records the bytes it is given. */
    api: () => ({
      /** Records one batch of registered files. */
      addFiles: (files) => { added.push(files); },
    }),
    /** Records one diagnostic. */
    emit: (event) => { events.push(event); },
    /** A fixed clock, so the created stamp is checked exactly. */
    now: () => 1234,
  });
  const icons = { worktree: imageIcon("worktree", "image/png", "aaaa") };
  const elements = [figureElement("f1", "worktree", "aaaa")];
  const expectedId: FileId = figureIconFileId("worktree", "aaaa");
  assert.deepEqual(registry.register(elements, icons), [expectedId]);
  assert.equal(added.length, 1);
  assert.equal(added[0]?.[0]?.id, expectedId);
  assert.equal(added[0]?.[0]?.created, 1234);
  assert.deepEqual(events, [{ name: "map-icon-files", at: 1234, files: [expectedId] }]);
  assert.deepEqual(registry.register(elements, icons), [], "the same bytes are never registered twice");
  assert.equal(added.length, 1);
  assert.equal(events.length, 1);
});

test("the registry does nothing before Excalidraw is mounted or for a projection without image icons", () => {
  const events: MapIconFilesEvent[] = [];
  const unmounted = new IconFileRegistry({
    /** Reports Excalidraw as not mounted. */
    api: () => null,
    /** Records one diagnostic. */
    emit: (event) => { events.push(event); },
    /** A clock that never advances. */
    now: () => 0,
  });
  assert.deepEqual(unmounted.register([figureElement("f1", "worktree", "aaaa")], { worktree: imageIcon("worktree", "image/png", "aaaa") }), []);
  const mounted = new IconFileRegistry({
    /** Hands back a fake Excalidraw that drops the bytes. */
    api: () => ({
      /** Drops one batch of registered files. */
      addFiles: () => {},
    }),
    /** Records one diagnostic. */
    emit: (event) => { events.push(event); },
    /** A clock that never advances. */
    now: () => 0,
  });
  assert.deepEqual(mounted.register([figureElement("f1", "worktree", "aaaa")], {}), []);
  assert.deepEqual(events, []);
});
