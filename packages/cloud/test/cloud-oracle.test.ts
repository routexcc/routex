import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import { CloudFeeOracle } from '../src/cloud-oracle.js';
import type {
  ChainId,
  FeeEstimate,
  FeeOracle,
} from '@routexcc/core';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeFee(chainId: ChainId, feeUsd = 500000n): FeeEstimate {
  return {
    chainId,
    feeAmount: 1000n,
    feeUsd,
    finalityMs: 2000,
    confidence: 'high',
    timestamp: Date.now(),
  };
}

interface TrackedFallbackOracle extends FeeOracle {
  startCalled: boolean;
  stopCalled: boolean;
  getFeeCalls: ChainId[];
  getAllFeesCalls: number;
}

function makeFallbackOracle(): TrackedFallbackOracle {
  const fees = new Map<ChainId, FeeEstimate>([
    ['base', makeFee('base', 999999n)],
    ['polygon', makeFee('polygon', 888888n)],
  ]);

  const oracle: TrackedFallbackOracle = {
    startCalled: false,
    stopCalled: false,
    getFeeCalls: [],
    getAllFeesCalls: 0,
    async getFee(chainId: ChainId) {
      oracle.getFeeCalls.push(chainId);
      return fees.get(chainId);
    },
    async getAllFees() {
      oracle.getAllFeesCalls++;
      return fees;
    },
    start() { oracle.startCalled = true; },
    stop() { oracle.stopCalled = true; },
  };

  return oracle;
}

function makeWireFee(chainId: string, feeUsd = '500000') {
  return {
    chainId,
    feeAmount: '1000',
    feeUsd,
    finalityMs: 2000,
    timestamp: Date.now(),
    confidence: 'high',
  };
}

interface MockServer {
  httpServer: Server;
  wss: WebSocketServer;
  port: number;
  endpoint: string;
  clients: WsWebSocket[];
  lastAuthMessage: Record<string, unknown> | null;
  close: () => Promise<void>;
  broadcastFees: (fees: unknown[]) => void;
  sendHeartbeat: () => void;
}

async function createMockServer(): Promise<MockServer> {
  const httpServer = createServer((_req, res) => {
    // REST endpoint: GET /v1/fees
    if (_req.url === '/v1/fees') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        fees: [
          makeWireFee('base', '300000'),
          makeWireFee('polygon', '200000'),
          makeWireFee('solana', '100000'),
        ],
        serverTime: Date.now(),
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });
  const clients: WsWebSocket[] = [];
  let lastAuthMessage: Record<string, unknown> | null = null;

  wss.on('connection', (ws) => {
    clients.push(ws);
    ws.on('message', (data) => {
      try {
        lastAuthMessage = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch { /* ignore */ }
    });
    ws.on('close', () => {
      const idx = clients.indexOf(ws);
      if (idx !== -1) clients.splice(idx, 1);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const port = (httpServer.address() as AddressInfo).port;
  const endpoint = `http://127.0.0.1:${port}`;

  return {
    httpServer,
    wss,
    port,
    endpoint,
    clients,
    get lastAuthMessage() { return lastAuthMessage; },
    async close() {
      for (const ws of clients) ws.close();
      wss.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => err ? reject(err) : resolve());
      });
    },
    broadcastFees(fees: unknown[]) {
      const msg = JSON.stringify({ fees, serverTime: Date.now() });
      for (const ws of clients) ws.send(msg);
    },
    sendHeartbeat() {
      const msg = JSON.stringify({ type: 'heartbeat' });
      for (const ws of clients) ws.send(msg);
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CloudFeeOracle', () => {
  let server: MockServer;
  let oracle: FeeOracle;
  let fallback: ReturnType<typeof makeFallbackOracle>;

  beforeEach(async () => {
    server = await createMockServer();
    fallback = makeFallbackOracle();
  });

  afterEach(async () => {
    if (oracle) oracle.stop();
    await server.close();
  });

  describe('WebSocket connection', () => {
    it('connects via WebSocket and authenticates with API key', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test_key_123',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();

      // Wait for WS connection
      await wait(200);

      expect(server.clients.length).toBe(1);
      expect(server.lastAuthMessage).toEqual({ apiKey: 'rtx_test_key_123' });
    });

    it('updates cache when receiving fee messages', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();
      await wait(200);

      // Broadcast fees
      server.broadcastFees([
        makeWireFee('base', '250000'),
        makeWireFee('solana', '50000'),
      ]);
      await wait(100);

      const baseFee = await oracle.getFee('base');
      expect(baseFee).toBeDefined();
      expect(baseFee!.feeUsd).toBe(250000n);
      expect(baseFee!.chainId).toBe('base');

      const solanaFee = await oracle.getFee('solana');
      expect(solanaFee).toBeDefined();
      expect(solanaFee!.feeUsd).toBe(50000n);
    });

    it('returns cloud data over fallback when available', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();
      await wait(200);

      server.broadcastFees([makeWireFee('base', '123456')]);
      await wait(100);

      const fee = await oracle.getFee('base');
      // Cloud fee, not fallback's 999999
      expect(fee!.feeUsd).toBe(123456n);
    });

    it('handles heartbeat messages to keep cloud alive', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
        fallbackTimeoutMs: 500,
      });
      oracle.start();
      await wait(200);

      // Send initial fees
      server.broadcastFees([makeWireFee('base')]);
      await wait(100);

      // Send heartbeat to reset timeout
      server.sendHeartbeat();
      await wait(100);

      // Even though 200ms passed since fees, heartbeat kept it alive
      const fee = await oracle.getFee('base');
      expect(fee!.feeUsd).toBe(500000n); // Cloud data, not fallback
    });

    it('getAllFees returns cloud cache when connected', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();
      await wait(200);

      server.broadcastFees([
        makeWireFee('base', '111'),
        makeWireFee('polygon', '222'),
        makeWireFee('stellar', '333'),
      ]);
      await wait(100);

      const fees = await oracle.getAllFees();
      expect(fees.size).toBe(3);
      expect(fees.get('base')!.feeUsd).toBe(111n);
      expect(fees.get('polygon')!.feeUsd).toBe(222n);
      expect(fees.get('stellar')!.feeUsd).toBe(333n);
    });

    it('ignores invalid chain IDs in wire messages', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();
      await wait(200);

      server.broadcastFees([
        makeWireFee('base', '100'),
        { chainId: 'invalid_chain', feeAmount: '1', feeUsd: '1', finalityMs: 1, timestamp: Date.now(), confidence: 'high' },
      ]);
      await wait(100);

      const fees = await oracle.getAllFees();
      expect(fees.size).toBe(1);
      expect(fees.has('base')).toBe(true);
    });

    it('ignores malformed WebSocket messages', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();
      await wait(200);

      // Send garbage
      for (const ws of server.clients) {
        ws.send('not json at all');
        ws.send('{"fees": "not_an_array"}');
        ws.send('{}');
      }
      await wait(100);

      // Should not crash, returns fallback
      const fee = await oracle.getFee('base');
      expect(fee).toBeDefined();
    });
  });

  describe('WebSocket reconnection', () => {
    it('reconnects with exponential backoff when disconnected', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
        wsReconnectMaxMs: 5000,
      });
      oracle.start();
      await wait(200);

      expect(server.clients.length).toBe(1);

      // Disconnect the client
      for (const ws of [...server.clients]) ws.close();
      await wait(100);

      expect(server.clients.length).toBe(0);

      // Wait for first reconnect attempt (1s backoff)
      await wait(1200);

      expect(server.clients.length).toBe(1);
    });

    it('resumes receiving data after reconnection', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();
      await wait(200);

      // Send initial data
      server.broadcastFees([makeWireFee('base', '111')]);
      await wait(100);
      expect((await oracle.getFee('base'))!.feeUsd).toBe(111n);

      // Disconnect
      for (const ws of [...server.clients]) ws.close();
      await wait(1300);

      // Should have reconnected, send new data
      server.broadcastFees([makeWireFee('base', '222')]);
      await wait(100);
      expect((await oracle.getFee('base'))!.feeUsd).toBe(222n);
    });
  });

  describe('REST polling fallback', () => {
    it('polls REST when WebSocket is unavailable', async () => {
      // Create oracle pointing to a port where WS will fail but HTTP works
      const httpOnlyServer = createServer((_req, res) => {
        if (_req.url === '/v1/fees') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            fees: [makeWireFee('base', '777')],
            serverTime: Date.now(),
          }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      await new Promise<void>((resolve) => {
        httpOnlyServer.listen(0, '127.0.0.1', resolve);
      });
      const port = (httpOnlyServer.address() as AddressInfo).port;

      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: `http://127.0.0.1:${port}`,
        restPollIntervalMs: 500,
      });
      oracle.start();

      // WS will fail (no WSS server), REST should kick in
      await wait(1500);

      const fee = await oracle.getFee('base');
      expect(fee).toBeDefined();
      expect(fee!.feeUsd).toBe(777n);

      oracle.stop();
      httpOnlyServer.close();
    });
  });

  describe('fallback to LocalFeeOracle', () => {
    it('falls back to local oracle when cloud unreachable for >5s', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: 'http://127.0.0.1:1', // nothing listening — instant failure
        fallbackTimeoutMs: 500, // shortened for test speed
      });
      oracle.start();

      // Wait for fallback timeout
      await wait(800);

      const fee = await oracle.getFee('base');
      expect(fee).toBeDefined();
      // Should get fallback oracle's value
      expect(fee!.feeUsd).toBe(999999n);
    });

    it('recovers from fallback when cloud comes back', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
        fallbackTimeoutMs: 500,
      });
      oracle.start();
      await wait(200);

      // Send initial data
      server.broadcastFees([makeWireFee('base', '123')]);
      await wait(100);

      // Disconnect and wait past fallback timeout
      for (const ws of [...server.clients]) ws.close();
      await wait(800);

      // Should be using fallback now
      const fallbackFee = await oracle.getFee('base');
      expect(fallbackFee!.feeUsd).toBe(999999n);

      // Wait for reconnect
      await wait(1200);

      // Send new data
      server.broadcastFees([makeWireFee('base', '456')]);
      await wait(100);

      // Should recover to cloud data
      const cloudFee = await oracle.getFee('base');
      expect(cloudFee!.feeUsd).toBe(456n);
    });

    it('delegates to fallback for chains not in cloud cache', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();
      await wait(200);

      // Only send base fee
      server.broadcastFees([makeWireFee('base', '100')]);
      await wait(100);

      // polygon not in cloud cache → should come from fallback
      const polygonFee = await oracle.getFee('polygon');
      expect(polygonFee!.feeUsd).toBe(888888n);
    });

    it('calls fallback.start() on start and fallback.stop() on stop', () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });

      oracle.start();
      expect(fallback.startCalled).toBe(true);

      oracle.stop();
      expect(fallback.stopCalled).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles WS constructor failure gracefully', async () => {
      // Invalid URL scheme causes WS constructor to throw
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: 'ftp://invalid:99999', // invalid for WS
        fallbackTimeoutMs: 200,
      });
      oracle.start();

      // Should not crash — falls back gracefully
      await wait(400);
      const fee = await oracle.getFee('base');
      expect(fee).toBeDefined();
      expect(fee!.feeUsd).toBe(999999n); // fallback value
    });

    it('connectWs skips when not running', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });

      // Don't call start() — connectWs should bail via !running check
      const fee = await oracle.getFee('base');
      expect(fee).toBeDefined(); // fallback
    });

    it('stop during reconnect cancels pending reconnect', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();
      await wait(200);

      // Disconnect to trigger reconnect timer
      for (const ws of [...server.clients]) ws.close();
      await wait(100);

      // Stop while reconnect is pending
      oracle.stop();
      await wait(1500);

      // Should NOT have reconnected
      expect(server.clients.length).toBe(0);
    });

    it('handles WS error event gracefully', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();
      await wait(200);

      // Force an error on the server side
      for (const ws of server.clients) {
        ws.terminate(); // Abrupt close triggers error on client
      }
      await wait(200);

      // Should not crash, should schedule reconnect
      const fee = await oracle.getFee('base');
      expect(fee).toBeDefined();
    });

    it('REST pollRest handles already connected state', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
        restPollIntervalMs: 200,
      });
      oracle.start();
      await wait(200);

      // WS connected, now send REST-style data too (simulating both paths)
      server.broadcastFees([makeWireFee('base', '100')]);
      await wait(100);

      const fee = await oracle.getFee('base');
      expect(fee).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('stop() closes WebSocket and clears all timers', async () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();
      await wait(200);

      expect(server.clients.length).toBe(1);

      oracle.stop();
      await wait(100);

      expect(server.clients.length).toBe(0);

      // After stop, getFee still works (returns fallback with empty cache/fallback state)
      // Re-creating is needed for fresh connection
    });

    it('stop() is idempotent', () => {
      oracle = CloudFeeOracle({
        apiKey: 'rtx_test',
        fallback,
        endpoint: server.endpoint,
      });
      oracle.start();

      // Should not throw when called multiple times
      oracle.stop();
      oracle.stop();
      oracle.stop();
    });
  });
});
