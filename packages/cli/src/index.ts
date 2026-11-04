export {
  CONFIG_FILE,
  ConfigError,
  configJsonSchema,
  LightpathConfig,
  type LoadedConfig,
  loadConfig,
} from './config.js';
export { findLocalUrl, UrlWatcher } from './detect.js';
export { type DevOptions, dev } from './dev.js';
export { type Check, doctor, type SetupCheckOptions, setupChecks } from './doctor.js';
export { agentEnv, nodeVersionProblem, withRequire } from './env.js';
export { formatTrace } from './format.js';
export {
  AGENT_SETUP,
  AGENTS,
  type Agent,
  agentsBlock,
  devCommand,
  genericSnippet,
  INIT_AGENTS,
  type InitAgent,
  type InitOptions,
  init,
  mcpCommand,
  mcpEntry,
} from './init.js';
export { main, VERSION } from './main.js';
export { type ProbeResult, probeMcpCommand, serverToolNames } from './mcp-probe.js';
