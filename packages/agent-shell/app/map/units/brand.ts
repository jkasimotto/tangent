// The compile-time branding primitive every unit, frame and id in the Map is built on.

/**
 * Brands a structural type with a name so values that share a runtime shape cannot be passed for
 * one another. The brand exists only at compile time: at runtime a `Brand<T, Name>` is exactly a
 * `T`. Every scalar in `units.ts`, every frame shape in `frames.ts` and every id in `ids.ts` is one
 * of these, so a scene pixel cannot land in a screen slot and a source id cannot land in a runtime
 * one. Brands do not nest: a `Brand<Brand<number, "A">, "B">` reduces to `never` because the two
 * `__brand` literals are disjoint discriminants, so each brand is declared directly on its base type.
 */
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
