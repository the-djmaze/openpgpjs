/**
 * @fileoverview This module implements HKDF using either the WebCrypto API or Node.js' crypto API.
 * @module crypto/hkdf
 * @private
 */

import enums from '../enums';
import util from '../util';

const webCrypto = util.getWebCrypto();

export default async function HKDF(hashAlgo, inputKey, salt, info, outLen) {
  const hash = enums.read(enums.webHash, hashAlgo);
  if (!hash) throw new Error('Hash algo not supported with HKDF');

  if (webCrypto) {
    const crypto = webCrypto;
    const importedKey = await crypto.importKey('raw', inputKey, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.deriveBits({ name: 'HKDF', hash, salt, info }, importedKey, outLen * 8);
    return new Uint8Array(bits);
  }

  throw new Error('No HKDF implementation available');
}
