import { Client } from './deps.ts'

export type ClientExecutionResult =
// there was another | here, replace if problems
      {
      client: Client;
      vote: "for";
      value: number;
    }
  | {
      client: Client;
      vote: "against";
      error: Error;
    };

/*
 * This object contains a summary of results.
 */
export type ExecutionStats = {
  readonly membershipSize: number;
  readonly quorumSize: number;
  readonly votesFor: Set<Client>;
  readonly votesAgainst: Map<Client, Error>;
};

/*
 * This object contains a summary of results. Because the result of an attempt
 * can sometimes be determined before all requests are finished, each attempt
 * contains a Promise that will resolve ExecutionStats once all requests are
 * finished. A rejection of these promises should be considered undefined
 * behavior and should cause a crash.
 */
export type ExecutionResult = {
  attempts: ReadonlyArray<Promise<ExecutionStats>>;
};

/**
 *
 */
export interface Settings {
  readonly driftFactor: number;
  readonly retryCount: number;
  readonly retryDelay: number;
  readonly retryJitter: number;
  readonly automaticExtensionThreshold: number;
}

// Redlock abort signal type definition
export type RedlockAbortSignal = AbortSignal & { error?: Error };