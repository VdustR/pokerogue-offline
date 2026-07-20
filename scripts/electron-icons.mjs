import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ICNS_HEADER_SIZE = 8;
const ICNS_ICON_128_PNG = "ic07";
const ICNS_ICON_512_PNG = "ic09";

const ICO_HEADER_SIZE = 6;
const ICO_DIRECTORY_ENTRY_SIZE = 16;
const ICO_TYPE_ICON = 1;
const ICO_IMAGE_COUNT = 1;
const ICO_IMAGE_SIZE = 128;
const ICO_COLOR_PLANES = 1;
const ICO_BITS_PER_PIXEL = 32;

function createIcnsChunk(type, image) {
  const header = Buffer.alloc(ICNS_HEADER_SIZE);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(image.length + header.length, 4);
  return Buffer.concat([header, image]);
}

function createIcns(logo128, logo512) {
  const chunks = [
    createIcnsChunk(ICNS_ICON_128_PNG, logo128),
    createIcnsChunk(ICNS_ICON_512_PNG, logo512),
  ];
  const header = Buffer.alloc(ICNS_HEADER_SIZE);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(header.length + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

function createIco(logo128) {
  const header = Buffer.alloc(ICO_HEADER_SIZE);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(ICO_TYPE_ICON, 2);
  header.writeUInt16LE(ICO_IMAGE_COUNT, 4);

  const entry = Buffer.alloc(ICO_DIRECTORY_ENTRY_SIZE);
  entry.writeUInt8(ICO_IMAGE_SIZE, 0);
  entry.writeUInt8(ICO_IMAGE_SIZE, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(ICO_COLOR_PLANES, 4);
  entry.writeUInt16LE(ICO_BITS_PER_PIXEL, 6);
  entry.writeUInt32LE(logo128.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);
  return Buffer.concat([header, entry, logo128]);
}

export async function createElectronIcons(distDirectory, outputBasePath) {
  const [logo128, logo512] = await Promise.all([
    readFile(path.join(distDirectory, "logo128.png")),
    readFile(path.join(distDirectory, "logo512.png")),
  ]);
  await Promise.all([
    writeFile(`${outputBasePath}.icns`, createIcns(logo128, logo512)),
    writeFile(`${outputBasePath}.ico`, createIco(logo128)),
  ]);
}
