import { bounded, loadTraccarConfig, type TraccarConfig } from './traccar-config.js';

export interface BridgeConfig {
  traccar: TraccarConfig;
  socketUrl: string;
  /** Loopback-only health listener; 0 disables it. */
  healthPort: number;
  connectTimeoutMs: number;
  /** Traccar 6.16 sends a `{}` keepalive every 55 s; silence beyond this forces reconnect. */
  silenceTimeoutMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  /** A connection must stay RUNNING this long before the backoff counter resets. */
  stableResetMs: number;
  shutdownTimeoutMs: number;
  maxFrameBytes: number;
  maxFrameItems: number;
  maxQueuedFrames: number;
  futureToleranceMs: number;
}

// Operational settings only; these are not route-compliance or commuter-availability thresholds.
export function loadBridgeConfig(source: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const traccar = loadTraccarConfig(source);
  const config = {
    traccar,
    socketUrl: `${traccar.baseUrl.replace(/^http/, 'ws')}/api/socket`,
    healthPort: bounded(source, 'BRIDGE_HEALTH_PORT', 0, 0, 65_535),
    connectTimeoutMs: bounded(source, 'BRIDGE_CONNECT_TIMEOUT_MS', 5_000, 100, 60_000),
    silenceTimeoutMs: bounded(source, 'BRIDGE_SILENCE_TIMEOUT_MS', 120_000, 1_000, 600_000),
    reconnectBaseMs: bounded(source, 'BRIDGE_RECONNECT_BASE_MS', 1_000, 1, 60_000),
    reconnectMaxMs: bounded(source, 'BRIDGE_RECONNECT_MAX_MS', 30_000, 1, 600_000),
    stableResetMs: bounded(source, 'BRIDGE_STABLE_RESET_MS', 60_000, 0, 3_600_000),
    shutdownTimeoutMs: bounded(source, 'BRIDGE_SHUTDOWN_TIMEOUT_MS', 10_000, 100, 120_000),
    maxFrameBytes: bounded(source, 'BRIDGE_MAX_FRAME_BYTES', 1_048_576, 1_024, 16_777_216),
    maxFrameItems: bounded(source, 'BRIDGE_MAX_FRAME_ITEMS', 1_000, 1, 100_000),
    maxQueuedFrames: bounded(source, 'BRIDGE_MAX_QUEUED_FRAMES', 1_000, 1, 100_000),
    futureToleranceMs: bounded(source, 'BRIDGE_FUTURE_TOLERANCE_MS', 5_000, 0, 60_000),
  };
  if (config.reconnectMaxMs < config.reconnectBaseMs) throw new Error('Bridge reconnect maximum must cover base delay');
  return config;
}
