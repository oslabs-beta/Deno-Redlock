import { connect } from "./deps.ts"
import Redlock from './redlock.ts'


const redis = await connect({hostname: "127.0.0.1", port: 6379})

const redlock = new Redlock(redis)


redlock.using(["bdc4076d8604a493c324292b57ed3c3f00797f8d"], 10000, async (signal) => {
    await redis.set("key1", "test2");
    console.log('finished calling redis.set as the callback routine in test file')

    if (signal.aborted) {
        throw signal.error;
    }
})