// OpenPGP.js - An OpenPGP implementation in javascript
// Copyright (C) 2015-2016 Decentral
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
 * @fileoverview Wrapper of an instance of an Elliptic Curve
 * @module crypto/public_key/elliptic/curve
 * @private
 */

import nacl from '@openpgp/tweetnacl/nacl-fast-light';
import { getRandomBytes } from '../../random';
import enums from '../../../enums';
import util from '../../../util';
import { uint8ArrayToB64, b64ToUint8Array } from '../../../encoding/base64';
import OID from '../../../type/oid';
import { keyFromPublic, keyFromPrivate, getIndutnyCurve } from './indutnyKey';
import { UnsupportedError } from '../../../packet/packet';

const webCrypto = util.getWebCrypto();

const webCurves = {
  'p256': 'P-256',
  'p384': 'P-384',
  'p521': 'P-521'
};

const curves = {
  p256: {
    oid: [0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07],
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha256,
    cipher: enums.symmetric.aes128,
    web: webCurves.p256,
    payloadSize: 32,
    sharedSize: 256
  },
  p384: {
    oid: [0x06, 0x05, 0x2B, 0x81, 0x04, 0x00, 0x22],
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha384,
    cipher: enums.symmetric.aes192,
    web: webCurves.p384,
    payloadSize: 48,
    sharedSize: 384
  },
  p521: {
    oid: [0x06, 0x05, 0x2B, 0x81, 0x04, 0x00, 0x23],
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha512,
    cipher: enums.symmetric.aes256,
    web: webCurves.p521,
    payloadSize: 66,
    sharedSize: 528
  },
  secp256k1: {
    oid: [0x06, 0x05, 0x2B, 0x81, 0x04, 0x00, 0x0A],
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha256,
    cipher: enums.symmetric.aes128,
    payloadSize: 32
  },
  ed25519: {
    oid: [0x06, 0x09, 0x2B, 0x06, 0x01, 0x04, 0x01, 0xDA, 0x47, 0x0F, 0x01],
    keyType: enums.publicKey.eddsaLegacy,
    hash: enums.hash.sha512,
    payloadSize: 32
  },
  curve25519: {
    oid: [0x06, 0x0A, 0x2B, 0x06, 0x01, 0x04, 0x01, 0x97, 0x55, 0x01, 0x05, 0x01],
    keyType: enums.publicKey.ecdh,
    hash: enums.hash.sha256,
    cipher: enums.symmetric.aes128,
    payloadSize: 32
  },
  brainpoolP256r1: {
    oid: [0x06, 0x09, 0x2B, 0x24, 0x03, 0x03, 0x02, 0x08, 0x01, 0x01, 0x07],
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha256,
    cipher: enums.symmetric.aes128,
    payloadSize: 32
  },
  brainpoolP384r1: {
    oid: [0x06, 0x09, 0x2B, 0x24, 0x03, 0x03, 0x02, 0x08, 0x01, 0x01, 0x0B],
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha384,
    cipher: enums.symmetric.aes192,
    payloadSize: 48
  },
  brainpoolP512r1: {
    oid: [0x06, 0x09, 0x2B, 0x24, 0x03, 0x03, 0x02, 0x08, 0x01, 0x01, 0x0D],
    keyType: enums.publicKey.ecdsa,
    hash: enums.hash.sha512,
    cipher: enums.symmetric.aes256,
    payloadSize: 64
  }
};

class CurveWithOID {
  constructor(oidOrName, params) {
    try {
      if (util.isArray(oidOrName) ||
          util.isUint8Array(oidOrName)) {
        // by oid byte array
        oidOrName = new OID(oidOrName);
      }
      if (oidOrName instanceof OID) {
        // by curve OID
        oidOrName = oidOrName.getName();
      }
      // by curve name or oid string
      this.name = enums.write(enums.curve, oidOrName);
    } catch (err) {
      throw new UnsupportedError('Unknown curve');
    }
    params = params || curves[this.name];

    this.keyType = params.keyType;

    this.oid = params.oid;
    this.hash = params.hash;
    this.cipher = params.cipher;
    this.web = params.web && curves[this.name];
    this.payloadSize = params.payloadSize;
    if (this.web && util.getWebCrypto()) {
      this.type = 'web';
    } else if (this.name === 'curve25519') {
      this.type = 'curve25519';
    } else if (this.name === 'ed25519') {
      this.type = 'ed25519';
    }
  }

  async genKeyPair() {
    let keyPair;
    switch (this.type) {
      case 'web':
        try {
          return await webGenKeyPair(this.name);
        } catch (err) {
          console.error('Browser did not support generating ec key ' + err.message);
          break;
        }
      case 'curve25519': {
        const privateKey = getRandomBytes(32);
        privateKey[0] = (privateKey[0] & 127) | 64;
        privateKey[31] &= 248;
        const secretKey = privateKey.slice().reverse();
        keyPair = nacl.box.keyPair.fromSecretKey(secretKey);
        const publicKey = util.concatUint8Array([new Uint8Array([0x40]), keyPair.publicKey]);
        return { publicKey, privateKey };
      }
      case 'ed25519': {
        const privateKey = getRandomBytes(32);
        const keyPair = nacl.sign.keyPair.fromSeed(privateKey);
        const publicKey = util.concatUint8Array([new Uint8Array([0x40]), keyPair.publicKey]);
        return { publicKey, privateKey };
      }
    }
    const indutnyCurve = await getIndutnyCurve(this.name);
    keyPair = await indutnyCurve.genKeyPair({
      entropy: util.uint8ArrayToString(getRandomBytes(32))
    });
    return { publicKey: new Uint8Array(keyPair.getPublic('array', false)), privateKey: keyPair.getPrivate().toArrayLike(Uint8Array) };
  }
}

async function generate(curve) {
  const BigInteger = await util.getBigInteger();

  curve = new CurveWithOID(curve);
  const keyPair = await curve.genKeyPair();
  const Q = new BigInteger(keyPair.publicKey).toUint8Array();
  const secret = new BigInteger(keyPair.privateKey).toUint8Array('be', curve.payloadSize);
  return {
    oid: curve.oid,
    Q,
    secret,
    hash: curve.hash,
    cipher: curve.cipher
  };
}

/**
 * Get preferred hash algo to use with the given curve
 * @param {module:type/oid} oid - curve oid
 * @returns {enums.hash} hash algorithm
 */
function getPreferredHashAlgo(oid) {
  return curves[enums.write(enums.curve, oid.toHex())].hash;
}

/**
 * Validate ECDH and ECDSA parameters
 * Not suitable for EdDSA (different secret key format)
 * @param {module:enums.publicKey} algo - EC algorithm, to filter supported curves
 * @param {module:type/oid} oid - EC object identifier
 * @param {Uint8Array} Q - EC public point
 * @param {Uint8Array} d - EC secret scalar
 * @returns {Promise<Boolean>} Whether params are valid.
 * @async
 */
async function validateStandardParams(algo, oid, Q, d) {
  const supportedCurves = {
    p256: true,
    p384: true,
    p521: true,
    secp256k1: true,
    curve25519: algo === enums.publicKey.ecdh,
    brainpoolP256r1: true,
    brainpoolP384r1: true,
    brainpoolP512r1: true
  };

  // Check whether the given curve is supported
  const curveName = oid.getName();
  if (!supportedCurves[curveName]) {
    return false;
  }

  if (curveName === 'curve25519') {
    d = d.slice().reverse();
    // Re-derive public point Q'
    const { publicKey } = nacl.box.keyPair.fromSecretKey(d);

    Q = new Uint8Array(Q);
    const dG = new Uint8Array([0x40, ...publicKey]); // Add public key prefix
    if (!util.equalsUint8Array(dG, Q)) {
      return false;
    }

    return true;
  }

  const curve = await getIndutnyCurve(curveName);
  try {
    // Parse Q and check that it is on the curve but not at infinity
    Q = keyFromPublic(curve, Q).getPublic();
  } catch (validationErrors) {
    return false;
  }

  /**
   * Re-derive public point Q' = dG from private key
   * Expect Q == Q'
   */
  const dG = keyFromPrivate(curve, d).getPublic();
  if (!dG.eq(Q)) {
    return false;
  }

  return true;
}

export {
  CurveWithOID, curves, webCurves, generate, getPreferredHashAlgo, jwkToRawPublic, rawPublicToJWK, privateToJWK, validateStandardParams
};

//////////////////////////
//                      //
//   Helper functions   //
//                      //
//////////////////////////


async function webGenKeyPair(name) {
  // Note: keys generated with ECDSA and ECDH are structurally equivalent
  const webCryptoKey = await webCrypto.generateKey({ name: 'ECDSA', namedCurve: webCurves[name] }, true, ['sign', 'verify']);

  const privateKey = await webCrypto.exportKey('jwk', webCryptoKey.privateKey);
  const publicKey = await webCrypto.exportKey('jwk', webCryptoKey.publicKey);

  return {
    publicKey: jwkToRawPublic(publicKey),
    privateKey: b64ToUint8Array(privateKey.d, true)
  };
}

//////////////////////////
//                      //
//   Helper functions   //
//                      //
//////////////////////////

/**
 * @param {JsonWebKey} jwk - key for conversion
 *
 * @returns {Uint8Array} Raw public key.
 */
function jwkToRawPublic(jwk) {
  const bufX = b64ToUint8Array(jwk.x);
  const bufY = b64ToUint8Array(jwk.y);
  const publicKey = new Uint8Array(bufX.length + bufY.length + 1);
  publicKey[0] = 0x04;
  publicKey.set(bufX, 1);
  publicKey.set(bufY, bufX.length + 1);
  return publicKey;
}

/**
 * @param {Integer} payloadSize - ec payload size
 * @param {String} name - curve name
 * @param {Uint8Array} publicKey - public key
 *
 * @returns {JsonWebKey} Public key in jwk format.
 */
function rawPublicToJWK(payloadSize, name, publicKey) {
  const len = payloadSize;
  const bufX = publicKey.slice(1, len + 1);
  const bufY = publicKey.slice(len + 1, len * 2 + 1);
  // https://www.rfc-editor.org/rfc/rfc7518.txt
  const jwk = {
    kty: 'EC',
    crv: name,
    x: uint8ArrayToB64(bufX, true),
    y: uint8ArrayToB64(bufY, true),
    ext: true
  };
  return jwk;
}

/**
 * @param {Integer} payloadSize - ec payload size
 * @param {String} name - curve name
 * @param {Uint8Array} publicKey - public key
 * @param {Uint8Array} privateKey - private key
 *
 * @returns {JsonWebKey} Private key in jwk format.
 */
function privateToJWK(payloadSize, name, publicKey, privateKey) {
  const jwk = rawPublicToJWK(payloadSize, name, publicKey);
  jwk.d = uint8ArrayToB64(privateKey, true);
  return jwk;
}
