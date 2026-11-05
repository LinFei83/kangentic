/**
 * Git C-quoted path names from `ls-tree --name-only`.
 *
 * Default `core.quotepath=true` wraps a non-ASCII name in quotes and writes
 * each byte as `\nnn` octal, so `创建测试变更` becomes
 * `"\345\210\233\345\273\272\346\265\213\350\257\225\345\217\230\346\233\264"`.
 * Callers that treat that string as an OpenSpec change name fail validate
 * and show a garbled title. `-c core.quotepath=false` stops the quoting;
 * this decoder still recovers a leftover quoted line.
 */

const C_ESCAPE_BYTES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  '\\': 0x5c,
};

/** Prefix for `git.raw` so `ls-tree --name-only` emits UTF-8 names, not octal. */
export const GIT_LS_TREE_NO_QUOTE: readonly string[] = ['-c', 'core.quotepath=false'];

/**
 * Decode one `ls-tree --name-only` line. Unquoted names pass through.
 * A C-quoted line (`"..."`) is unescaped: octal `\nnn` bytes become UTF-8,
 * and the usual C escapes (`\n`, `\t`, `\\`, `\"`) match git's quote.c.
 */
export function decodeGitQuotedPath(rawPath: string): string {
  const trimmedPath = rawPath.trim();
  if (trimmedPath.length < 2 || !trimmedPath.startsWith('"') || !trimmedPath.endsWith('"')) {
    return trimmedPath;
  }
  const quotedBody = trimmedPath.slice(1, -1);
  const decodedBytes: number[] = [];
  let cursor = 0;
  while (cursor < quotedBody.length) {
    if (quotedBody[cursor] !== '\\') {
      decodedBytes.push(quotedBody.charCodeAt(cursor));
      cursor += 1;
      continue;
    }
    const escapeCharacter = quotedBody[cursor + 1];
    if (escapeCharacter === undefined) {
      decodedBytes.push(0x5c);
      break;
    }
    if (escapeCharacter >= '0' && escapeCharacter <= '7') {
      let octalDigits = escapeCharacter;
      let digitCount = 1;
      while (digitCount < 3) {
        const nextDigit = quotedBody[cursor + 1 + digitCount];
        if (nextDigit === undefined || nextDigit < '0' || nextDigit > '7') break;
        octalDigits += nextDigit;
        digitCount += 1;
      }
      decodedBytes.push(parseInt(octalDigits, 8));
      cursor += 1 + digitCount;
      continue;
    }
    decodedBytes.push(C_ESCAPE_BYTES[escapeCharacter] ?? escapeCharacter.charCodeAt(0));
    cursor += 2;
  }
  return Buffer.from(decodedBytes).toString('utf8');
}

/** Split `ls-tree --name-only` stdout into decoded path names. */
export function parseGitNameOnlyOutput(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => decodeGitQuotedPath(line))
    .filter((name) => name.length > 0);
}

/**
 * The C-quoted form default `core.quotepath` prints for `pathName`. ASCII
 * names that need no quoting are returned as-is. Used to find a change card
 * stored under the quoted directory name from before listing was decoded.
 */
export function encodeGitQuotedPath(pathName: string): string {
  const pathBytes = Buffer.from(pathName, 'utf8');
  let needsQuote = pathBytes.length === 0;
  let quotedBody = '';
  for (const pathByte of pathBytes) {
    if (pathByte === 0x22) {
      needsQuote = true;
      quotedBody += '\\"';
      continue;
    }
    if (pathByte === 0x5c) {
      needsQuote = true;
      quotedBody += '\\\\';
      continue;
    }
    if (pathByte < 0x20 || pathByte >= 0x7f) {
      needsQuote = true;
      quotedBody += `\\${pathByte.toString(8).padStart(3, '0')}`;
      continue;
    }
    quotedBody += String.fromCharCode(pathByte);
  }
  return needsQuote ? `"${quotedBody}"` : pathName;
}

/**
 * Lookup keys for one change directory: the real name, then the C-quoted
 * form a previous scan may have stored. Real name first so a rewritten card
 * wins over a leftover quoted row.
 */
export function gitQuotedPathAliases(pathName: string): string[] {
  const quotedPath = encodeGitQuotedPath(pathName);
  if (quotedPath === pathName) return [pathName];
  return [pathName, quotedPath];
}
