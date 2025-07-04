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
import IMQ, {
    AnyJson,
    ILogger,
    IMessageQueue,
    IMQMode,
    IMQOptions,
} from '@imqueue/core';

/**
 * Job queues options
 */
export interface JobQueueOptions {
    /**
     * Name of the job queue. In worker/publisher mode worker and
     * publisher must share the same job queue name.
     * Mandatory.
     *
     * @type {string}
     */
    name: string;

    /**
     * Connection params of the queue engine cluster (typically -
     * host and port). By default the broker is redis.
     * Optional.
     * By default is [{ host: "localhost", port: 6379 }].
     *
     * @type {Array<{host: string, port: number}>}
     */
    cluster?: { host: string; port: number; }[];

    /**
     * Logger to be used for producing log and error messages.
     * Optional.
     * By default is console.
     *
     * @type {ILogger}
     */
    logger?: ILogger;

    /**
     * Safe message delivery or not? When safe delivery is enabled (by default)
     * queue is processing jobs with guarantied job data delivery. If process
     * fails or dies - job data is re-queued for future processing by another
     * worker.
     * Optional.
     * Default is true.
     *
     * @type {boolean}
     */
    safe?: boolean;

    /**
     * TTL in milliseconds of the job in worker queue during safe delivery.
     * If worker does not finish processing after this TTL - job is re-queued
     * for other workers to be processed.
     * Optional.
     * By default is 10000.
     */
    safeLockTtl?: number;

    /**
     * Job queue prefix in queue broker.
     * Optional.
     * By default is "imq-job".
     */
    prefix?: string;
}

export interface JobQueuePopHandler<T> {
    /**
     * Handles popped from a queue job. If it throws error job will be
     * re-scheduled with the same delay as it was pushed into queue,
     * If it returns positive number it will be treated as new delay to
     * re-schedule message in the queue. Normally, if re-schedule is not needed
     * it should return nothing (undefined, void return).
     * If worker goes down during the job processing, job will be re-scheduled
     * after configured by options safeLockTtl.
     *
     * @example
     * ```typescript
     * // job logged and not re-scheduled (normal typical job processing)
     * queue.onPop(job => {
     *     console.log(job);
     * });
     * // job logged and re-schedule immediately
     * queue.onPop(job => {
     *     console.log(job);
     *     return 0;
     * });
     * // job logged and not re-scheduled (normal typical job processing)
     * queue.onPop(job => {
     *     console.log(job);
     *     return -1;
     * });
     * // job re-scheduled with the initial delay (job throws)
     * queue.on(job => {
     *     throw new Error('Job error');
     * });
     * // job re-scheduled with new delay of 1 second
     * queue.onPop(job => {
     *     console.log(job);
     *     return 1000; // re-run after 1 second
     * });
     * ```
     *
     * @param {T} job
     * @return {Promise<number | void>}
     */
    (job: T): number | void | Promise<number | void>;
}

export interface PushOptions {
    /**
     * Delay before message to be processed by workers
     */
    delay?: number;
    /**
     * Time to live for message in queue in milliseconds
     */
    ttl?: number;
}

export interface AnyJobQueue<T> {
    name: string;
    readonly logger: ILogger;
    start(): Promise<T>;
    stop(): Promise<T>;
    destroy(): Promise<void>;
}

export interface AnyJobQueueWorker<T, U> {
    onPop(handler: JobQueuePopHandler<U>): T;
}

export interface AnyJobQueuePublisher<T, U> {
    push(job: U, options?: PushOptions): T;
}

/**
 * Abstract job queue, handles base implementations of AnyJobQueue interface.
 */
export abstract class BaseJobQueue<T, U> implements AnyJobQueue<T> {
    protected imq: IMessageQueue;
    protected handler: JobQueuePopHandler<U>;

    public readonly logger: ILogger;

    protected constructor(
        protected options: JobQueueOptions,
    ) {
        this.logger = options.logger || console;
    }

    /**
     * Full name of this queue
     *
     * @type {string}
     */
    public get name(): string {
        return this.options.name;
    }

    /**
     * Starts processing job queue
     *
     * @return {Promise<T>} - this queue
     */
    public async start(): Promise<T> {
        await this.imq.start();

        return this as any as T;
    }

    /**
     * Stops processing job queue
     *
     * @return {Promise<T>} - this queue
     */
    public async stop(): Promise<T> {
        await this.imq.stop();

        return this as any as T;
    }

    /**
     * Destroys job queue
     *
     * @return {Promise<void>}
     */
    public async destroy() {
        await this.imq.destroy();
    }
}

/**
 * Creates and returns IMQOptions derived from a given JobQueueOptions
 *
 * @param {JobQueueOptions} options
 * @param {ILogger} logger
 * @return {Partial<IMQOptions>}
 * @private
 */
function toIMQOptions(
    options: JobQueueOptions,
    logger: ILogger,
): Partial<IMQOptions> {
    return {
        cluster: options.cluster,
        cleanup: false,
        safeDelivery: typeof options.safe === 'undefined'
            ? true : options.safe,
        safeDeliveryTtl: typeof options.safeLockTtl === 'undefined'
            ? 10000 : options.safeLockTtl,
        prefix: options.prefix || 'imq-job',
        logger,
    };
}

// noinspection JSUnusedGlobalSymbols
/**
 * Implements simple scheduled job queue publisher. Job queue publisher is only
 * responsible for pushing queue messages.
 */
export class JobQueuePublisher<T> extends BaseJobQueue<JobQueuePublisher<T>, T>
implements AnyJobQueuePublisher<JobQueuePublisher<T>, T>
{
    /**
     * Constructor. Instantiates new JobQueue instance.
     *
     * @constructor
     * @param {JobQueueOptions} options
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
     * Pushes new job to this queue
     *
     * @param {T} job - job data itself of user defined type
     * @param {PushOptions} options - push options, like delay and ttl for job
     * @return {JobQueue<T>} - this queue
     */
    public push(job: T, options?: PushOptions): JobQueuePublisher<T> {
        options = options || {} as PushOptions;

        this.imq.send(this.name, {
            job: job as unknown as AnyJson,
            ...(options.ttl ? { expire: Date.now() + options.ttl } : {}),
            ...(options.delay ? { delay: options.delay } : {}),
        }, options.delay).catch(err =>
            this.logger.log('JobQueue push error:', err),
        );

        return this;
    }
}

// noinspection JSUnusedGlobalSymbols
/**
 * Implements simple scheduled job queue worker. Job queue worker is only
 * responsible for processing queue messages.
 */
export class JobQueueWorker<T> extends BaseJobQueue<JobQueueWorker<T>, T>
    implements AnyJobQueueWorker<JobQueueWorker<T>, T>
{
    /**
     * Constructor. Instantiates new JobQueue instance.
     *
     * @constructor
     * @param {JobQueueOptions} options
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
     * Sets up job handler, which is called when the job is popped from this
     * queue.
     *
     * @param {JobQueuePopHandler<T>} handler - job pop handler
     * @return {JobQueueWorker<T>} - this queue
     */
    public onPop(handler: JobQueuePopHandler<T>): JobQueueWorker<T> {
        this.handler = handler;
        this.imq.removeAllListeners('message');
        this.imq.on('message', async (message: any) => {
            const { job, expire, delay } = message;
            let rescheduleDelay: number | void | undefined | Promise<any>;

            try {
                rescheduleDelay = this.handler(job);

                if (rescheduleDelay &&
                    typeof rescheduleDelay === 'object' &&
                    rescheduleDelay &&
                    (rescheduleDelay as any).then
                ) {
                    // it's promise
                    rescheduleDelay = await rescheduleDelay;
                }
            } catch (err) {
                rescheduleDelay = delay;
                this.logger.log('Error handling job:', err);
            }

            if (typeof expire === 'number' && expire <= Date.now()) {
                return ; // remove job from queue
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
 * Implements simple scheduled job queue. Job scheduling is optional. It may
 * process jobs immediately or after specified delay for particular job.
 * It also allows to define max lifetime of the job in a queue, after which
 * the job is removed from a queue.
 * Supports graceful shutdown, if TERM or SIGINT is sent to the process.
 */
export default class JobQueue<T> extends BaseJobQueue<JobQueue<T>, T>
implements
    AnyJobQueueWorker<JobQueue<T>, T>,
    AnyJobQueuePublisher<JobQueue<T>, T>
{
    /**
     * Constructor. Instantiates new JobQueue instance.
     *
     * @constructor
     * @param {JobQueueOptions} options
     */
    public constructor(options: JobQueueOptions) {
        super(options);

        this.imq = IMQ.create(options.name, toIMQOptions(options, this.logger));
    }

    /**
     * Starts processing job queue. Throws if handler is not set before start.
     *
     * @throws {TypeError}
     * @return {Promise<T>} - this queue
     */
    public async start(): Promise<JobQueue<T>> {
        if (!this.handler) {
            throw new TypeError(
                'Message handler is not set, can not start job queue!',
            );
        }

        return await super.start();
    }

    /**
     * Pushes new job to this queue. Throws if handler is not set.
     *
     * @throws {TypeError}
     * @param {T} job - job data itself of user defined type
     * @param {PushOptions} options - push options, like delay and ttl for job
     * @return {JobQueue<T>} - this queue
     */
    public push(job: T, options?: PushOptions): JobQueue<T> {
        if (!this.handler) {
            throw new TypeError(
                'Message handler is not set, can not enqueue data!',
            );
        }

        return JobQueuePublisher.prototype.push.call(this, job, options);
    }

    /**
     * Sets up job handler, which is called when the job is popped from this
     * queue.
     *
     * @param {JobQueuePopHandler<T>} handler - job pop handler
     * @return {JobQueue<T>} - this queue
     */
    public onPop(handler: JobQueuePopHandler<T>): JobQueue<T> {
        return JobQueueWorker.prototype.onPop.call(this, handler);
    }
}
