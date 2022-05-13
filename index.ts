import { EventEmitter, connect, Client, randomBytes } from './deps.ts';


// * TESTING clusters
// const redis: Client = await connect({ hostname: "127.0.0.1", port: 6380 });

// await redis.clusterMeet("127.0.0.1", 6381);
// await redis.clusterMeet("127.0.0.1", 6382);


const getNodeConnectInfoFromCluster = async (client: Client) => {
  // List the nodes in the cluster
  const nodes = await client.clusterNodes();
  // Replace the /n characters with a space
  const nodes2 = nodes.replace(/\n/g, " ");
  const nodes3 = nodes2.replace(/\@/g, " ");
  const nodes4 = nodes3.replace(/\:/g, " ");
  const nodes5 = nodes4.split(' ');
  console.log(nodes5);
  // Split the string into an array along the spaces
  //const infoArray = nodes2.split(' ');
  // console.log(nodes);
  // Initialize an empty array to hold the node ids
  const clientArray = [];
  // Loop through the split array and push the node ids onto idArray
  for (let i = 0; i < nodes5.length; i++) {
    if (nodes5[i] === "connected") {
      clientArray.push([nodes5[i-8], nodes5[i-7]]);
    }
  }
  console.log(clientArray);
  return clientArray;
}

// getNodeIdsFromCluster(redis);
// const nodeIds = await getNodeIdsFromCluster(redis);

// Define Lua scripts to be sent to Redis instances
const ACQUIRE_SCRIPT = `
  -- Return 0 if an entry already exists.
  for i, key in ipairs(KEYS) do
    if redis.call("exists", key) == 1 then
      return 0
    end
  end

  -- Create an entry for each provided key.
  for i, key in ipairs(KEYS) do
    redis.call("set", key, ARGV[1], "PX", ARGV[2])
  end

  -- Return the number of entries added.
  return #KEYS
`;

const EXTEND_SCRIPT = `
  -- Return 0 if an entry exists with a *different* lock value.
  for i, key in ipairs(KEYS) do
    if redis.call("get", key) ~= ARGV[1] then
      return 0
    end
  end
  -- Update the entry for each provided key.
  for i, key in ipairs(KEYS) do
    redis.call("set", key, ARGV[1], "PX", ARGV[2])
  end
  -- Return the number of entries updated.
  return #KEYS
`;

const RELEASE_SCRIPT = `
  local count = 0
  for i, key in ipairs(KEYS) do
    -- Only remove entries for *this* lock value.
    if redis.call("get", key) == ARGV[1] then
      redis.pcall("del", key)
      count = count + 1
    end
  end
  -- Return the number of entries removed.
  return count
`;

// const acquireSha1 = await redis.scriptLoad(ACQUIRE_SCRIPT);
// console.log(acquireSha1);
// const res = await redis.evalsha(acquireSha1, nodeIds, [lockId, lockDuration]);

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

/*
 * This error indicates a failure due to the existence of another lock for one
 * or more of the requested resources.
 */
export class ResourceLockedError extends Error {
  constructor(public readonly message: string) {
    super();
    this.name = "ResourceLockedError";
  }
}

/*
 * This error indicates a failure of an operation to pass with a quorum.
 */
export class ExecutionError extends Error {
  constructor(
    public readonly message: string,
    public readonly attempts: ReadonlyArray<Promise<ExecutionStats>>
  ) {
    super();
    this.name = "ExecutionError";
  }
}

/*
 * An object of this type is returned when a resource is successfully locked. It
 * contains convenience methods `release` and `extend` which perform the
 * associated Redlock method on itself.
 */
export class Lock {
  constructor(
    public readonly redlock: Redlock,
    public readonly resources: string[],
    public readonly value: string,
    public readonly attempts: ReadonlyArray<Promise<ExecutionStats>>,
    public expiration: number
  ) {}

  async release(): Promise<ExecutionResult> {
    return this.redlock.release(this);
  }

  async extend(duration: number): Promise<Lock> {
    return this.redlock.extend(this, duration);
  }
}

// Redlock abort signal type definition
export type RedlockAbortSignal = AbortSignal & { error?: Error };

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
    readonly acquireScript: { value: string; hash: Promise<string> };
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

    const getHashFromRedis = async (script: string): Promise<string> => {
      return await clientOrCluster.scriptLoad(script);
    }

    this.scripts = {
      acquireScript: {
        value: acquireScript,
        hash: getHashFromRedis(acquireScript),
      },
      extendScript: {
        value: extendScript,
        hash: getHashFromRedis(extendScript),
      },
      releaseScript: {
        value: releaseScript,
        hash: getHashFromRedis(releaseScript),
      },
    };

    this.clients = new Set();
    const getClientConnections = async () => {
       // If constructed with a cluster, establish connection to each Redis instance in cluster
      try {
        const connectInfoArray: string[][] = await getNodeConnectInfoFromCluster(clientOrCluster);
        for (const [host, port] of connectInfoArray) {
          const client: Client = await connect({hostname: host, port: Number(port)});
          this.clients.add(client);
        }
      }
      // otherwise set clients to single client instance
      catch {
        this.clients.add(clientOrCluster);
      }
    }
    getClientConnections();
  }
  /**
   * Generate a cryptographically random string.
   */
  private _random(): string {
    return randomBytes(16).toString("hex");
  }
}