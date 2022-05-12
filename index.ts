import { EventEmitter, connect, Client } from './deps.ts';
//const abortController = new AbortController();

const redis: Client = await connect({ hostname: "127.0.0.1", port: 6380 });

await redis.clusterMeet("127.0.0.1", 6381);
await redis.clusterMeet("127.0.0.1", 6382);
// ...

const getNodeIds = async () => {
  // List the nodes in the cluster
  const nodes = await redis.clusterNodes();
  // Replace the /n characters with a space
  const nodes2 = nodes.replace(/\n/g, " ");
  // Split the string into an array along the spaces
  const infoArray = nodes2.split(' ');
  console.log(nodes);
  // Initialize an empty array to hold the node ids
  const idArray = [];
  // Loop through the split array and push the node ids onto idArray
  for (let i = 0; i < infoArray.length; i++) {
    if ((infoArray[i].length === 40) && infoArray[i + 7] === "connected") {
      idArray.push(infoArray[i]);
    }
  }
  console.log(idArray);
  return idArray;
}
getNodeIds();



