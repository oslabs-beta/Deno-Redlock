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
  private readonly Ready: Promise<void> ;

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
      // This function serves to prevent Deno's default behavior of crashing
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
    // console.log("1", clientOrCluster);
    this.clients = new Set();
    this.Ready = new Promise((resolve) => {
      console.log('1 calling client.clusterNodes()');
      clientOrCluster.clusterNodes()
        .then(nodes => {
          console.log("2 found cluster nodes")
          const nodeInfoArr = nodes.replace(/\n|@|:/g, " ").split(" ");
          console.log(nodeInfoArr);
          const clientArray = [];
          for (let i = 0; i < nodeInfoArr.length; i++) {
              if (nodeInfoArr[i] === "connected") {
                console.log('3 in the for-loop setting client connections');
                clientArray.push([nodeInfoArr[i-8], nodeInfoArr[i-7]]);
              }
          }
          console.log(clientArray);
          for (const [host, port] of clientArray) {
            connect({hostname: host, port: Number(port)})
              .then(client => {            
                this.clients.add(client);
              })
          }
          console.log('4 this.clients set when found cluster node: ', this.clients);
          console.log('5 leaving the try block of _getClientConnections function');
          resolve()
        })
        // if error due to client not being a cluster, add single client instance to this.this.clients
        .catch(error => {
          console.log('2 did not find cluser nodes, in the catch block of this.Ready');
          // console.log(error.message);
          if (!(error.message.startsWith('-ERR This instance has cluster support disabled'))) throw error
          this.clients.add(clientOrCluster);
          console.log('3 this.clients set w/ no cluster nodes: ', this.clients);
          clientOrCluster.info("server")
            .then(nodeInfo => console.log('4 node info: ', nodeInfo));
          console.log('5 leavnig this.Ready catch block')
          resolve();
        })
      });

  }



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
    console.log('6 clients when first calling acquire after awaiting ready: ', this.clients)
    // console.log('in the acquire function');
    const start = Date.now();
    // console.log('start --> ', start);
    const value = this._random();
    console.log('7 random value for this lock: --> ', value);
    console.log('8 resources (redis Client Id) --> ', resources);
    try {
      console.log('9 about to await this._execute with acquireScript in acquire function')
      const { attempts } = await this._execute(
        this.scripts.acquireScript,
        resources,
        [value, duration],
        settings
      );
      console.log('41 finished awaiting execute, attempts looks like: ', attempts)

      // Add 2 milliseconds to the drift to account for Redis expires precision,
      // which is 1 ms, plus the configured allowable drift factor.
      const drift =
        Math.round(
          (settings?.driftFactor ?? this.settings.driftFactor) * duration
        ) + 2;
        console.log('42 creating a new lock in the acquire function');

      // return new Lock(

      console.log('43 new lock being returned from successful acquire function: ', newLock)
      return newLock;
    } catch (error) {
      // If there was an error acquiring the lock, release any partial lock
      // state that may exist on a minority of clients.
      console.log('41 lock acquistion threw an error, in the catch block of the acquire function, about to await this.execute with releaseScript');
      console.log('41 numbering should be messed up as we go back into the execute function to release any partial locks')
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
    console.log('in the release function, about to go into execute using releaseScript');

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
    const start = Date.now();

    // The lock has already expired.
    if (existing.expiration < Date.now()) {
      throw new ExecutionError("Cannot extend an already-expired lock.", []);
    }

    console.log('about to await this.execute inside extend function')
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
    console.log('replacement lock set after running extend func: ', replacement)
    return replacement;
  }

  private async _execute(
    script: { value: string; hash: string },
    keys: string[],
    args: RedisValue[],
    _settings?: Partial<Settings>
  ): Promise<ExecutionResult> {
      console.log('10 in the execute function');
    const settings = _settings
      ? {
          ...this.settings,
          ..._settings,
        }
      : this.settings;
      // console.log('settings after the ternary operator --> ', settings);

    // For the purpose of easy config serialization, we treat a retryCount of
    // -1 a equivalent to Infinity.
    const maxAttempts =
      settings.retryCount === -1 ? Infinity : settings.retryCount + 1;
    console.log('maxAttempts --> ', maxAttempts);

    const attempts: Promise<ExecutionStats>[] = [];
    while (true) {
      console.log('11 calling this._attemptOperation in the while loop of this._execute');
      const { vote, stats } = await this._attemptOperation(script, keys, args);
      console.log('37 back in execute after doing attemptOperation, vote should be in and stats should be resolved')
      console.log('38 stats after awaiting attempt operation: ', stats)

      attempts.push(stats);
      console.log('39 attempts after pushing stats into attempts: ', attempts);


      // The operation achieved a quorum in favor.
      if (vote === "for") {
        console.log('40 found vote "for" in execute, returning { attempts } and leaving execute func')
        return { attempts };
      }

      // Wait before reattempting.
      if (attempts.length < maxAttempts) {
        console.log('40 vote was against, awaiting new Promise to retry')
        console.log('40 ctd, I dont see where in this await setTimeout the attempt gets tried again... the promise gets resolved at the end of the timeout but how does that retry?')
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
        console.log('40 ran out of retry attempts')
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
      console.log('12 in the attemptOperation function, about to await then return new Promise');
    return await new Promise((resolve) => {
      console.log('13 in the return statement for attemptOperation');
      const clientResults: Promise<ClientExecutionResult>[] = [];
      // console.log('this.clients in attempt operation --> ', this.clients);
      for (const client of this.clients) {
        console.log('14 in the for loop of attemptOperation, about to push results of attemptOperationOnClient with this client: ', client)
        clientResults.push(   
          this._attemptOperationOnClient(client, script, keys, args)
        );
      }
      console.log('23 client results after for loop calling attemptOperationOnClient within attemptOperation: ', clientResults)

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

      const stats: ExecutionStats = {
        membershipSize: clientResults.length,
        quorumSize: Math.floor(clientResults.length / 2) + 1,
        votesFor: new Set<Client>(),
        votesAgainst: new Map<Client, Error>(),
      };
      console.log('24 stats object made from clientResults. Votes for and against still empty: ', stats)

      let done: () => void;
      const statsPromise = new Promise<ExecutionStats>((resolve) => {
        console.log('34-35ish, not sure how this works but in the statsPromise function and setting done function definition to resolve(stats)');
        done = () => resolve(stats);
      });
      console.log('25 passed the function definition of statsPromise that returns/resolves the promise. Where does this get called? Something with the done()??')
      // console.log('out of the statsPromise function');
      // This is the expected flow for all successful and unsuccessful requests.
      const onResultResolve = (clientResult: ClientExecutionResult): void => {
          console.log('29 in the onResultResolve function');
        switch (clientResult.vote) {
          case "for":
              console.log('30 in the "for" switch statement for onResultResolve');
            stats.votesFor.add(clientResult.client);
            break;
          case "against":
            console.log('30 in the "against" switch statement for onResultResolve');
            stats.votesAgainst.set(clientResult.client, clientResult.error);
            break;
        }
        // A quorum has determined a success.
        console.log('31 checking votesFor size against quorumSize');
        console.log('32 votesFor: ', stats.votesFor.size, 'quorumSize', stats.quorumSize);
        if (stats.votesFor.size === stats.quorumSize) {
          console.log('33 only if enough votes for exist to reach quorum, resolving onResultResolve to for')
          console.log('33 ctd vote is for but stats:statsPromise not necessarily resolved')
          resolve({
            vote: "for",
            stats: statsPromise,
          });
        }
        // A quorum has determined a failure.
        if (stats.votesAgainst.size === stats.quorumSize) {
          console.log('33 only if enough votes against exist to reach quorum, resolving onResultResolve to against')
          console.log('33 ctd vote is against but stats:statsPromise not necessarily resolved')
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
          console.log('34 all results are in from for loop, calling done and exiting onResultsResolve functionality')
          done();
        }
      };
      // This is unexpected and should crash to prevent undefined behavior.
      const onResultReject = (error: Error): void => {
        throw error;
      };

      console.log('26 passed the function definitions of onResultResolve and Reject');
      for (const result of clientResults) {
        console.log('27 in the for-loop checking results of clientResults, current result: ', result);
        console.log('28 calling result.then and expecting to go into onResultResolve()')
        result.then(onResultResolve, onResultReject);
      }
      console.log('35 votesFor: ', stats.votesFor.size, 'quorumSize', stats.quorumSize);
      console.log('36 passed the for-loop looping through clientResults, done with attemptOperation function');
    });
  }

  private async _attemptOperationOnClient(
    client: Client,
    script: { value: string; hash: string },
    keys: string[],
    args: RedisValue[]
  ): Promise<ClientExecutionResult> {
    try {
      console.log('15 in the first try block of _attemptOperationOnClient function');
      let result: number;
      try {
        console.log('16 Trying to use evalSha');
        // console.log('script.hash ==> ', script.hash, 'keys ==> ', keys, '...keys ==> ', ...keys, '...args ==> ', ...args);
        const shaResult = await client.evalsha(script.hash, keys, args) as unknown;
        console.log('17-19 sha result after calling evalSha successfully: ', shaResult)

        if (typeof shaResult !== "number") {
          throw new Error(
            `Unexpected result of type ${typeof shaResult} returned from redis.`
          );
        }

        result = shaResult;
      } catch (error) {
        console.log('17 in the catch block of evalsha, error message on next line')
        console.log(error.message)
        // If the redis server does not already have the script cached,
        // reattempt the request with the script's raw text.
        if (
          !(error instanceof Error) ||
          // !error.message.startsWith("NOSCRIPT")
          !error.message.startsWith("-NOSCRIPT")
        ) {
          throw error;
        }
        console.log('18 Error started with "-NOSCRIPT", calling eval instead')
        const rawResult = (await client.eval(script.value, keys, args)) as unknown;
        console.log('19 raw result after calling eval: ', rawResult)

        if (typeof rawResult !== "number") {
          throw new Error(
            `Unexpected result of type ${typeof rawResult} returned from redis.`
          );
        }

        result = rawResult;
      }

      // One or more of the resources was already locked.
      console.log('20 result after doing evalsha/eval try/catch: ', result)
      if (result !== keys.length) {
        throw new ResourceLockedError(
          `The operation was applied to: ${result} of the ${keys.length} requested resources.`
        );
      }

      console.log('21-22 returning vote for from attemptOperationOnClient')
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
      console.log('21 final catch block of attemptOperationOnClient');
      // Emit the error on the redlock instance for observability.
      this.emit("error", error);
      console.log('22 returning vote against from attemptOperationOnClient')
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

  /**
   * 
   * @param resources the redis client ID
   * @param duration 
   * @param settings optional settings
   * @param routine the callback function which uses/manipulates information on the redis client while lock is in place
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
    console.log('in the using function, this should happen before calling acquire. I forgot to number this early');
    console.log('using resouces --> ', resources, ' using duration --> ', duration);

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
      console.log('inside queue function of using, about to setTimeout for calling using version of extend')
      timeout = setTimeout(
        () => (extension = extend()),
        lock.expiration - Date.now() - settings.automaticExtensionThreshold
      );
    }

    async function extend(): Promise<void> {
      timeout = undefined;
      console.log('calling extend within using to queue up automatic extension')
      try {
        console.log('inside using\'s extend function try block about to await lock.extend')
        lock = await lock.extend(duration);
        queue();
      } catch (error) {
        console.log('inside catch block of using\'s extend function')
        if (!(error instanceof Error)) {
          throw new Error(`Unexpected thrown ${typeof error}: ${error}.`);
        }

        if (lock.expiration > Date.now()) {
          return (extension = extend());
        }

        signal.error = error instanceof Error ? error : new Error(`${error}`);
        controller.abort();
      }
    }

    let timeout: undefined | number; //do we need to find the deno type definition of setTimeout and use it similar to NodeJS.timeout type???
    let extension: undefined | Promise<void>;
    console.log('arguments passed to acquire: resouces --> ', resources, ' duration --> ', duration, ' settings --> ', settings);
    console.log('right before the call to await acquire in the using function early in the process');
    let lock = await this.acquire(resources, duration, settings);
    console.log('44 awaited this.acquire in using function, lock acquired looks like: ', lock)
    console.log('45 calling queue to setTimeout for automatic extension')
    queue();

    try {
      console.log('46 about to await the invocation of the callback function routine after using has acquired the lock')
      return await routine(signal);
    } finally {
      // Clean up the timer.
      if (timeout) {
        console.log('47 clearing the queued extension')
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
      console.log('48 awaiting lock release to finish up using funcitonality')
      await lock.release();
    }
  }
}
