# Deno-Redlock

## Description
This is an implementation of the Redlock algorithm that uses Redis for distributed lock management. It is a secure, lightweight solution to control the access priority of multiple nodes in distributed system architecture.

> Distributed locks are a very useful primitive in many environments where different processes require to operate  with shared resources in a mutually exclusive way.
>
> There are a number of libraries and blog posts describing how to implement a DLM (Distributed Lock Manager) with Redis, but every library uses a different approach, and many use a simple approach with lower guarantees compared to what can be achieved with slightly more complex designs.
> 
> https://redis.io/docs/reference/patterns/distributed-locks/

## Installation
(Put our link to deno.land dependency import URL here)

## Documentation
(Put our Docs website URL here)

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

The `using` method allows a routine to be executed within the context of an auto-extending lock. This method returns a promise that resolves to the routine's value. If the auto-extension fails, then the routine is aborted through the use of an AbortSignal. 

The first parameter represents an array of resources that one wishes to lock. The second parameter is the desired lock duration in milliseconds (given as an integer).

### A note about time:
Deno-Redlock utilizes a monotonic time API to prevent errors due to random time jumps that are possible with a poorly maintained GPS time API


```ts
await redlock.using(["exampleResourceId"], 10000, async (signal) => {
  // perform some action...
  await action();

  // verify that the auto-extension process has not failed
  if (signal.aborted) {
    throw signal.error;
  }

  // perform another action...
  await anotherAction();
});
```

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

## License
Distributed under the MIT License.
Copyright (c) 2022 OSLabs Beta

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and 
associated documentation files (the "Software"), to deal in the Software without restriction, including 
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell 
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the 
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial 
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT 
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO 
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
DEALINGS IN THE SOFTWARE.
