#!/usr/bin/env python3
"""
A heartbeat with each of a LayerTwo-family chain's nodes (Thunder: QUIC streams of magic || bincode, thunder-rust
lib/net/peer/message.rs; Backbone's bt/sidechain/p2p.h and bt/quic.h), for the explorer's nodes crawler
(backend/src/chain/nodes.ts): Node has no QUIC client.

stdin: {"magic": "85189505", "version": [0, 19, 1], "targets": [["ip", port], ...], "concurrency": 32, "timeout": 10}
stdout: a JSON line per node that answered: {"ip", "port", "latency" (ms, the QUIC handshake), "cn" (its certificate's
subject CN: a Backbone drop-in names itself there, upstream's is rcgen's default), "height" (null: no tip yet),
"version": [major, minor, patch]}

QUIC v1, TLS 1.3, no ALPN, the server's self-signed certificate not verified (as quinn's clients do). Each node's
answer is read to READ_LIMIT bytes at most.
"""
import asyncio
import json
import ssl
import struct
import sys
import time

from aioquic.asyncio import connect
from aioquic.asyncio.protocol import QuicConnectionProtocol
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import StreamDataReceived
from cryptography.x509.oid import NameOID

READ_LIMIT = 4096  # a heartbeat is under 200 bytes


class Peer(QuicConnectionProtocol):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.bufs = {}
        self.heartbeat = asyncio.get_running_loop().create_future()

    def quic_event_received(self, e):
        if isinstance(e, StreamDataReceived) and not self.heartbeat.done():
            b = self.bufs.get(e.stream_id, b'') + e.data
            if len(b) > READ_LIMIT:
                self.heartbeat.set_exception(ValueError('too long'))
                return
            self.bufs[e.stream_id] = b
            if e.end_stream and len(b) > 4:  # (our own stream's answer is empty)
                self.heartbeat.set_result(b)


def heartbeat(magic, version):
    # RequestMessage::Heartbeat (u32 0), PeerState { tip_info: None, version }
    return magic + struct.pack('<IB3Q', 0, 0, *version)


def decode(magic, b):
    if b[:4] != magic:
        raise ValueError('another network')
    tag, opt = struct.unpack_from('<IB', b, 4)
    if tag != 0:
        raise ValueError('not a heartbeat')
    o, height = 9, None
    if opt == 1:
        height, = struct.unpack_from('<I', b, o)
        o += 4 + 32  # block_height, block_hash
        for _ in range(2):  # main_block_hash, total_work: bincode bytes (u64 length)
            n, = struct.unpack_from('<Q', b, o)
            o += 8 + n
    elif opt != 0:
        raise ValueError('bad option')
    return height, list(struct.unpack_from('<3Q', b, o))


async def probe(ip, port, magic, version, timeout):
    cfg = QuicConfiguration(is_client=True, verify_mode=ssl.CERT_NONE, server_name='localhost')
    t0 = time.monotonic()
    async with connect(ip, port, configuration=cfg, create_protocol=Peer, wait_connected=True) as p:
        latency = round((time.monotonic() - t0) * 1000)
        cn = None
        try:
            cn = p._quic.tls._peer_certificate.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value
        except Exception:
            pass
        sid = p._quic.get_next_available_stream_id()
        p._quic.send_stream_data(sid, heartbeat(magic, version), end_stream=True)
        p.transmit()
        height, ver = decode(magic, await asyncio.wait_for(p.heartbeat, timeout))
        return {'ip': ip, 'port': port, 'latency': latency, 'cn': cn, 'height': height, 'version': ver}


async def main():
    asyncio.get_running_loop().set_exception_handler(lambda loop, ctx: None)  # (a refused connection's leftovers)
    req = json.load(sys.stdin)
    magic = bytes.fromhex(req['magic'])
    version = req['version']
    timeout = req.get('timeout', 10)
    sem = asyncio.Semaphore(req.get('concurrency', 32))

    async def one(ip, port):
        async with sem:
            try:
                r = await asyncio.wait_for(probe(ip, port, magic, version, timeout), timeout)
            except BaseException:
                return
            print(json.dumps(r), flush=True)

    await asyncio.gather(*(one(ip, int(port)) for ip, port in req['targets']))


if __name__ == '__main__':
    asyncio.run(main())
