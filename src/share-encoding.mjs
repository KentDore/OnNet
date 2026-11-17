const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(bytes) {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const hasB = i + 1 < bytes.length;
    const hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1] : 0;
    const c = hasC ? bytes[i + 2] : 0;
    output += BASE64[a >> 2];
    output += BASE64[((a & 3) << 4) | (b >> 4)];
    output += hasB ? BASE64[((b & 15) << 2) | (c >> 6)] : '=';
    output += hasC ? BASE64[c & 63] : '=';
  }
  return output;
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TypeError('Chaîne Base64 invalide.');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const a = BASE64.indexOf(value[i]);
    const b = BASE64.indexOf(value[i + 1]);
    const c = value[i + 2] === '=' ? 0 : BASE64.indexOf(value[i + 2]);
    const d = value[i + 3] === '=' ? 0 : BASE64.indexOf(value[i + 3]);
    if (offset < output.length) output[offset++] = (a << 2) | (b >> 4);
    if (offset < output.length) output[offset++] = ((b & 15) << 4) | (c >> 2);
    if (offset < output.length) output[offset++] = ((c & 3) << 6) | d;
  }
  return output;
}

export function toBase64Url(value) {
  if (typeof value !== 'string') throw new TypeError('La valeur à encoder doit être une chaîne.');
  return encodeBase64(new TextEncoder().encode(value))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    throw new TypeError('Chaîne Base64 URL invalide.');
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64(padded));
}
