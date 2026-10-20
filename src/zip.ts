const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const STORED = 0;
const DEFLATE = 8;

export type Bytes = ArrayBuffer | Uint8Array<ArrayBuffer>;
export type ZipMembers = Map<string, () => Promise<Uint8Array<ArrayBuffer>>>;

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Reads the central directory and returns name -> async () => bytes, so members decompress one at a time.
// ponytail: no ZIP64 and no encryption; Yomitan dictionaries use neither.
export function unzip(input: Bytes): ZipMembers {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== EOCD) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');

  const members: ZipMembers = new Map();
  let at = view.getUint32(eocd + 16, true);
  for (let i = view.getUint16(eocd + 10, true); i > 0; i--) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error('Corrupt zip central directory');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);

    members.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === STORED) return data;
      if (method === DEFLATE) return inflate(data);
      throw new Error(`Unsupported zip compression method ${method} in ${name}`);
    });
  }
  return members;
}
