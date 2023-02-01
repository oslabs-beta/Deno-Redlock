import EventEmitter from "https://deno.land/x/events@v1.0.0/mod.ts";
import type {
  Redis as Client,
  RedisValue,
} from "https://deno.land/x/redis@v0.25.5/mod.ts";
import randomBytes from "https://deno.land/std@0.139.0/node/_crypto/randomBytes.ts";

// required for testing
import { connect } from "https://deno.land/x/redis@v0.25.5/mod.ts";
import {
  assert,
  assertEquals,
  assertNotEquals,
  fail,
} from "https://deno.land/std@0.141.0/testing/asserts.ts";

export {
  assert,
  assertEquals,
  assertNotEquals,
  connect,
  EventEmitter,
  fail,
  randomBytes,
};
export type { Client, RedisValue };
