import Redlock from "./redlock.ts";
import Lock from "./lock.ts";
import { ACQUIRE_SCRIPT, EXTEND_SCRIPT, RELEASE_SCRIPT } from "./scripts.ts";
import {
  ClientExecutionResult,
  ExecutionResult,
  ExecutionStats,
} from "./types.ts";

export default Redlock;
export { ACQUIRE_SCRIPT, EXTEND_SCRIPT, Lock, RELEASE_SCRIPT };
export type { ClientExecutionResult, ExecutionResult, ExecutionStats };
