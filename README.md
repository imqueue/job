# Simple Job Queue (@imqueue/job)

[![Build Status](https://travis-ci.org/imqueue/job.svg?branch=master)](https://travis-ci.org/imqueue/job) 
[![David](https://img.shields.io/david/imqueue/job.svg)](https://david-dm.org/imqueue/job)
[![David](https://img.shields.io/david/dev/imqueue/job.svg)](https://david-dm.org/imqueue/job?type=dev)
[![Known Vulnerabilities](https://snyk.io/test/github/imqueue/job/badge.svg?targetFile=package.json)](https://snyk.io/test/github/imqueue/job?targetFile=package.json)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](https://rawgit.com/imqueue/core/master/LICENSE)

Simple JSON messaging based Job Queue for managing backand background jobs.

# Features

Based on @imqueue/core it provides Job Queue functionality including:
 - **Safe message handling** - no data loss!
 - **Supports gzip compression for messages** (decrease traffic usage, but 
   slower).
 - **Concurrent workers model supported**, the same queue can have multiple
   consumers.
 - **Delayed jobs** - when the job should be scheduled.
 - **TypeScript included!**

# Requirements

See requirements for @imqueue/core

# Install

~~~bash
npm i --save @imqueue/job
~~~

# Usage

~~~typescript
import JobQueue from '@imqueue/job';

new JobQueue<string>({ name: 'TestJob' })
    .onPop(job => console.log(job))
    .start().then(queue => queue
        .push('Hello, world!')
        .push('Hello, world after 1 sec!', { delay: 1000 })
        .push('Hello, world after 2 sec!', { delay: 2000 })
        .push('Hello, world after 5 sec!', { delay: 5000 })
        .push('Hello, world after 10 sec!', { delay: 10000 }),
);
~~~

## License

[ISC](https://rawgit.com/imqueue/job/master/LICENSE)
