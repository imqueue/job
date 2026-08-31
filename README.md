# Simple Job Queue (@imqueue/job)

[![Build Status](https://img.shields.io/github/actions/workflow/status/imqueue/job/build.yml)](https://github.com/imqueue/job/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/@imqueue/job)](https://www.npmjs.com/package/@imqueue/job)
[![Known Vulnerabilities](https://snyk.io/test/github/imqueue/job/badge.svg?targetFile=package.json)](https://snyk.io/test/github/imqueue/job?targetFile=package.json)
[![License](https://img.shields.io/badge/license-GPL-blue.svg)](https://github.com/imqueue/job/blob/master/LICENSE)

Simple job queue using JSON messaging for managing backand background jobs.
Backed up by Redis.

**Using an AI assistant?** Point it at [imqueue.org/llms.txt](https://imqueue.org/llms.txt)
for a machine-readable index of the docs. Current version, licence and Node floor
for every package: [imqueue.org/status.json](https://imqueue.org/status.json).

# Features

Based on @imqueue/core it provides Job Queue functionality including:
 - **Safe job processing** - no data loss!
 - **Fast processing** - by events, not timers, low resource usage.
 - **Supports gzip compression** for job data (decrease traffic usage, but 
   slower).
 - **Concurrent workers model supported**, the same queue can have multiple
   consumers with no data loss and natural load-balancing.
 - **Scheduleable jobs** - jobs can be delayed by specified time,
   granularity - milliseconds.
 - **Job expiration supported** - job can live forever or specified time,
   granularity - milliseconds.
 - **Publisher/Worker/Both** models of work with queues supported.
 - **TypeScript included!**

# Requirements

See requirements for @imqueue/core

# Install

~~~bash
npm i --save @imqueue/job
~~~

# Usage

~~~typescript
import JobQueue, { JobQueuePublisher, JobQueueWorker } from '@imqueue/job';

// Standard job queue (both - worker and publisher) example
new JobQueue<string>({ name: 'TestJob' })
    .onPop(job => console.log(job))
    .start().then(queue => queue
        .push('Hello, world!')
        .push('Hello, world after 1 sec!', { delay: 1000 })
        .push('Hello, world after 2 sec!', { delay: 2000 })
        .push('Hello, world after 5 sec!', { delay: 5000 })
        .push('Hello, world after 10 sec!', { delay: 10000 }),
    );

// Job queue publisher-only example
new JobQueuePublisher<string>({ name: 'CustomTestJob' })
    .start().then(queue => queue
        .push('Hello, job world!')
        .push('Hello, job world after 1 sec!', { delay: 1000 })
        .push('Hello, job world after 2 sec!', { delay: 2000 })
        .push('Hello, job world after 5 sec!', { delay: 5000 })
        .push('Hello, job world after 10 sec!', { delay: 10000 }),
    );

// Job queue worker only example
new JobQueueWorker<string>({ name: 'CustomTestJob' })
    .onPop(job => console.log(job))
    .start()
    .catch(err => console.error(err));
~~~

# Transport encryption (TLS)

Set `tls` and the queue's connection to the broker is encrypted. `true`
connects with Node's defaults, verifying the broker against the system trust
store; an object is handed to `tls.connect()` as given:

```typescript
import { readFileSync } from 'node:fs';
import { JobQueue } from '@imqueue/job';

const queue = new JobQueue({
    name: 'Email',
    cluster: [{ host: 'redis.internal', port: 6380 }],
    password: process.env.REDIS_PASSWORD,
    tls: {
        ca: readFileSync('/etc/redis-tls/ca.crt'),
        cert: readFileSync('/etc/redis-tls/client.crt'),  // mutual TLS,
        key: readFileSync('/etc/redis-tls/client.key'),   // if asked for
    },
});
```

The broker has to be listening for TLS. One that is not refuses the handshake
rather than falling back to plaintext, so a queue never quietly downgrades.

Leave `tls` out and `@imqueue/core` reads the environment instead —
`IMQ_REDIS_TLS`, `IMQ_REDIS_TLS_CA_FILE`, `IMQ_REDIS_TLS_CERT_FILE`,
`IMQ_REDIS_TLS_KEY_FILE`, `IMQ_REDIS_TLS_SERVERNAME` — which encrypts every job
queue in a deployment without a code change. Passing `tls` explicitly always
wins, `tls: false` included. See the `@imqueue/core` README for the full list
and for the two things that will bite you: a certificate is verified against
the host you connect to, and `rejectUnauthorized: false` is not a shortcut.

This is covered against a real broker rather than a mock: `npm run
test-integration` stands up a throwaway TLS-only redis and pushes a job across
it. Those specs skip themselves where `redis-server` and `openssl` are not both
installed, and `npm test` does not run them.

# Graceful shutdown

By default a worker signalled mid-job abandons it: `@imqueue/core`'s signal
handlers release the watcher locks and exit without waiting for `onPop` to
return. Safe delivery does not save it — the job's worker key is released the
moment the job reaches the handler, so nothing re-queues it.

Opt into draining and `SIGTERM`/`SIGINT` instead stop popping, wait for the
handlers already running, put back whatever the budget ran out on, and exit `0`:

~~~bash
IMQ_DRAIN_ENABLE=1
~~~

| variable | option | default | meaning |
|---|---|---|---|
| `IMQ_DRAIN_ENABLE` | `drain` | `0` | drain on `SIGTERM`/`SIGINT` |
| `IMQ_DRAIN_TIMEOUT` | `drainTimeout` | `4000` | drain budget, milliseconds |
| `IMQ_DRAIN_REQUEUE` | `drainRequeue` | `1` | push abandoned jobs back |

~~~typescript
new JobQueueWorker<string>({
    name: 'CustomTestJob',
    drain: true,
    drainTimeout: 20000,
})
    .onPop(job => console.log(job))
    .start()
    .catch(err => console.error(err));
~~~

The drain waits for the whole of a job's handling, not just the handler — a
handler that asks to be retried re-schedules itself over the writer connection,
and that send has to complete too.

**Raise `drainTimeout` for real workloads.** The 4000 ms default is sized for
the `imq stop` CLI, which polls for about five seconds before `SIGKILL`; it is
not sized for your handlers. Kubernetes allows 30 s by default.

**`drainRequeue` trades a lost attempt for a possible duplicate.** A job the
drain gives up on is pushed back while its handler is still running, so it can
both complete and be delivered again — the same duplicate a lease expiry would
produce. Turn it off if a duplicate is worse than a lost attempt.

Delivery remains **at-least-once** in every mode. A drain narrows the window in
which an attempt is lost; `SIGKILL`, an OOM kill or a lost node still take it,
so handlers must stay idempotent.

## License

This project is licensed under the GNU General Public License v3.0.
See the [LICENSE](LICENSE)
