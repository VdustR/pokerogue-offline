import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function createIcnsChunk(type, image) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(image.length + header.length, 4);
  return Buffer.concat([header, image]);
}

function createIcns(logo128, logo512) {
  const chunks = [
    createIcnsChunk("ic07", logo128),
    createIcnsChunk("ic09", logo512),
  ];
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(header.length + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

function createIco(logo128) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(128, 0);
  entry.writeUInt8(128, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
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
