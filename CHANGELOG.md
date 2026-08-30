# Changelog

Notable changes to `@imqueue/job`. Entries start with the first release whose
behavior changes needed a written record; earlier history is in the git log.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Opt-in graceful shutdown draining.** With `IMQ_DRAIN_ENABLE=1` — or the new
  `drain` option — `SIGTERM` and `SIGINT` now stop popping, wait for the jobs
  already being handled, then release the connection and exit `0`, in that
  order. The order is load-bearing: `stop()` drops the reader connection only,
  so the writer stays up through the whole wait, which is what lets a handler's
  own retry re-schedule complete. Previously the queue layer's handlers released
  the watcher locks and exited without waiting, so a job in flight lost that
  attempt silently.

  The wait covers a job's whole handling, not just the handler: a handler that
  returns a retry delay re-schedules itself through `imq.send()`, and a drain
  that exited before that send completed would lose the retry it was told to
  make. A pending `push()` is waited for too, so a drain does not exit out from
  under a job that has not reached the broker yet.

- **`IMQ_DRAIN_TIMEOUT` / the `drainTimeout` option**, the drain budget in
  milliseconds, default `4000`. The wait is always bounded and the process
  always exits. The default is sized against the `imq stop` CLI, which signals
  the process group, polls for about five seconds and then sends `SIGKILL` — not
  against handler duration, so it is the number most worth raising for a real
  workload. Kubernetes' `terminationGracePeriodSeconds` defaults to 30 s.

- **`IMQ_DRAIN_REQUEUE` / the `drainRequeue` option**, default on, pushes a job
  the drain gave up on back onto the queue before exiting. This closes a hole
  the drain itself would otherwise leave: safe delivery releases a job's worker
  key as soon as the job reaches the handler, so a job abandoned at the budget
  is checked out to nobody and nothing would ever bring it back. The cost is the
  usual at-least-once one — the abandoned handler is still running as its job is
  pushed back, so the job can both complete and be delivered again, which is the
  same duplicate a lease expiry would have produced. Turn it off if a duplicate
  is worse than a lost attempt.

  All three variables are read numerically, consistent with the `IMQ_*` family,
  but a non-numeric value throws at construction rather than falling back to the
  default — `IMQ_DRAIN_ENABLE=true` coerces to `NaN` under that convention, and
  a feature flag that quietly reads as *off* is worth being loud about.

### Changed

- With draining enabled, a queue passes `handleSignals: false` to
  `@imqueue/core`, whose own handlers would otherwise exit the process
  mid-drain. Every drain-enabled queue in the process drains under one shared
  signal handler, so a publisher and a worker side by side do not exit from
  under each other, and the handler is removed when the last of them is
  destroyed. A second signal during a drain forces an immediate exit.
- **Nothing changes with `IMQ_DRAIN_ENABLE` unset or `0`**, which is the
  default: no signal handler is installed by this package, no tracking state is
  allocated, and shutdown timing is what it was. Covered by a regression test
  that signals a real process mid-handler and asserts the job is still
  abandoned.
- `handleMessage` — the body of the `message` listener `onPop` installs — moved
  onto `BaseJobQueue` so both `JobQueueWorker` and `JobQueue` reach it, since
  `JobQueue` borrows `onPop` through `Function.call`. Behaviour is unchanged.

  What is deliberately **not** changed: when the safe-delivery worker key is
  released. It is still released as the job reaches the handler, so safe
  delivery still protects the hand-off and not the processing. Holding the lease
  until the handler settles needs a change in `@imqueue/core`, which owns the
  key and never exposes it.

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
