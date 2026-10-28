export { Agent, type ServerRequestLike, type ServerResponseLike } from './agent.js';
export { type AgentConfig, ENV, readConfig } from './config.js';
export { InspectorSession, type ParsedScript } from './inspector.js';
export { type RunningAgent, startAgent } from './start.js';
export { Transport } from './transport.js';

/** File URL of the `--import` entry point, for building NODE_OPTIONS. */
export const registerUrl: string = new URL('./register.js', import.meta.url).href;
