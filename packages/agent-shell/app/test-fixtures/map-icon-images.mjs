// Image icon fixtures for the Map kinds tests. The PNG builder writes a real,
// decodable picture, because the browser test has to see it drawn on the
// canvas. The JPEG and WebP builders write only the container headers the
// dimension readers parse, which is all the unit tests need.

import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Returns one byte's CRC-32 remainder table entry. */
function crcEntry(index) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => crcEntry(index));

/** Returns the CRC-32 of one buffer, which every PNG chunk carries. */
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Returns one length-prefixed, CRC-checked PNG chunk. */
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Builds one real, decodable PNG of a single colour. */
export function pngIconBytes({ width = 64, height = 64, colour = [0xd6, 0x33, 0x84] } = {}) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const at = row * stride + 1 + column * 3;
      raw[at] = colour[0];
      raw[at + 1] = colour[1];
      raw[at + 2] = colour[2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // Eight bits a channel, truecolour, no interlacing.
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Builds the JFIF and frame headers of one JPEG, which carry its size. */
export function jpegIconBytes({ width = 320, height = 200 } = {}) {
  const frame = Buffer.alloc(17);
  frame.writeUInt16BE(17, 0);
  frame[2] = 8;
  frame.writeUInt16BE(height, 3);
  frame.writeUInt16BE(width, 5);
  frame[7] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    Buffer.from([0xff, 0xc0]),
    frame,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Builds the RIFF container and VP8X chunk of one WebP, which carry its size. */
export function webpIconBytes({ width = 500, height = 400 } = {}) {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  const chunk = Buffer.concat([Buffer.from("VP8X", "latin1"), Buffer.from([10, 0, 0, 0]), payload]);
  const riff = Buffer.alloc(4);
  riff.writeUInt32LE(4 + chunk.length, 0);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), riff, Buffer.from("WEBP", "latin1"), chunk]);
}

/** Builds one SVG icon, with or without the width and height attributes. */
export function svgIconText({ width = 240, height = 120, sized = true, colour = "#d63384" } = {}) {
  const size = sized ? ` width="${width}" height="${height}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="0 0 ${width} ${height}">\n  <rect x="0" y="0" width="${width}" height="${height}" fill="${colour}"/>\n</svg>\n`;
}

export default { jpegIconBytes, pngIconBytes, svgIconText, webpIconBytes };
