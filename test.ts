import { connect } from "./deps.ts"
import Redlock from './redlock.ts'


const redis = await connect({hostname: "127.0.0.1", port: 6379})

const redlock = new Redlock(redis);

// console.log('redlock instance1:', redlock);
// redlock.acquire(["00bd3b4728bc91f21bd0f671d4d1dc63ea036c40"], 10000)

await redlock.using(["00bd3b4728bc91f21bd0f671d4d1dc63ea036c40"], 10000, async (signal) => {
  // Do something...
  await redis.set('key4', 'newFourth');
  // Make sure any attempted lock extension has not failed.
  if (signal.aborted) {
    throw signal.error;
  }
  return;
});

await redlock.using(["00bd3b4728bc91f21bd0f671d4d1dc63ea036c40"], 10000, async (signal) => {
  // Do something...
  await redis.set('key4', 'newFourth2');
  // Make sure any attempted lock extension has not failed.
  if (signal.aborted) {
    throw signal.error;
  }
  return;
});
