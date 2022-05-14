import { EventEmitter, connect, Client, randomBytes } from './deps.ts';
import { ACQUIRE_SCRIPT, EXTEND_SCRIPT, RELEASE_SCRIPT } from './scripts.ts';
import { ClientExecutionResult, ExecutionStats, ExecutionResult, Settings, RedlockAbortSignal } from './types.ts';
import { ResourceLockedError, ExecutionError } from './errors.ts'
import { Lock } from './lock.ts';

// * TESTING clusters
const redis: Client = await connect({ hostname: "127.0.0.1", port: 6380 });
await redis.clusterMeet("127.0.0.1", 6381);
await redis.clusterMeet("127.0.0.1", 6382);



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
  public readonly clients: Set<Client>;
  public readonly settings: Settings;
  public readonly scripts: {
    readonly acquireScript: { value: string; hash: string };
    readonly extendScript: { value: string; hash: Promise<string> };
    readonly releaseScript: { value: string; hash: Promise<string> };
  };

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

    // Customize the settings for this instance.
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

    const promiseHash = this._getHashFromRedis(clientOrCluster, acquireScript)
    const acquireHash: string = Promise.resolve(promiseHash);
    
    this.scripts = {
      acquireScript: {
        value: acquireScript,
        hash: promiseHash,
      },
      extendScript: {
        value: extendScript,
        hash: this._getHashFromRedis(clientOrCluster, extendScript),
      },
      releaseScript: {
        value: releaseScript,
        hash: this._getHashFromRedis(clientOrCluster, releaseScript),
      },
    };

    // add all redis cluster instances/single client to clients set
    this.clients = new Set();
    this._getClientConnections(clientOrCluster);
  }

  /**
   * This method loads scripts to a Redis client's cache and returns the hex'd sha1 hash of the string
  */
  private async _getHashFromRedis(client: Client, script: string): Promise<string> {
    const hash:string = await client.scriptLoad(script);
    return hash;
  }
  private _resolveHash(param: Promise<string>): string {
    const hash2 = Promise.resolve(param);
    return hash2;
  }

  // _gethashFromRedis(normal param).then(data => return data)

  /**
   * This method pulls hostname and port out of cluster connection info, returns error if client is not a cluster
  */
  private async _getNodeConnectInfoFromCluster(client: Client) {
    const nodes = await client.clusterNodes();
    const nodeInfoArr = nodes.replace(/\n|@|:/g, " ").split(" ");
    // console.log(nodeInfoArr);
    const clientArray = [];
    for (let i = 0; i < nodeInfoArr.length; i++) {
      if (nodeInfoArr[i] === "connected") {
        clientArray.push([nodeInfoArr[i-8], nodeInfoArr[i-7]]);
      }
    }
    // console.log(clientArray);
    return clientArray;
  }

  private async _getClientConnections(client: Client): Promise<void> {
    // If constructed with a cluster, establish connection to each Redis instance in cluster
    try {
      const connectInfoArray: string[][] = await this._getNodeConnectInfoFromCluster(client);
      for (const [host, port] of connectInfoArray) {
        const client: Client = await connect({hostname: host, port: Number(port)});
        this.clients.add(client);
        // console.log(`adding client from cluster: `, client)
      }
    }
    // if error due to clientOrCluster not being a cluster, set clients set to single client instance
    catch {
      this.clients.add(client);
      // console.log('adding single client: ', client);
    }
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

    const start = performance.now();
    const value = this._random();

    try {
      const { attempts } = await this._execute(
        this.scripts.acquireScript,
        resources,
        [value, duration],
        settings
      );

      // Add 2 milliseconds to the drift to account for Redis expires precision,
      // which is 1 ms, plus the configured allowable drift factor.
      const drift =
        Math.round(
          (settings?.driftFactor ?? this.settings.driftFactor) * duration
        ) + 2;

      return new Lock(
        this,
        resources,
        value,
        attempts,
        start + duration - drift
      );
    } catch (error) {
      // If there was an error acquiring the lock, release any partial lock
      // state that may exist on a minority of clients.
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
  
      const start = Date.now();
  
      // The lock has already expired.
      if (existing.expiration < Date.now()) {
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
      args: (string | number)[],
      _settings?: Partial<Settings>
    ): Promise<ExecutionResult> {
      const settings = _settings
        ? {
            ...this.settings,
            ..._settings,
          }
        : this.settings;
  
      // For the purpose of easy config serialization, we treat a retryCount of
      // -1 a equivalent to Infinity.
      const maxAttempts =
        settings.retryCount === -1 ? Infinity : settings.retryCount + 1;
  
      const attempts: Promise<ExecutionStats>[] = [];
  
      while (true) {
        const { vote, stats } = await this._attemptOperation(script, keys, args);
  
        attempts.push(stats);
  
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

}


const redlock: Redlock = new Redlock(redis);