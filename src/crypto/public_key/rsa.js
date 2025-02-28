// GPG4Browsers - An OpenPGP implementation in javascript
// Copyright (C) 2011 Recurity Labs GmbH
//
// This library is free software; you can redistribute it and/or
// modify it under the terms of the GNU Lesser General Public
// License as published by the Free Software Foundation; either
// version 3.0 of the License, or (at your option) any later version.
//
// This library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
// Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public
// License along with this library; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA

/**
 * @fileoverview RSA implementation
 * @module crypto/public_key/rsa
 * @private
 */

import { randomProbablePrime } from './prime';
import { getRandomBigInteger } from '../random';
import util from '../../util';
import { uint8ArrayToB64, b64ToUint8Array } from '../../encoding/base64';
import { emsaEncode, emeEncode, emeDecode } from '../pkcs1';
import enums from '../../enums';

const webCrypto = util.getWebCrypto();

/** Create signature
 * @param {module:enums.hash} hashAlgo - Hash algorithm
 * @param {Uint8Array} data - Message
 * @param {Uint8Array} n - RSA public modulus
 * @param {Uint8Array} e - RSA public exponent
 * @param {Uint8Array} d - RSA private exponent
 * @param {Uint8Array} p - RSA private prime p
 * @param {Uint8Array} q - RSA private prime q
 * @param {Uint8Array} u - RSA private coefficient
 * @param {Uint8Array} hashed - Hashed message
 * @returns {Promise<Uint8Array>} RSA Signature.
 * @async
 */
export async function sign(hashAlgo, data, n, e, d, p, q, u, hashed) {
  if (data && !util.isStream(data)) {
    if (util.getWebCrypto()) {
      try {
        return await webSign(enums.read(enums.webHash, hashAlgo), data, n, e, d, p, q, u);
      } catch (err) {
        console.error(err);
      }
    }
  }
  return bnSign(hashAlgo, n, d, hashed);
}

/**
 * Verify signature
 * @param {module:enums.hash} hashAlgo - Hash algorithm
 * @param {Uint8Array} data - Message
 * @param {Uint8Array} s - Signature
 * @param {Uint8Array} n - RSA public modulus
 * @param {Uint8Array} e - RSA public exponent
 * @param {Uint8Array} hashed - Hashed message
 * @returns {Boolean}
 * @async
 */
export async function verify(hashAlgo, data, s, n, e, hashed) {
  if (data && !util.isStream(data)) {
    if (util.getWebCrypto()) {
      try {
        return await webVerify(enums.read(enums.webHash, hashAlgo), data, s, n, e);
      } catch (err) {
        console.error(err);
      }
    }
  }
  return bnVerify(hashAlgo, s, n, e, hashed);
}

/**
 * Encrypt message
 * @param {Uint8Array} data - Message
 * @param {Uint8Array} n - RSA public modulus
 * @param {Uint8Array} e - RSA public exponent
 * @returns {Promise<Uint8Array>} RSA Ciphertext.
 * @async
 */
export async function encrypt(data, n, e) {
  return bnEncrypt(data, n, e);
}

/**
 * Decrypt RSA message
 * @param {Uint8Array} m - Message
 * @param {Uint8Array} n - RSA public modulus
 * @param {Uint8Array} e - RSA public exponent
 * @param {Uint8Array} d - RSA private exponent
 * @param {Uint8Array} p - RSA private prime p
 * @param {Uint8Array} q - RSA private prime q
 * @param {Uint8Array} u - RSA private coefficient
 * @param {Uint8Array} randomPayload - Data to return on decryption error, instead of throwing
 *                                     (needed for constant-time processing)
 * @returns {Promise<String>} RSA Plaintext.
 * @throws {Error} on decryption error, unless `randomPayload` is given
 * @async
 */
export async function decrypt(data, n, e, d, p, q, u, randomPayload) {
  return bnDecrypt(data, n, e, d, p, q, u, randomPayload);
}

/**
 * Generate a new random private key B bits long with public exponent E.
 *
 * When possible, webCrypto or nodeCrypto is used. Otherwise, primes are generated using
 * 40 rounds of the Miller-Rabin probabilistic random prime generation algorithm.
 * @see module:crypto/public_key/prime
 * @param {Integer} bits - RSA bit length
 * @param {Integer} e - RSA public exponent
 * @returns {{n, e, d,
 *            p, q ,u: Uint8Array}} RSA public modulus, RSA public exponent, RSA private exponent,
 *                                  RSA private prime p, RSA private prime q, u = p ** -1 mod q
 * @async
 */
export async function generate(bits, e) {
  const BigInteger = await util.getBigInteger();

  e = new BigInteger(e);

  // Native RSA keygen using Web Crypto
  if (util.getWebCrypto()) {
    const keyGenOpt = {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: bits, // the specified keysize in bits
      publicExponent: e.toUint8Array(), // take three bytes (max 65537) for exponent
      hash: {
        name: 'SHA-1' // not required for actual RSA keys, but for crypto api 'sign' and 'verify'
      }
    };
    const keyPair = await webCrypto.generateKey(keyGenOpt, true, ['sign', 'verify']);

    // export the generated keys as JsonWebKey (JWK)
    // https://tools.ietf.org/html/draft-ietf-jose-json-web-key-33
    const jwk = await webCrypto.exportKey('jwk', keyPair.privateKey);
    // map JWK parameters to corresponding OpenPGP names
    return {
      n: b64ToUint8Array(jwk.n),
      e: e.toUint8Array(),
      d: b64ToUint8Array(jwk.d),
      // switch p and q
      p: b64ToUint8Array(jwk.q),
      q: b64ToUint8Array(jwk.p),
      // Since p and q are switched in places, u is the inverse of jwk.q
      u: b64ToUint8Array(jwk.qi)
    };
  }

  // RSA keygen fallback using 40 iterations of the Miller-Rabin test
  // See https://stackoverflow.com/a/6330138 for justification
  // Also see section C.3 here: https://nvlpubs.nist.gov/nistpubs/FIPS/NIST
  let p;
  let q;
  let n;
  do {
    q = await randomProbablePrime(bits - (bits >> 1), e, 40);
    p = await randomProbablePrime(bits >> 1, e, 40);
    n = p.mul(q);
  } while (n.bitLength() !== bits);

  const phi = p.dec().imul(q.dec());

  if (q.lt(p)) {
    [p, q] = [q, p];
  }

  return {
    n: n.toUint8Array(),
    e: e.toUint8Array(),
    d: e.modInv(phi).toUint8Array(),
    p: p.toUint8Array(),
    q: q.toUint8Array(),
    // dp: d.mod(p.subn(1)),
    // dq: d.mod(q.subn(1)),
    u: p.modInv(q).toUint8Array()
  };
}

/**
 * Validate RSA parameters
 * @param {Uint8Array} n - RSA public modulus
 * @param {Uint8Array} e - RSA public exponent
 * @param {Uint8Array} d - RSA private exponent
 * @param {Uint8Array} p - RSA private prime p
 * @param {Uint8Array} q - RSA private prime q
 * @param {Uint8Array} u - RSA inverse of p w.r.t. q
 * @returns {Promise<Boolean>} Whether params are valid.
 * @async
 */
export async function validateParams(n, e, d, p, q, u) {
  const BigInteger = await util.getBigInteger();
  n = new BigInteger(n);
  p = new BigInteger(p);
  q = new BigInteger(q);

  // expect pq = n
  if (!p.mul(q).equal(n)) {
    return false;
  }

  const two = new BigInteger(2);
  // expect p*u = 1 mod q
  u = new BigInteger(u);
  if (!p.mul(u).mod(q).isOne()) {
    return false;
  }

  e = new BigInteger(e);
  d = new BigInteger(d);
  /**
   * In RSA pkcs#1 the exponents (d, e) are inverses modulo lcm(p-1, q-1)
   * We check that [de = 1 mod (p-1)] and [de = 1 mod (q-1)]
   * By CRT on coprime factors of (p-1, q-1) it follows that [de = 1 mod lcm(p-1, q-1)]
   *
   * We blind the multiplication with r, and check that rde = r mod lcm(p-1, q-1)
   */
  const nSizeOver3 = new BigInteger(Math.floor(n.bitLength() / 3));
  const r = await getRandomBigInteger(two, two.leftShift(nSizeOver3)); // r in [ 2, 2^{|n|/3} ) < p and q
  const rde = r.mul(d).mul(e);

  const areInverses = rde.mod(p.dec()).equal(r) && rde.mod(q.dec()).equal(r);
  if (!areInverses) {
    return false;
  }

  return true;
}

async function bnSign(hashAlgo, n, d, hashed) {
  const BigInteger = await util.getBigInteger();
  n = new BigInteger(n);
  const m = new BigInteger(await emsaEncode(hashAlgo, hashed, n.byteLength()));
  d = new BigInteger(d);
  if (m.gte(n)) {
    throw new Error('Message size cannot exceed modulus size');
  }
  return m.modExp(d, n).toUint8Array('be', n.byteLength());
}

async function webSign(hashName, data, n, e, d, p, q, u) {
  /** OpenPGP keys require that p < q, and Safari Web Crypto requires that p > q.
   * We swap them in privateToJWK, so it usually works out, but nevertheless,
   * not all OpenPGP keys are compatible with this requirement.
   * OpenPGP.js used to generate RSA keys the wrong way around (p > q), and still
   * does if the underlying Web Crypto does so (though the tested implementations
   * don't do so).
   */
  const jwk = await privateToJWK(n, e, d, p, q, u);
  const algo = {
    name: 'RSASSA-PKCS1-v1_5',
    hash: { name: hashName }
  };
  const key = await webCrypto.importKey('jwk', jwk, algo, false, ['sign']);
  return new Uint8Array(await webCrypto.sign('RSASSA-PKCS1-v1_5', key, data));
}

async function bnVerify(hashAlgo, s, n, e, hashed) {
  const BigInteger = await util.getBigInteger();
  n = new BigInteger(n);
  s = new BigInteger(s);
  e = new BigInteger(e);
  if (s.gte(n)) {
    throw new Error('Signature size cannot exceed modulus size');
  }
  const EM1 = s.modExp(e, n).toUint8Array('be', n.byteLength());
  const EM2 = await emsaEncode(hashAlgo, hashed, n.byteLength());
  return util.equalsUint8Array(EM1, EM2);
}

async function webVerify(hashName, data, s, n, e) {
  const jwk = publicToJWK(n, e);
  const key = await webCrypto.importKey('jwk', jwk, {
    name: 'RSASSA-PKCS1-v1_5',
    hash: { name:  hashName }
  }, false, ['verify']);
  return webCrypto.verify('RSASSA-PKCS1-v1_5', key, s, data);
}

async function bnEncrypt(data, n, e) {
  const BigInteger = await util.getBigInteger();
  n = new BigInteger(n);
  data = new BigInteger(emeEncode(data, n.byteLength()));
  e = new BigInteger(e);
  if (data.gte(n)) {
    throw new Error('Message size cannot exceed modulus size');
  }
  return data.modExp(e, n).toUint8Array('be', n.byteLength());
}

async function bnDecrypt(data, n, e, d, p, q, u, randomPayload) {
  const BigInteger = await util.getBigInteger();
  data = new BigInteger(data);
  n = new BigInteger(n);
  e = new BigInteger(e);
  d = new BigInteger(d);
  p = new BigInteger(p);
  q = new BigInteger(q);
  u = new BigInteger(u);
  if (data.gte(n)) {
    throw new Error('Data too large.');
  }
  const dq = d.mod(q.dec()); // d mod (q-1)
  const dp = d.mod(p.dec()); // d mod (p-1)

  const unblinder = (await getRandomBigInteger(new BigInteger(2), n)).mod(n);
  const blinder = unblinder.modInv(n).modExp(e, n);
  data = data.mul(blinder).mod(n);


  const mp = data.modExp(dp, p); // data**{d mod (q-1)} mod p
  const mq = data.modExp(dq, q); // data**{d mod (p-1)} mod q
  const h = u.mul(mq.sub(mp)).mod(q); // u * (mq-mp) mod q (operands already < q)

  let result = h.mul(p).add(mp); // result < n due to relations above

  result = result.mul(unblinder).mod(n);


  return emeDecode(result.toUint8Array('be', n.byteLength()), randomPayload);
}

/** Convert Openpgp private key params to jwk key according to
 * @link https://tools.ietf.org/html/rfc7517
 * @param {String} hashAlgo
 * @param {Uint8Array} n
 * @param {Uint8Array} e
 * @param {Uint8Array} d
 * @param {Uint8Array} p
 * @param {Uint8Array} q
 * @param {Uint8Array} u
 */
async function privateToJWK(n, e, d, p, q, u) {
  const BigInteger = await util.getBigInteger();
  const pNum = new BigInteger(p);
  const qNum = new BigInteger(q);
  const dNum = new BigInteger(d);

  let dq = dNum.mod(qNum.dec()); // d mod (q-1)
  let dp = dNum.mod(pNum.dec()); // d mod (p-1)
  dp = dp.toUint8Array();
  dq = dq.toUint8Array();
  return {
    kty: 'RSA',
    n: uint8ArrayToB64(n, true),
    e: uint8ArrayToB64(e, true),
    d: uint8ArrayToB64(d, true),
    // switch p and q
    p: uint8ArrayToB64(q, true),
    q: uint8ArrayToB64(p, true),
    // switch dp and dq
    dp: uint8ArrayToB64(dq, true),
    dq: uint8ArrayToB64(dp, true),
    qi: uint8ArrayToB64(u, true),
    ext: true
  };
}

/** Convert Openpgp key public params to jwk key according to
 * @link https://tools.ietf.org/html/rfc7517
 * @param {String} hashAlgo
 * @param {Uint8Array} n
 * @param {Uint8Array} e
 */
function publicToJWK(n, e) {
  return {
    kty: 'RSA',
    n: uint8ArrayToB64(n, true),
    e: uint8ArrayToB64(e, true),
    ext: true
  };
}
