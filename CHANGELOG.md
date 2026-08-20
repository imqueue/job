# Changelog

Notable changes to `@imqueue/job`. Entries start with the first release whose
behavior changes needed a written record; earlier history is in the git log.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-08-20

### Added

- **A job that is lost or not retried is now visible in the log.** Every line
  is written through the configured logger on every occurrence, names the
  queue and the message id where one exists, and never the job body or an
  error text. No control flow, return value or timer was altered.

  - `[JobQueue] push error:` now also covers a write to redis rejected after
    `push()` returned, reports at `error` level and carries the queue, the
    requested delay and ttl and a failure code. A failure the redis client
    delivers twice — through both its command callback and its returned
    promise — writes one line. The marker text is unchanged.
  - The handler-failure line now states what happens next: `retry in <ms>` or
    `no retry`, with the message id, on every failure.
  - A retry suppressed because the job's ttl expired, with the message id.
  - A re-schedule whose write to redis failed — the promised retry is not
    coming, with the message id and a failure code.

  A failure code is never taken from the error as it is: only an allow-listed
  code is printed — an `IMQ_`-prefixed framework code, a system `E…` code, a
  small integer, a known redis reply code (`WRONGTYPE`, `NOSCRIPT`,
  `LOADING`, …) or one of a few known redis-client failure messages mapped to
  codes of our own. Everything else, including the error's message, stack and
  class name, is reported as `unknown`. A throwing logger can not influence
  the queue: every line is written through a contained writer. One deliberate
  difference: a logger which throws while an early-rejected push is reported
  no longer surfaces that throw, and no longer cancels a re-schedule.
