/*!
 * Job Queue for @imqueue framework
 *
 * Copyright (c) 2018, imqueue.com <support@imqueue.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */
import IMQ, { AnyJson, ILogger, IMessageQueue } from '@imqueue/core';

export interface JobQueueOptions {
    name: string;
    cluster?: { host: string; port: number; }[];
    logger?: ILogger;
    safe?: boolean;
    safeLockTtl?: number;
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

// noinspection JSUnusedGlobalSymbols
/**
 * Implements simple scheduled job queue. Job scheduling is optional. It may
 * process jobs immediately or after specified delay for particular job.
 * It also allows to define max lifetime of the job in a queue, after which
 * the job is removed from a queue.
 * Supports graceful shutdown, if TERM or SIGINT is sent to the process.
 */
export default class JobQueue<T> {
    private imq: IMessageQueue;
    private handler: JobQueuePopHandler<T>;
    private options: JobQueueOptions;
    private readonly logger: ILogger;

    /**
     * Constructor. Instantiates new JobQueue instance.
     *
     * @constructor
     * @param {JobQueueOptions} options
     */
    public constructor(options: JobQueueOptions) {
        this.logger = options.logger || console;
        this.options = options;

        this.imq = IMQ.create(options.name, {
            cluster: options.cluster,
            cleanup: false,
            safeDelivery: options.safe,
            safeDeliveryTtl: options.safeLockTtl,
            logger: this.logger,
            prefix: options.prefix || 'job-queue',
        });
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
     * @return {Promise<JobQueue<T>>} - this queue
     */
    public async start(): Promise<JobQueue<T>> {
        if (!this.handler) {
            throw new TypeError(
                'Message handler is not set, can not start job queue!',
            );
        }

        await this.imq.start();

        return this;
    }

    /**
     * Stops processing job queue
     *
     * @return {Promise<JobQueue<T>>} - this queue
     */
    public async stop(): Promise<JobQueue<T>> {
        await this.imq.stop();

        return this;
    }

    /**
     * Destroys job queue
     *
     * @return {Promise<void>}
     */
    public async destroy() {
        await this.imq.destroy();
    }

    /**
     * Pushes new job to this queue
     *
     * @param {T} job - job data itself of user defined type
     * @param {PushOptions} options - push options, like delay and ttl for job
     * @return {Promise<JobQueue<T>>} - this queue
     */
    public push(job: T, options?: PushOptions) {
        options = options || {} as PushOptions;

        if (!this.handler) {
            throw new TypeError(
                'Message handler is not set, can not enqueue data!',
            );
        }

        this.imq.send(this.name, {
            job: job as unknown as AnyJson,
            ...(options.ttl ? { expire: Date.now() + options.ttl } : {}),
            ...(options.delay ? { delay: options.delay } : {}),
        }, options.delay).catch(err =>
            this.logger.log('JobQueue push error:', err),
        );

        return this;
    }

    /**
     * Sets up job handler, which is called when the job is popped from this
     * queue.
     *
     * @param {JobQueuePopHandler<T>} handler - job pop handler
     * @return {JobQueue<T>} - this queue
     */
    public onPop(handler: JobQueuePopHandler<T>): JobQueue<T> {
        this.handler = handler;
        this.imq.removeAllListeners('message');
        this.imq.on('message', async (message: any) => {
            const { job, expire, delay } = message;
            let rescheduleDelay: number | void | undefined | Promise<any>;

            if (typeof expire === 'number' && expire <= Date.now()) {
                return ; // remove job from queue
            }

            try {
                rescheduleDelay = this.handler(job);

                if (rescheduleDelay &&
                    typeof rescheduleDelay === 'object' &&
                    rescheduleDelay.then
                ) {
                    // it's promise
                    rescheduleDelay = await rescheduleDelay;
                }
            } catch (err) {
                rescheduleDelay = delay;
                this.logger.log('Error handling job:', err);
            }

            if (typeof rescheduleDelay === 'number' && rescheduleDelay >= 0) {
                await this.imq.send(this.name, message, rescheduleDelay);
            }
        });

        return this;
    }
}
