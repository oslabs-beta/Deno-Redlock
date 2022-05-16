import Redlock from './redlock.ts';


// * TESTING sha1 algorithm
// const testString = "return 'This is what our script will be formatted like'";
// const testHash = SHA1(testString);
// console.log(testHash);


// * TESTING clusters


// function getStringFromPromise(client: Client, script: string): string {
//   let hash: string;

//   const acquireHashPromise: Promise<string> = client.scriptLoad(script)
//     .then(acquireHash => {return acquireHash})

//   const acquireHash = (): void => {
//     acquireHashPromise.then(results => { hash = results })
//     // return hash;
//   }
//   acquireHash();
//   return hash;
// }

const redis: Client = await connect({ hostname: "127.0.0.1", port: 6380 });
await redis.clusterMeet("127.0.0.1", 6381);
await redis.clusterMeet("127.0.0.1", 6382);