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

import { Deflate } from '@openpgp/pako/lib/deflate';
import { Inflate } from '@openpgp/pako/lib/inflate';
import { Z_SYNC_FLUSH, Z_FINISH } from '@openpgp/pako/lib/zlib/constants';
import { decode as BunzipDecode } from '@openpgp/seek-bzip';
import * as stream from '@openpgp/web-stream-tools';
import enums from '../enums';
import util from '../util';
import defaultConfig from '../config';

import LiteralDataPacket from './literal_data';
import OnePassSignaturePacket from './one_pass_signature';
import SignaturePacket from './signature';
import PacketList from './packetlist';

// A Compressed Data packet can contain the following packet types
const allowedPackets = /*#__PURE__*/ util.constructAllowedPackets([
  LiteralDataPacket,
  OnePassSignaturePacket,
  SignaturePacket
]);

/**
 * Implementation of the Compressed Data Packet (Tag 8)
 *
 * {@link https://tools.ietf.org/html/rfc4880#section-5.6|RFC4880 5.6}:
 * The Compressed Data packet contains compressed data.  Typically,
 * this packet is found as the contents of an encrypted packet, or following
 * a Signature or One-Pass Signature packet, and contains a literal data packet.
 */
class CompressedDataPacket {
  static get tag() {
    return enums.packet.compressedData;
  }

  /**
   * @param {Object} [config] - Full configuration, defaults to openpgp.config
   */
  constructor(config = defaultConfig) {
    /**
     * List of packets
     * @type {PacketList}
     */
    this.packets = null;
    /**
     * Compression algorithm
     * @type {enums.compression}
     */
    this.algorithm = config.preferredCompressionAlgorithm;

    /**
     * Compressed packet data
     * @type {Uint8Array | ReadableStream<Uint8Array>}
     */
    this.compressed = null;

    /**
     * zip/zlib compression level, between 1 and 9
     */
    this.deflateLevel = config.deflateLevel;
  }

  /**
   * Parsing function for the packet.
   * @param {Uint8Array | ReadableStream<Uint8Array>} bytes - Payload of a tag 8 packet
   * @param {Object} [config] - Full configuration, defaults to openpgp.config
   */
  async read(bytes, config = defaultConfig) {
    await stream.parse(bytes, async reader => {

      // One octet that gives the algorithm used to compress the packet.
      this.algorithm = await reader.readByte();

      // Compressed data, which makes up the remainder of the packet.
      this.compressed = reader.remainder();

      await this.decompress(config);
    });
  }


  /**
   * Return the compressed packet.
   * @returns {Uint8Array | ReadableStream<Uint8Array>} Binary compressed packet.
   */
  write() {
    if (this.compressed === null) {
      this.compress();
    }

    return util.concat([new Uint8Array([this.algorithm]), this.compressed]);
  }


  /**
   * Decompression method for decompressing the compressed data
   * read by read_packet
   * @param {Object} [config] - Full configuration, defaults to openpgp.config
   */
  async decompress(config = defaultConfig) {
    const compressionName = enums.read(enums.compression, this.algorithm);
    const decompressionFn = decompress_fns[compressionName];
    if (!decompressionFn) {
      throw new Error(`${compressionName} decompression not supported`);
    }

    this.packets = await PacketList.fromBinary(decompressionFn(this.compressed), allowedPackets, config);
  }

  /**
   * Compress the packet data (member decompressedData)
   */
  compress() {
    const compressionName = enums.read(enums.compression, this.algorithm);
    const compressionFn = compress_fns[compressionName];
    if (!compressionFn) {
      throw new Error(`${compressionName} compression not supported`);
    }

    this.compressed = compressionFn(this.packets.write(), this.deflateLevel);
  }
}

export default CompressedDataPacket;

//////////////////////////
//                      //
//   Helper functions   //
//                      //
//////////////////////////


function uncompressed(data) {
  return data;
}

function pako_zlib(constructor, options = {}) {
  return function(data) {
    const obj = new constructor(options);
    return stream.transform(data, value => {
      if (value.length) {
        obj.push(value, Z_SYNC_FLUSH);
        return obj.result;
      }
    }, () => {
      if (constructor === Deflate) {
        obj.push([], Z_FINISH);
        return obj.result;
      }
    });
  };
}

function bzip2(func) {
  return function(data) {
    return stream.fromAsync(async () => func(await stream.readToEnd(data)));
  };
}

const compress_fns = {
  zip: /*#__PURE__*/ (compressed, level) => pako_zlib(Deflate, { raw: true, level })(compressed),
  zlib: /*#__PURE__*/ (compressed, level) => pako_zlib(Deflate, { level })(compressed)
};

const decompress_fns = {
  uncompressed: uncompressed,
  zip: /*#__PURE__*/ pako_zlib(Inflate, { raw: true }),
  zlib: /*#__PURE__*/ pako_zlib(Inflate),
  bzip2: /*#__PURE__*/ bzip2(BunzipDecode)
};

