// Line count: the number of LF bytes, plus one when the last line has no LF.
// An empty file has 0 lines; CRLF counts as one line.
export function lineTotal(bytes: Uint8Array): number {
  let count = 0;
  for (const b of bytes) if (b === 0x0a) count++;
  if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) count++;
  return count;
}
