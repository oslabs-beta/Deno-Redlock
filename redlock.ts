// deno-lint-ignore-file
import { EventEmitter, connect, Client, randomBytes, RedisValue } from './deps.ts';
import { ACQUIRE_SCRIPT, EXTEND_SCRIPT, RELEASE_SCRIPT } from './scripts.ts';
import { ClientExecutionResult, ExecutionStats, ExecutionResult, Settings, RedlockAbortSignal, } from './types.ts';
import { ResourceLockedError, ExecutionError } from './errors.ts'
import { Lock } from './lock.ts';
import { SHA1 } from './crypto.ts';

// Define default settings.
const defaultSettings: Readonly<Settings> = {
  driftFactor: 0.01,
  retryCount: 10,
  retryDelay: 200,
  retryJitter: 100,
  automaticExtensionThreshold: 500,
};

// Modifyng this object is forbidden.
Object.freeze(defaultSettings);

/**
 * A redlock object is instantiated with an array of at least one redis client
 * and an optional `options` object. Properties of the Redlock object should NOT
 * be changed after it is first used, as doing so could have unintended
 * consequences for live locks.
 */
export default class Redlock extends EventEmitter {
  // clients set is 
  public readonly clients: Set<Client>;
  public readonly settings: Settings;
  public readonly scripts: {
    readonly acquireScript: { value: string; hash: string };
    readonly extendScript: { value: string; hash: string };
    readonly releaseScript: { value: string; hash: string };
  };
  public Ready: Promise<any> ;

  public constructor(
    clientOrCluster: Client,
    settings: Partial<Settings> = {},
    scripts: {
      readonly acquireScript?: string | ((script: string) => string);
      readonly extendScript?: string | ((script: string) => string);
      readonly releaseScript?: string | ((script: string) => string);
    } = {}
  ) {
    super();

    if (!clientOrCluster) {
      throw new Error(
        "Redlock must be instantiated with at least one redis client."
      );
    }

    // Prevent crashes on error events.
    this.on("error", () => {
      // Because redlock is designed for high availability, it does not care if
      // a minority of redis instances/clusters fail at an operation.
      //
      // However, it can be helpful to monitor and log such cases. Redlock emits
      // an "error" event whenever it encounters an error, even if the error is
      // ignored in its normal operation.
      //
      // This function serves to prevent node's default behavior of crashing
      // when an "error" event is emitted in the absence of listeners.
    });

    // Customize the settings for this instance. Use default settings or user provided settings
    this.settings = {
      driftFactor:
        typeof settings.driftFactor === "number"
          ? settings.driftFactor
          : defaultSettings.driftFactor,
      retryCount:
        typeof settings.retryCount === "number"
          ? settings.retryCount
          : defaultSettings.retryCount,
      retryDelay:
        typeof settings.retryDelay === "number"
          ? settings.retryDelay
          : defaultSettings.retryDelay,
      retryJitter:
        typeof settings.retryJitter === "number"
          ? settings.retryJitter
          : defaultSettings.retryJitter,
      automaticExtensionThreshold:
        typeof settings.automaticExtensionThreshold === "number"
          ? settings.automaticExtensionThreshold
          : defaultSettings.automaticExtensionThreshold,
    };

    // Use custom scripts and script modifiers.
    const acquireScript =
      typeof scripts.acquireScript === "function"
        ? scripts.acquireScript(ACQUIRE_SCRIPT)
        : ACQUIRE_SCRIPT;
    const extendScript =
      typeof scripts.extendScript === "function"
        ? scripts.extendScript(EXTEND_SCRIPT)
        : EXTEND_SCRIPT;
    const releaseScript =
      typeof scripts.releaseScript === "function"
        ? scripts.releaseScript(RELEASE_SCRIPT)
        : RELEASE_SCRIPT;

    // set script value and hashed sha1 digest of script values
    // the value will be used in initial EVAL call to Redis instances
    // the hashed values will be called in subsequent EVALSHA calls to Redis instances
    this.scripts = {
      acquireScript: {
        value: acquireScript,
        hash: SHA1(acquireScript),
      },
      extendScript: {
        value: extendScript,
        hash: SHA1(extendScript),
      },
      releaseScript: {
        value: releaseScript,
        hash: SHA1(releaseScript),
      },
    };
    console.log("1", clientOrCluster);
    // add all redis cluster instances/single client to clients set

    // add all redis cluster instances/single client to clients set
    // console.log('2 creating a new Set');
    // this.clients = new Set();
    // console.log('3 calling _getClientConnections');
    // Promise.resolve(this._getClientConnections(clientOrCluster));
    this.clients = new Set();
    this.Ready = new Promise((resolve) => {
      console.log('5 calling client.clusterNodes()');
      clientOrCluster.clusterNodes()
        .then(nodes => {
          console.log("found cluster nodes in _getClientConnections")
          const nodeInfoArr = nodes.replace(/\n|@|:/g, " ").split(" ");
          console.log(nodeInfoArr);
          const clientArray = [];
          for (let i = 0; i < nodeInfoArr.length; i++) {
              if (nodeInfoArr[i] === "connected") {
                  console.log('in the for-loop of _getClientConnections');
                  clientArray.push([nodeInfoArr[i-8], nodeInfoArr[i-7]]);
              }
          }
          //   console.log(clientArray)
          // const connectInfoArray: string[][] = await this._getNodeConnectInfoFromCluster(client);
          // console.log('back in _getClientConnections, after finishing _getNodeConnectInfoFromCluster');
          console.log(clientArray);
          for (const [host, port] of clientArray) {
            connect({hostname: host, port: Number(port)})
              .then(client => {            
                this.clients.add(client);
              })
          }
          console.log('this.clients set: ', this.clients);
          console.log('leaving the try block of _getClientConnections function');
          resolve(undefined)
        })
        .catch(error => {
          console.log('in the catch block of this.Ready, error: ', error);
          this.clients.add(clientOrCluster);
          console.log('this.clients set: ', this.clients);
          resolve(undefined);
          })
      });
      // if error due to client not being a cluster, add single client instance to this.this.clients
      // catch (error) {
      //   console.log('in the catch block of _getClientConnections function, error: ', error);
      //   this.clients.add(clientOrCluster);
      //   console.log('this.clients set: ', this.clients);
      //   // const nodeInfo = await clientOrCluster.info("server");
      //   // console.log(nodeInfo);
}     // }
  

  /**
   * If constructed with a clustered redis instance,
   * this method establishes the redlock instance's connection to each redis client of the cluster
   */
//   private async _getClientConnections(client: Client): Promise<void> {
//       console.log('4 in _getClientConnections function');
//     try {
//       console.log('5 calling client.clusterNodes()');
//       const nodes = await client.clusterNodes();
//       console.log("found cluster nodes in _getClientConnections")
//       const nodeInfoArr = nodes.replace(/\n|@|:/g, " ").split(" ");
//       console.log(nodeInfoArr);
//       const clientArray = [];
//       for (let i = 0; i < nodeInfoArr.length; i++) {
//           if (nodeInfoArr[i] === "connected") {
//               console.log('in the for-loop of _getClientConnections');
//               clientArray.push([nodeInfoArr[i-8], nodeInfoArr[i-7]]);
//           }
//       }
//       //   console.log(clientArray)
//       // const connectInfoArray: string[][] = await this._getNodeConnectInfoFromCluster(client);
//       // console.log('back in _getClientConnections, after finishing _getNodeConnectInfoFromCluster');
//       console.log(clientArray);
//       for (const [host, port] of clientArray) {
//         const client: Client = await connect({hostname: host, port: Number(port)});
//         this.clients.add(client);
//       }
//       console.log('this.clients set: ', this.clients);
//       console.log('leaving the try block of _getClientConnections function');
//     }
//     // if error due to client not being a cluster, add single client instance to this.this.clients
//     catch (error) {
//       console.log('in the catch block of _getClientConnections function, error: ', error);
//       this.clients.add(client);
//       console.log('this.clients set: ', this.clients);
//       const nodeInfo = await client.info("server");
//       console.log(nodeInfo);
//       // await this.acquire(["bdc4076d8604a493c324292b57ed3c3f00797f8d"], 5000, {
//       //   // The expected clock drift; for more details see:
//       //   // http://redis.io/topics/distlock
//       //   driftFactor: 0.01, // multiplied by lock ttl to determine drift time
    
//       //   // The max number of times Redlock will attempt to lock a resource
//       //   // before erroring.
//       //   retryCount: 10,
    
//       //   // the time in ms between attempts
//       //   retryDelay: 200, // time in ms
    
//       //   // the max time in ms randomly added to retries
//       //   // to improve performance under high contention
//       //   // see https://www.awsarchitectureblog.com/2015/03/backoff.html
//       //   retryJitter: 200, // time in ms
    
//       //   // The minimum remaining time on a lock before an extension is automatically
//       //   // attempted with the `using` API.
//       //   automaticExtensionThreshold: 500, // time in ms
//       // });
//     }
//  }

  /**
   * This method pulls hostname and port out of cluster connection info, returns error if client is not a cluster
  */
  //  private async _getNodeConnectInfoFromCluster(client: Client) {
  //      console.log('in the _getNodeConnectInfoFromCluster function');
  //       const nodes = await client.clusterNodes();
  //       console.log("found cluster nodes in _getNodeConnectInfoFromCluster")
  //       const nodeInfoArr = nodes.replace(/\n|@|:/g, " ").split(" ");
  //       console.log(nodeInfoArr);
  //       const clientArray = [];
  //       for (let i = 0; i < nodeInfoArr.length; i++) {
  //           if (nodeInfoArr[i] === "connected") {
  //               console.log('in the for-loop of _getNodeConnectInfoFromCluster');
  //               clientArray.push([nodeInfoArr[i-8], nodeInfoArr[i-7]]);
  //           }
  //       }
  //       console.log(clientArray);
  //       console.log('leaving the _getNodeConnectInfoFromCluster function');
  //       return clientArray;
  // }

  /**
   * Generate a cryptographically random string which will be lock value
   */
  private _random(): string {
    return randomBytes(16).toString("hex");
  }

  /**
   * This method runs `.quit()` on all client connections.
   */
   public async quit(): Promise<void> {
    const results = [];
    console.log('in the quit function');
    for (const client of this.clients) {
      results.push(client.quit());
    }
    await Promise.all(results);
  }

  /**
   * This method acquires a locks on the resources for the duration specified by the `duration` setting
   */
   public async acquire(
    resources: string[],
    duration: number,
    settings?: Partial<Settings>
  ): Promise<Lock> {
    if (Math.floor(duration) !== duration) {
      throw new Error("Duration must be an integer value in milliseconds.");
    }
    // wait for all client connections to be populated
    await this.Ready;
    console.log('clients when first calling acquire after awaiting ready: ', this.clients)
    console.log('in the acquire function');
    const start = performance.now();
    console.log('start --> ', start);
    const value = this._random();
    console.log('value: --> ', value);
    console.log('arguments passed to this._execute: this.scripts.acquireScript --> ', this.scripts.acquireScript);
    console.log('resources --> ', resources);
    console.log('array of value and duration --> ', [value, duration]);
    try {
      const { attempts } = await this._execute(
        this.scripts.acquireScript,
        resources,
        [value, duration],
        settings
      );
      console.log('back in acquire');
      // Add 2 milliseconds to the drift to account for Redis expires precision,
      // which is 1 ms, plus the configured allowable drift factor.
      const drift =
        Math.round(
          (settings?.driftFactor ?? this.settings.driftFactor) * duration
        ) + 2;
        console.log('right before the return statement for the acquire function');

      const newLock = new Lock(
        this,
        resources,
        value,
        attempts,
        start + duration - drift
      );
      console.log(newLock);
      return newLock;
    } catch (error) {
      // If there was an error acquiring the lock, release any partial lock
      // state that may exist on a minority of clients.
      console.log('in the catch block of the acquire function');
      await this._execute(this.scripts.releaseScript, resources, [value], {
        retryCount: 0,
      }).catch(() => {
        // Any error here will be ignored.
      });

      throw error;
    }
  }
  /**
 * This method unlocks the provided lock from all servers still persisting it.
 * It will fail with an error if it is unable to release the lock on a quorum
 * of nodes, but will make no attempt to restore the lock in the case of a
 * failure to release. It is safe to re-attempt a release or to ignore the
 * error, as the lock will automatically expire after its timeout.
 */
  public release(
    lock: Lock,
    settings?: Partial<Settings>
  ): Promise<ExecutionResult> {
    // Immediately invalidate the lock.
    lock.expiration = 0;
    console.log('in the release function');

    // Attempt to release the lock.
    return this._execute(
      this.scripts.releaseScript,
      lock.resources,
      [lock.value],
      settings
    );
  }

  /**
   * This method extends a valid lock by the provided `duration`.
   */
  public async extend(
    existing: Lock,
    duration: number,
    settings?: Partial<Settings>
  ): Promise<Lock> {
    if (Math.floor(duration) !== duration) {
      throw new Error("Duration must be an integer value in milliseconds.");
    }
    console.log('in the extend function');
    const start = performance.now();

    // The lock has already expired.
    if (existing.expiration < performance.now()) {
      throw new ExecutionError("Cannot extend an already-expired lock.", []);
    }

    const { attempts } = await this._execute(
      this.scripts.extendScript,
      existing.resources,
      [existing.value, duration],
      settings
    );

    // Invalidate the existing lock.
    existing.expiration = 0;

    // Add 2 milliseconds to the drift to account for Redis expires precision,
    // which is 1 ms, plus the configured allowable drift factor.
    const drift =
      Math.round(
        (settings?.driftFactor ?? this.settings.driftFactor) * duration
      ) + 2;

    const replacement = new Lock(
      this,
      existing.resources,
      existing.value,
      attempts,
      start + duration - drift
    );

    return replacement;
  }

  private async _execute(
    script: { value: string; hash: string },
    keys: string[],
    args: RedisValue[],
    _settings?: Partial<Settings>
  ): Promise<ExecutionResult> {
      console.log('in the execute function');
    const settings = _settings
      ? {
          ...this.settings,
          ..._settings,
        }
      : this.settings;
      console.log('settings after the ternary operator --> ', settings);

    // For the purpose of easy config serialization, we treat a retryCount of
    // -1 a equivalent to Infinity.
    const maxAttempts =
      settings.retryCount === -1 ? Infinity : settings.retryCount + 1;
    console.log('maxAttempts --> ', maxAttempts);

    const attempts: Promise<ExecutionStats>[] = [];
    while (true) {
        console.log('calling this._attemptOperation in the while loop of this._execute');
      const { vote, stats } = await this._attemptOperation(script, keys, args);
      console.log('STATS ==> ', stats)

      attempts.push(stats);
      console.log('ATTEMPTS ==> ', attempts);

      // The operation achieved a quorum in favor.
      if (vote === "for") {
        return { attempts };
      }

      // Wait before reattempting.
      if (attempts.length < maxAttempts) {
        await new Promise((resolve) => {
          setTimeout(
            resolve,
            Math.max(
              0,
              settings.retryDelay +
                Math.floor((Math.random() * 2 - 1) * settings.retryJitter)
            ),
            undefined
          );
        });
      } else {
        throw new ExecutionError(
          "The operation was unable to achieve a quorum during its retry window.",
          attempts
        );
      }
    }
  }

  private async _attemptOperation(
    script: { value: string; hash: string },
    keys: string[],
    args: RedisValue[],
  ): Promise<
    | { vote: "for"; stats: Promise<ExecutionStats> }
    | { vote: "against"; stats: Promise<ExecutionStats> }
  > {
      console.log('in the attemptOperation function');
    return await new Promise(async (resolve) => {
        console.log('in the return statement for attemptOperation');
      let clientResults:ClientExecutionResult[] = [];
      console.log('this.clients --> ', this.clients);
    //   const clientArray = Array.from(this.clients);
    //   console.log('clientArray --> ', clientArray);
      //this is a problem, this is not iterating over the clients correctly
      for (const client of this.clients) {
           await this._attemptOperationOnClient(client, script, keys, args).then(
               data => {
                   clientResults.push(data);
               }
            );
      }

    // async function f() {
    //     let promise = new Promise((resolve, reject) => {
    //         setTimeout(() => resolve("done!"), 1000)
    //     });
    //     let result = await promise; // wait until the promise resolves (*)
    //     return await result;
    // }
    // const wait = f().then((data) => console.log(data));

    // const clientArr = Array.from(this.clients);
    // console.log('clientArr ==> ', clientArr);
    // console.log('script ==> ', script, ' keys ==> ', keys, ' args ==> ', args);
    // for (let i = 0; i < clientArr.length; i++) {
    //     this._attemptOperationOnClient(clientArr[i], script, keys, args).then((data) => {
    //         clientResults.push(data);
    //     })
    // }
    //   const clientSet = this.clients;
    //   clientSet.forEach(function(item) {
    //       clientResults.push(
    //           this._attemptOperationOnClient(item, script, keys)
    //       );
    //   })
        // const clientSet = this.clients;
        // clientSet.forEach(el => {
        //     clientResults.push(
        //         this.attemptOperationOnClient(el, script, keys, args);
        //     )
        // })
        //const eachOp = await this._attemptOperationOnClient(clientArr[0], script, keys, args);
        // const evalHash = await clientArr[0].evalsha(script.hash, keys, [
        //     ...keys,
        //     ...args,
        //   ]);
        // await console.log('evalHash ==> ', evalHash);
        // clientResults = [];
        // clientResults.push(eachOp);
      await console.log('clientResults after calling this._attemptOperationOnClient on client --> ', clientResults);
      const newPromise = new Promise((resolve, reject) => {
        
      })
      const stats: ExecutionStats = {
        membershipSize: clientResults.length,
        quorumSize: Math.floor(clientResults.length / 2) + 1,
        votesFor: new Set<Client>(),
        votesAgainst: new Map<Client, Error>(),
      };

      let done: () => void;
      const statsPromise = new Promise<typeof stats>((resolve) => {
          console.log('in the statsPromise function');
        done = () => resolve(stats);
      });
      console.log('LINE 397, out of the statsPromise function');
      // This is the expected flow for all successful and unsuccessful requests.
      const onResultResolve = (clientResult: ClientExecutionResult): void => {
          console.log('LINE 400, in the onResultResolve function');
        switch (clientResult.vote) {
          case "for":
              console.log('LINE 403, in the "for" switch statement for onResultResolve');
            stats.votesFor.add(clientResult.client);
            break;
          case "against":
            console.log('in the "against" switch statement for onResultResolve');
            stats.votesAgainst.set(clientResult.client, clientResult.error);
            break;
        }
        console.log('out of the onResultResolve function');
        // A quorum has determined a success.
        console.log('checking votesFor size against quorumSize');
        console.log('votesFor: ', stats.votesFor.size, 'quorumSize', stats.quorumSize);
        if (stats.votesFor.size === stats.quorumSize) {
          resolve({
            vote: "for",
            stats: statsPromise,
          });
        }
        console.log('LINE 421, passed checking votesFor size === quorumSize');
        // A quorum has determined a failure.
        if (stats.votesAgainst.size === stats.quorumSize) {
          resolve({
            vote: "against",
            stats: statsPromise,
          });
        }
        console.log('passed checking votesAgainst size === quorumSize');
        // All votes are in.
        if (
          stats.votesFor.size + stats.votesAgainst.size ===
          stats.membershipSize
        ) {
          done();
        }
      };
      await onResultResolve(clientResults[0]);
      await console.log('votesFor: ', stats.votesFor.size, 'quorumSize', stats.quorumSize);
      await console.log('passed checking votesFor + votesAgainst === membershipSize');
      // This is unexpected and should crash to prevent undefined behavior.
      const onResultReject = (error: Error): void => {
        throw error;
      };
      console.log('passed the function definition of onResultReject');
      // for (const result of clientResults) {
      //     console.log('in the for-loop on  looking at ', result);
      //   result(onResultResolve, onResultReject);
      // }
      //console.log(clientResults);
      console.log('passed the for-loop looping through clientResults');
      console.log('Then somehow it jumps all the way back up to LINE 160 and finishes executing _getNodeConnectInfoFromCluster');
    });
  }

  private async _attemptOperationOnClient(
    client: Client,
    script: { value: string; hash: string },
    keys: string[],
    args: RedisValue[]
  ): Promise<ClientExecutionResult> {
      console.log('in the _attemptOperationOnClient function');
    try {
      let result: number;
      try {
        // Attempt to evaluate the script by its hash.
        // had to change keys.length to keys on next line
        // it threw an error, saying that we can't assign an argument of type number
        // to a type of string[]
        console.log('script.hash ==> ', script.hash, 'keys ==> ', keys, '...keys ==> ', ...keys, '...args ==> ', ...args);
        console.log('HERE');
        const shaResult = (await client.evalsha(script.hash, keys, args)) as unknown;

        if (typeof shaResult !== "number") {
          throw new Error(
            `Unexpected result of type ${typeof shaResult} returned from redis.`
          );
        }

        result = shaResult;
      } catch (error) {
        // If the redis server does not already have the script cached,
        // reattempt the request with the script's raw text.
        if (
          !(error instanceof Error) ||
          // !error.message.startsWith("NOSCRIPT")
          !error.message.startsWith("-NOSCRIPT")
        ) {
          throw error;
        }
        const rawResult = (await client.eval(script.value, keys, args)) as unknown;

        if (typeof rawResult !== "number") {
          throw new Error(
            `Unexpected result of type ${typeof rawResult} returned from redis.`
          );
        }

        result = rawResult;
      }

      // One or more of the resources was already locked.
      if (result !== keys.length) {
        throw new ResourceLockedError(
          `The operation was applied to: ${result} of the ${keys.length} requested resources.`
        );
      }

      return {
        vote: "for",
        client,
        value: result,
      };
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error(
          `Unexpected type ${typeof error} thrown with value: ${error}`
        );
      }

      // Emit the error on the redlock instance for observability.
      this.emit("error", error);
      console.log('final catch block of attemptOperationOnClient');

      return {
        vote: "against",
        client,
        error,
      };
    }
  }

  /**
   * Wrap and execute a routine in the context of an auto-extending lock,
   * returning a promise of the routine's value. In the case that auto-extension
   * fails, an AbortSignal will be updated to indicate that abortion of the
   * routine is in order, and to pass along the encountered error.
   *
   * @example
   * ```ts
   * await redlock.using([senderId, recipientId], 5000, { retryCount: 5 }, async (signal) => {
   *   const senderBalance = await getBalance(senderId);
   *   const recipientBalance = await getBalance(recipientId);
   *
   *   if (senderBalance < amountToSend) {
   *     throw new Error("Insufficient balance.");
   *   }
   *
   *   // The abort signal will be true if:
   *   // 1. the above took long enough that the lock needed to be extended
   *   // 2. redlock was unable to extend the lock
   *   //
   *   // In such a case, exclusivity can no longer be guaranteed for further
   *   // operations, and should be handled as an exceptional case.
   *   if (signal.aborted) {
   *     throw signal.error;
   *   }
   *
   *   await setBalances([
   *     {id: senderId, balance: senderBalance - amountToSend},
   *     {id: recipientId, balance: recipientBalance + amountToSend},
   *   ]);
   * });
   * ```
   */

   public async using<T>(
    resources: string[],
    duration: number,
    settings: Partial<Settings>,
    routine?: (signal: RedlockAbortSignal) => Promise<T>
  ): Promise<T>;

  public async using<T>(
    resources: string[],
    duration: number,
    routine: (signal: RedlockAbortSignal) => Promise<T>
  ): Promise<T>;

  public async using<T>(
    resources: string[],
    duration: number,
    settingsOrRoutine:
      | undefined
      | Partial<Settings>
      | ((signal: RedlockAbortSignal) => Promise<T>),
    optionalRoutine?: (signal: RedlockAbortSignal) => Promise<T>
  ): Promise<T> {
    console.log('in the using function');
    console.log('resouces --> ', resources, ' duration --> ', duration);

    if (Math.floor(duration) !== duration) {
      throw new Error("Duration must be an integer value in milliseconds.");
    }
    const settings =
      settingsOrRoutine && typeof settingsOrRoutine !== "function"
        ? {
            ...this.settings,
            ...settingsOrRoutine,
          }
        : this.settings;

        console.log('settings --> ', settings);

    const routine = optionalRoutine ?? settingsOrRoutine;
    if (typeof routine !== "function") {
      throw new Error("INVARIANT: routine is not a function.");
    }

    if (settings.automaticExtensionThreshold > duration - 100) {
      throw new Error(
        "A lock `duration` must be at least 100ms greater than the `automaticExtensionThreshold` setting."
      );
    }

    // The AbortController/AbortSignal pattern allows the routine to be notified
    // of a failure to extend the lock, and subsequent expiration. In the event
    // of an abort, the error object will be made available at `signal.error`.
    const controller = new AbortController();
      // typeof AbortController === "undefined"
      //   ? new PolyfillAbortController()
      //   : new AbortController();

    const signal = controller.signal as RedlockAbortSignal;

    function queue(): void {
      timeout = setTimeout(
        () => (extension = extend()),
        lock.expiration - performance.now() - settings.automaticExtensionThreshold
      );
    }

    async function extend(): Promise<void> {
      timeout = undefined;

      try {
        lock = await lock.extend(duration);
        queue();
      } catch (error) {
        if (!(error instanceof Error)) {
          throw new Error(`Unexpected thrown ${typeof error}: ${error}.`);
        }

        if (lock.expiration > performance.now()) {
          return (extension = extend());
        }

        signal.error = error instanceof Error ? error : new Error(`${error}`);
        controller.abort();
      }
    }

    let timeout: undefined | number;
    let extension: undefined | Promise<void>;
    console.log('right before the call to acquire in the using function');
    console.log('arguments passed to acquire: resouces --> ', resources, ' duration --> ', duration, ' settings --> ', settings);
    let lock = await this.acquire(resources, duration, settings);
    console.log('right after the call to acquire in the using function');
    queue();

    try {
      return await routine(signal);
    } finally {
      // Clean up the timer.
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }

      // Wait for an in-flight extension to finish.
      if (extension) {
        await extension.catch(() => {
          // An error here doesn't matter at all, because the routine has
          // already completed, and a release will be attempted regardless. The
          // only reason for waiting here is to prevent possible contention
          // between the extension and release.
        });
      }

      await lock.release();
    }
  }
}
