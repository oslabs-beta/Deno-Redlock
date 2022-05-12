import { EventEmitter, connect, Client } from './deps.ts';
//const abortController = new AbortController();

const redis: Client = await connect({ hostname: "127.0.0.1", port: 6380 });

await redis.clusterMeet("127.0.0.1", 6381);
await redis.clusterMeet("127.0.0.1", 6382);
// ...

// List the nodes in the cluster
const nodes = await redis.clusterNodes();
const nodes2 = nodes.replace(/\n/g, " ")
const infoArray = nodes2.split(' ');
console.log(nodes);

const idArray = [];
for (let i = 0; i < infoArray.length; i++) {
  if ((infoArray[i].length === 40) && infoArray[i + 7] === "connected") {
    idArray.push(infoArray[i]);
  }
}

console.log(idArray);

// ... 127.0.0.1:6379@16379 myself,master - 0 1593978765000 0 connected
// ... 127.0.0.1:6380@16380 master - 0 1593978766503 1 connected


