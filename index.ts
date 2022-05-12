 import { EventEmitter, connect } from './deps.ts';


 const redis = await connect({ hostname: "127.0.0.1", port: 6379 });

//  await redis.clusterMeet("127.0.0.1", 6380);