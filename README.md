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

## License

This project is licensed under the GNU General Public License v3.0.
See the [LICENSE](LICENSE)
