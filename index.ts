/*!
 * Job Queue for @imqueue framework
 *
 * I'm Queue Software Project
 * Copyright (C) 2025  imqueue.com <support@imqueue.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * If you want to use this code in a closed source (commercial) project, you can
 * purchase a proprietary commercial license. Please contact us at
 * <support@imqueue.com> to get commercial licensing options.
 */
/**
 * Simple, safe-by-default Redis job queue for `@imqueue` services — delayed and
 * scheduled jobs, at-least-once delivery, and re-scheduling driven by whatever
 * the handler returns.
 *
 * Pick one of three shapes. {@link JobQueue}, the default export, both pushes and
 * handles jobs in one process. {@link JobQueuePublisher} only pushes and
 * {@link JobQueueWorker} only handles, for the usual split where an API enqueues
 * work that a pool of workers drains — those two must be constructed with the
 * same {@link JobQueueOptions.name}, which is what makes them the same queue.
 *
 * @remarks
 * Delivery is at-least-once, so handlers must be idempotent. Safe delivery is on
 * by default here, which is the opposite of `@imqueue/core`'s own default, and it
 * covers the hand-off of a job to a worker rather than its processing — see
 * {@link JobQueueOptions.safe} for what that does and does not guarantee. Two
 * further core defaults are overridden: the key prefix is `imq-job` rather than
 * `imq`, and the safe-delivery TTL is 10 seconds rather than 5.
 *
 * Job data travels as JSON, so anything that does not survive `JSON.stringify` —
 * class instances, `Date`, `undefined` properties, cycles — does not arrive as it
 * left. Push a plain object and re-hydrate it in the handler.
 *
 * Shutdown is worth knowing about before it matters in production. `@imqueue/core`
 * installs process-wide SIGTERM, SIGINT and SIGABRT handlers by default; they
 * release the queue's watcher locks and then exit the process without waiting for
 * a running handler to return. So a job in flight when the signal arrives loses
 * that attempt, and is re-delivered later only if safe delivery had the job checked
 * out. Drain work yourself if a half-finished job would do damage.
 *
 * @example
 * ```typescript
 * import JobQueue from '@imqueue/job';
 *
 * interface Email { to: string; subject: string }
 *
 * const queue = new JobQueue<Email>({ name: 'Email' });
 *
 * queue.onPop(async (email: Email) => {
 *     await send(email);
 * });
 *
 * await queue.start();
 *
 * // right away, and again in an hour
 * queue.push({ to: 'a@b.c', subject: 'Hi' });
 * queue.push({ to: 'a@b.c', subject: 'Later' }, { delay: 3600000 });
 * ```
 *
 * @packageDocumentation
 */
import IMQ, {
    type AnyJson,
    type ILogger,
    type IMessageQueue,
    IMQMode,
    type IMQOptions,
} from '@imqueue/core';

/**
 * Everything a job queue needs to connect and behave, given to every constructor
 * in this package.
 *
 * Only {@link JobQueueOptions.name} is required. The rest tune the broker
 * connection, the delivery guarantee and logging, and each carries the default
 * that applies when it is omitted.
 */
export interface JobQueueOptions {
    /**
     * Name of the job queue. Required.
     *
     * This is the queue's identity, not a label: a {@link JobQueueWorker} and a
     * {@link JobQueuePublisher} that share a name are two ends of one queue, and
     * two that do not are unrelated queues that will never see each other's jobs.
     */
    name: string;

    /**
     * Broker nodes to connect to, as host/port pairs. The broker is Redis.
     *
     * @remarks
     * Omit this and the queue connects to a single `localhost:6379`, which is
     * `@imqueue/core`'s default endpoint rather than a one-node cluster. Give two
     * or more entries only when the broker really is clustered — core spreads the
     * queue across the nodes it is given.
     */
    cluster?: { host: string; port: number }[];

    /**
     * Username for authenticating against the broker. Omit it on a broker that
     * takes a password alone, which is the usual Redis setup.
     */
    username?: string;

    /**
     * Password for authenticating against the broker.
     */
    password?: string;

    /**
     * Logger for the queue's own log and error messages.
     *
     * @defaultValue console
     *
     * @remarks
     * Worth supplying, because this is the only channel through which some
     * failures surface at all: {@link JobQueuePublisher.push} reports a failed
     * enqueue here and nowhere else. Pass a no-op logger to silence the queue.
     */
    logger?: ILogger;

    /**
     * Whether a job is handed to a worker under a lock, so that a worker dying
     * before it starts does not take the job with it.
     *
     * @defaultValue true
     *
     * @remarks
     * When safe delivery is enabled a job is moved atomically out of the queue
     * into a worker-owned key as it is popped, so a process that dies before it
     * even starts on that job leaves the job data behind to be re-queued for
     * another worker instead of losing it.
     *
     * The guarantee covers that hand-off and not the processing: the key is
     * released as soon as the job reaches the handler, so a worker killed
     * part-way through `onPop` loses that attempt. Jobs are delivered
     * at-least-once, so handlers should be idempotent.
     *
     * Note this defaults to `true` here while `@imqueue/core` defaults it to
     * `false` — a job queue is the case where the extra round-trip is worth it.
     */
    safe?: boolean;

    /**
     * How long, in milliseconds, a job may sit checked out to a worker during
     * safe delivery before it is treated as abandoned.
     *
     * @defaultValue 10000
     *
     * @remarks
     * A worker key still present once this expires is treated as abandoned and
     * its job is moved back onto the queue, so this bounds how long an abandoned
     * hand-off takes to come back. It is not a processing deadline: a job that
     * takes longer than this to handle is neither interrupted nor re-queued.
     *
     * `@imqueue/core`'s own default is 5000; this package raises it to 10000.
     */
    safeLockTtl?: number;

    /**
     * Prefix for every key this queue creates in the broker.
     *
     * @defaultValue "imq-job"
     *
     * @remarks
     * It namespaces the queue, so two queues sharing a name but not a prefix stay
     * separate — which is how one Redis instance serves several environments.
     * `@imqueue/core`'s default is `imq`; this package uses `imq-job` so job keys
     * are distinguishable from RPC ones at a glance.
     */
    prefix?: string;

    /**
     * Enables the queue's informational tracing.
     *
     * @defaultValue false
     *
     * @remarks
     * Connection and lifecycle problems are logged regardless; only the chatty
     * per-operation tracing is gated by this.
     */
    verbose?: boolean;

    /**
     * Adds message bodies to the verbose tracing.
     *
     * @defaultValue false
     *
     * @remarks
     * The output includes job payloads, so it may contain whatever personal or
     * secret data your jobs carry — this is a debugging aid, not something to
     * leave on in production. Has no effect unless
     * {@link JobQueueOptions.verbose} is also enabled.
     */
    verboseExtended?: boolean;
}

/**
 * What a worker does with each job, and how it asks for the job to come back.
 *
 * The handler's return value is the re-scheduling instruction, so the retry
 * policy is written in the handler rather than configured on the queue. Pass one
 * to {@link JobQueueWorker.onPop} or {@link JobQueue.onPop}.
 */
export interface JobQueuePopHandler<T> {
    /**
     * Handles one job popped from the queue, returning an optional delay after
     * which the same job should run again.
     *
     * @param job - the job body, as it was given to `push`, revived from JSON
     * @returns nothing to finish the job, or a delay in milliseconds to re-run it
     *
     * @remarks
     * The full contract, since every branch of it is observable:
     *
     * - return nothing — or `undefined`, or any negative number — and the job is
     *   done and dropped. This is the normal case.
     * - return a number `>= 0` and the job is pushed back with that delay, `0`
     *   meaning as soon as possible.
     * - return a promise and it is awaited first; whatever it resolves to is read
     *   by the same rules.
     * - throw, and the job is re-scheduled with the delay it was originally
     *   pushed with, and the error is logged. A rejected promise counts as a throw.
     *
     * A job whose {@link PushOptions.ttl} has run out by the time the handler
     * returns is never re-scheduled, whichever of those it did — expiry outranks
     * the handler's request.
     *
     * Re-scheduling on throw needs this process to still be alive: if the worker
     * goes down while this handler is running, that attempt is lost — safe
     * delivery guards the hand-off of a job, not its processing.
     *
     * @example
     * ```typescript
     * // handled and done — the normal case
     * queue.onPop(job => {
     *     console.log(job);
     * });
     * // re-scheduled immediately
     * queue.onPop(job => {
     *     console.log(job);
     *     return 0;
     * });
     * // negative reads the same as returning nothing: done, not re-scheduled
     * queue.onPop(job => {
     *     console.log(job);
     *     return -1;
     * });
     * // throwing re-schedules with the delay the job was pushed with
     * queue.onPop(job => {
     *     throw new Error('Job error');
     * });
     * // re-scheduled with a new delay of 1 second
     * queue.onPop(job => {
     *     console.log(job);
     *     return 1000; // re-run after 1 second
     * });
     * ```
     */
    (job: T): number | void | Promise<number | void>;
}

/**
 * Per-job scheduling options for {@link JobQueuePublisher.push} and
 * {@link JobQueue.push} — when the job may first run, and how long it stays
 * worth retrying.
 */
export interface PushOptions {
    /**
     * Milliseconds to wait before any worker may pick this job up. Omit it to
     * make the job available immediately.
     *
     * @remarks
     * This is also the delay the job is re-scheduled with if its handler throws,
     * so it doubles as the retry back-off for that job.
     */
    delay?: number;

    /**
     * Milliseconds after which this job stops being re-scheduled, counted from
     * the moment it is pushed.
     *
     * @remarks
     * This bounds retrying, not delivery, and the difference is observable. The
     * deadline is only consulted after a handler has run: an expired job is still
     * handed to the handler and still runs, and expiry then suppresses the
     * re-scheduling it would otherwise have got. So a job that keeps failing stops
     * being retried once its TTL has passed, but a job delivered late is not
     * silently discarded — it runs once more first.
     *
     * Omit it and the job is retried for as long as its handler keeps asking.
     */
    ttl?: number;
}

/**
 * What every queue in this package can do regardless of which end it is: report
 * its name, expose its logger, and start, stop or tear down its broker
 * connection.
 *
 * `T` is the implementing type itself, so that `start` and `stop` resolve to the
 * concrete queue and stay chainable.
 */
export interface AnyJobQueue<T> {
    /**
     * Name of this queue, as given in {@link JobQueueOptions.name}. Read-only —
     * a queue cannot be re-pointed after construction.
     */
    name: string;

    /**
     * Logger this queue reports through, either the one supplied in
     * {@link JobQueueOptions.logger} or `console`.
     */
    readonly logger: ILogger;

    /**
     * Opens the broker connection and begins processing, resolving to this queue.
     */
    start(): Promise<T>;

    /**
     * Stops processing, resolving to this queue. The queue can be started again.
     */
    stop(): Promise<T>;

    /**
     * Closes the broker connection and releases the queue's resources for good.
     * Unlike {@link AnyJobQueue.stop} this is not reversible.
     */
    destroy(): Promise<void>;
}

/**
 * The consuming half of a queue: something that can be given a handler to run
 * against each job.
 *
 * `T` is the implementing type, returned for chaining; `U` is the job body type.
 */
export interface AnyJobQueueWorker<T, U> {
    /**
     * Registers the handler for jobs popped from this queue, replacing any
     * handler already set, and returns this queue.
     */
    onPop(handler: JobQueuePopHandler<U>): T;
}

/**
 * The producing half of a queue: something that can enqueue jobs.
 *
 * `T` is the implementing type, returned for chaining; `U` is the job body type.
 */
export interface AnyJobQueuePublisher<T, U> {
    /**
     * Enqueues one job, optionally delayed or time-limited, and returns this
     * queue.
     */
    push(job: U, options?: PushOptions): T;
}

/**
 * Shared base of the three concrete queues, implementing everything that does not
 * depend on which end of the queue you are.
 *
 * @remarks
 * Not usable on its own and not meant to be subclassed outside this package: it
 * leaves {@link BaseJobQueue.imq} to be assigned by a subclass constructor, so a
 * subclass that forgets to do so fails on first use. Reach for
 * {@link JobQueue}, {@link JobQueueWorker} or {@link JobQueuePublisher} instead.
 *
 * `T` is the concrete queue type, so inherited methods resolve to it rather than
 * to this base; `U` is the job body type.
 */
export abstract class BaseJobQueue<T, U> implements AnyJobQueue<T> {
    /**
     * The underlying `@imqueue/core` message queue this job queue runs on.
     *
     * @remarks
     * Assigned by each subclass constructor, with the mode that suits it, which is
     * the one thing a subclass must do. Declared with a definite-assignment
     * assertion for that reason — it is never actually unset on a constructed
     * queue.
     */
    protected imq!: IMessageQueue;

    /**
     * The handler registered by `onPop`, if any.
     *
     * @remarks
     * Doubles as the readiness flag on {@link JobQueue}, whose `start` and `push`
     * both refuse to run while it is unset.
     */
    protected handler?: JobQueuePopHandler<U>;

    /**
     * Logger this queue reports through — {@link JobQueueOptions.logger} when one
     * was given, `console` otherwise.
     */
    public readonly logger: ILogger;

    /**
     * Stores the options and resolves the logger, leaving the broker connection to
     * the subclass.
     *
     * @param options - queue configuration; only `name` is required
     */
    protected constructor(
        /**
         * The options this queue was constructed with, kept so that accessors like
         * {@link BaseJobQueue.name} can read them back. Treat as read-only —
         * nothing re-reads them after the broker connection is made, so changing
         * one here has no effect on a running queue.
         */
        protected options: JobQueueOptions,
    ) {
        this.logger = options.logger || console;
    }

    /**
     * Name of this queue, as given in {@link JobQueueOptions.name}.
     */
    public get name(): string {
        return this.options.name;
    }

    /**
     * Starts processing the job queue.
     *
     * @returns this queue, once the broker connection is up
     */
    public async start(): Promise<T> {
        await this.imq.start();

        return this as any as T;
    }

    /**
     * Stops processing the job queue, leaving it able to start again.
     *
     * @returns this queue, once processing has stopped
     */
    public async stop(): Promise<T> {
        await this.imq.stop();

        return this as any as T;
    }

    /**
     * Destroys the job queue, closing the broker connection and releasing its
     * resources. Not reversible — construct a new queue to carry on.
     */
    public async destroy() {
        await this.imq.destroy();
    }
}

/**
 * Translates this package's options into the `@imqueue/core` options that back
 * them, applying the job-queue defaults where the caller said nothing.
 *
 * This is where the three deliberate departures from core's defaults live: safe
 * delivery on rather than off, a 10s rather than 5s safe-delivery TTL, and the
 * `imq-job` key prefix. Cleanup is pinned off — a job queue must not have its
 * keys swept out from under it.
 *
 * @param options - the queue's own configuration
 * @param logger - the already-resolved logger, so core and the queue share one
 * @returns core options ready to hand to `IMQ.create`
 */
function toIMQOptions(
    options: JobQueueOptions,
    logger: ILogger,
): Partial<IMQOptions> {
    return {
        cluster: options.cluster,
        username: options.username,
        password: options.password,
        cleanup: false,
        safeDelivery: typeof options.safe === 'undefined' ? true : options.safe,
        safeDeliveryTtl:
            typeof options.safeLockTtl === 'undefined'
                ? 10000
                : options.safeLockTtl,
        prefix: options.prefix || 'imq-job',
        verbose: options.verbose,
        verboseExtended: options.verboseExtended,
        logger,
    };
}

// noinspection JSUnusedGlobalSymbols
/**
 * The producing end of a job queue: pushes jobs and never handles them.
 *
 * Use this in the process that creates work — an API, a scheduler, a webhook
 * receiver — and pair it with a {@link JobQueueWorker} constructed with the same
 * {@link JobQueueOptions.name}. It opens a publisher-mode connection only, so it
 * cannot receive jobs even by accident.
 *
 * @example
 * ```typescript
 * import { JobQueuePublisher } from '@imqueue/job';
 *
 * const publisher = new JobQueuePublisher<Email>({ name: 'Email' });
 *
 * publisher.push({ to: 'a@b.c', subject: 'Hi' });
 * publisher.push({ to: 'a@b.c', subject: 'Tomorrow' }, { delay: 86400000 });
 * ```
 */
export class JobQueuePublisher<T>
    extends BaseJobQueue<JobQueuePublisher<T>, T>
    implements AnyJobQueuePublisher<JobQueuePublisher<T>, T>
{
    /**
     * Creates a publisher-mode queue over the named job queue.
     *
     * @param options - queue configuration; only `name` is required
     */
    public constructor(options: JobQueueOptions) {
        super(options);

        this.imq = IMQ.create(
            options.name,
            toIMQOptions(options, this.logger),
            IMQMode.PUBLISHER,
        );
    }

    /**
     * Enqueues one job, optionally delayed or time-limited.
     *
     * @param job - the job body, of whatever type this queue carries
     * @param options - when the job may run, and how long it stays retriable
     * @returns this queue, for chaining
     *
     * @remarks
     * Fire-and-forget, and worth being deliberate about: this returns
     * synchronously without waiting for the broker to accept the job, and a failed
     * enqueue is reported only by logging `[JobQueue] push error:` through
     * {@link JobQueueOptions.logger}. It neither throws nor hands back anything to
     * await, so a caller that must know the job was really enqueued cannot learn it
     * from here — watch the log, or check for the job's effects.
     *
     * There is no need to `start()` a publisher first; the underlying send opens
     * the connection on demand.
     */
    public push(job: T, options?: PushOptions): JobQueuePublisher<T> {
        options = options || ({} as PushOptions);

        this.imq
            .send(
                this.name,
                {
                    job: job as unknown as AnyJson,
                    ...(options.ttl
                        ? { expire: Date.now() + options.ttl }
                        : {}),
                    ...(options.delay ? { delay: options.delay } : {}),
                },
                options.delay,
            )
            .catch(err => this.logger.log('[JobQueue] push error:', err));

        return this;
    }
}

// noinspection JSUnusedGlobalSymbols
/**
 * The consuming end of a job queue: handles jobs and never pushes them.
 *
 * Use this in the processes that do the work, paired with a
 * {@link JobQueuePublisher} constructed with the same
 * {@link JobQueueOptions.name}. Run as many as you like — each job goes to one of
 * them, which is how this scales out. It opens a worker-mode connection only, so
 * it cannot enqueue jobs even by accident.
 *
 * @example
 * ```typescript
 * import { JobQueueWorker } from '@imqueue/job';
 *
 * const worker = new JobQueueWorker<Email>({ name: 'Email' });
 *
 * worker.onPop(async (email: Email) => {
 *     await send(email);
 * });
 *
 * await worker.start();
 * ```
 */
export class JobQueueWorker<T>
    extends BaseJobQueue<JobQueueWorker<T>, T>
    implements AnyJobQueueWorker<JobQueueWorker<T>, T>
{
    /**
     * Creates a worker-mode queue over the named job queue.
     *
     * @param options - queue configuration; only `name` is required
     */
    public constructor(options: JobQueueOptions) {
        super(options);

        this.imq = IMQ.create(
            options.name,
            toIMQOptions(options, this.logger),
            IMQMode.WORKER,
        );
    }

    /**
     * Registers the handler called for each job popped from this queue.
     *
     * @param handler - what to do with each job; its return value re-schedules
     * @returns this queue, for chaining
     *
     * @remarks
     * Replaces any handler already registered rather than adding to it — there is
     * one handler per worker, and the last call wins. Nothing is delivered until
     * {@link BaseJobQueue.start} has been called, so registering the handler first
     * and starting second is the order that cannot drop a job.
     *
     * A message that is not an object — `null`, `undefined` or a bare primitive,
     * none of which this package produces — is logged as invalid and dropped
     * without reaching the handler, so the handler can assume it is being given a
     * job rather than having to guard for one.
     *
     * See {@link JobQueuePopHandler} for what the handler's return value does,
     * which is where this queue's retry behaviour is decided.
     */
    public onPop(handler: JobQueuePopHandler<T>): JobQueueWorker<T> {
        this.handler = handler;
        this.imq.removeAllListeners('message');
        this.imq.on('message', async (message: any) => {
            if (typeof message !== 'object' || !message) {
                this.logger.warn(
                    '[JobQueue] Invalid message received, skipping:',
                    JSON.stringify(message),
                );

                return;
            }

            const { job, expire, delay } = message;
            let rescheduleDelay: number | void | undefined | Promise<any>;

            try {
                rescheduleDelay = this.handler?.(job);

                if (
                    rescheduleDelay &&
                    typeof rescheduleDelay === 'object' &&
                    rescheduleDelay &&
                    (rescheduleDelay as any).then
                ) {
                    // it's promise
                    rescheduleDelay = await rescheduleDelay;
                }
            } catch (err) {
                rescheduleDelay = delay;
                this.logger.log('[JobQueue] Error handling job:', err);
            }

            if (typeof expire === 'number' && expire <= Date.now()) {
                return; // remove job from queue
            }

            if (typeof rescheduleDelay === 'number' && rescheduleDelay >= 0) {
                await this.imq.send(this.name, message, rescheduleDelay);
            }
        });

        return this;
    }
}

// noinspection JSUnusedGlobalSymbols
/**
 * A job queue that both pushes and handles jobs in the same process — the default
 * export, and the one to start with.
 *
 * Scheduling is per job and optional: push with no options to run as soon as a
 * worker is free, with {@link PushOptions.delay} to run later, and with
 * {@link PushOptions.ttl} to stop retrying after a while. Register the handler
 * with {@link JobQueue.onPop} before {@link JobQueue.start} — this class insists
 * on it, because a combined queue with no handler would enqueue work that nothing
 * consumes.
 *
 * Split the two ends into {@link JobQueuePublisher} and {@link JobQueueWorker} when
 * they belong in different processes, which is what scaling the workers out
 * requires.
 *
 * @remarks
 * On SIGTERM, SIGINT or SIGABRT the underlying `@imqueue/core` queue releases its
 * watcher locks and exits the process. That is orderly, but it is not a drain: a
 * handler still running is not awaited, so the job it was working on loses that
 * attempt. Do the draining yourself if a half-finished job would leave a mess.
 *
 * @example
 * ```typescript
 * import JobQueue from '@imqueue/job';
 *
 * const queue = new JobQueue<Email>({ name: 'Email' });
 *
 * queue.onPop(async (email: Email) => {
 *     await send(email);
 * });
 *
 * await queue.start();
 *
 * queue.push({ to: 'a@b.c', subject: 'Hi' });
 * ```
 */
export default class JobQueue<T>
    extends BaseJobQueue<JobQueue<T>, T>
    implements
        AnyJobQueueWorker<JobQueue<T>, T>,
        AnyJobQueuePublisher<JobQueue<T>, T>
{
    /**
     * Creates a queue that both publishes and consumes the named job queue.
     *
     * @param options - queue configuration; only `name` is required
     */
    public constructor(options: JobQueueOptions) {
        super(options);

        this.imq = IMQ.create(options.name, toIMQOptions(options, this.logger));
    }

    /**
     * Starts processing the job queue, refusing to start without a handler.
     *
     * @returns this queue, once the broker connection is up
     * @throws TypeError if no handler has been registered with
     * {@link JobQueue.onPop} — a combined queue with nothing to consume its own
     * jobs is treated as a mistake rather than started
     */
    public override async start(): Promise<JobQueue<T>> {
        if (!this.handler) {
            throw new TypeError(
                '[JobQueue] Message handler is not set, can not start job queue!',
            );
        }

        return await super.start();
    }

    /**
     * Enqueues one job, optionally delayed or time-limited, refusing to enqueue
     * without a handler.
     *
     * @param job - the job body, of whatever type this queue carries
     * @param options - when the job may run, and how long it stays retriable
     * @returns this queue, for chaining
     * @throws TypeError if no handler has been registered with
     * {@link JobQueue.onPop}
     *
     * @remarks
     * The handler check is the only difference from
     * {@link JobQueuePublisher.push}, whose caveats all apply here too — most
     * importantly that a successful call means the job was handed off, not that the
     * broker accepted it. A broker failure is logged, not thrown.
     */
    public push(job: T, options?: PushOptions): JobQueue<T> {
        if (!this.handler) {
            throw new TypeError(
                '[JobQueue] Message handler is not set, can not enqueue data!',
            );
        }

        return JobQueuePublisher.prototype.push.call(
            this as unknown as JobQueuePublisher<T>,
            job,
            options,
        ) as unknown as JobQueue<T>;
    }

    /**
     * Registers the handler called for each job popped from this queue.
     *
     * @param handler - what to do with each job; its return value re-schedules
     * @returns this queue, for chaining
     *
     * @remarks
     * Required before {@link JobQueue.start} or {@link JobQueue.push}, both of
     * which throw without it. Replaces any handler already registered — the last
     * call wins. See {@link JobQueuePopHandler} for what its return value does.
     */
    public onPop(handler: JobQueuePopHandler<T>): JobQueue<T> {
        return JobQueueWorker.prototype.onPop.call(
            this as unknown as JobQueueWorker<T>,
            handler,
        ) as unknown as JobQueue<T>;
    }
}
