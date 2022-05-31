# Deno-Redlock

## Description
This is an implementation of the Redlock algorithm using Redis for distributed lock management. It is a secure, lightweight solution to control the access priority of multiple nodes in distributed system architecture.
> Distributed locks are a very useful primitive in many environments where different processes require to operate  with shared resources in a mutually exclusive way.
>
> There are a number of libraries and blog posts describing how to implement a DLM (Distributed Lock Manager) with Redis, but every library uses a different approach, and many use a simple approach with lower guarantees compared to what can be achieved with slightly more complex designs.
> 
> https://redis.io/docs/reference/patterns/distributed-locks/

## Installation
(Fill in steps on installation here)

## Documentation
(Put our Docs website here)

## Configuration
```ts
import { connect } from "./deps.ts"
import Redlock from './redlock.ts'

const redis = await connect({hostname: "HostIpAddress", port: portNumber})

const redlock = new Redlock(redis);

await redlock.using(["resourceId"], 10000, async (signal) => {
  // perform some action...
  await action();

  // verify that a lock extension attempt has not failed
  if (signal.aborted) {
    throw signal.error;
  }

  // perform another action...
  await anotherAction();
});
```

## Lock Usage

Locks can also be acquired, extended, and released manually

```ts
// acquisition
let lock = await redlock.acquire(["exampleResourceId"], 10000);
try {
  // perform some action...
  await action();

  // extension, which instantiates a new Lock
  lock = await lock.extend(10000);

  // perform another action...
  await anotherAction();
} finally {
  // release
  await lock.release();
}
```

## Disclaimer

This code implements an algorithm which is currently a proposal, it was not formally analyzed. Make sure to understand how it works before using it in your production environments. 

## Contributing

1. [Fork it](https://github.com/oslabs-beta/Deno-Redlock)
2. Create your feature branch (`git checkout -b your-new-feature`)
3. Commit your changes (`git commit -am 'feature-added'`)
4. Push to the branch (`git push origin your-new-feature`)
5. Create a new Pull Request
