/*!
 * Graceful drain: configuration parsing and signal-handler lifecycle.
 *
 * The behavioural half lives in `JobQueue.drain.spec.ts`, which drives real
 * processes with real signals. This file covers what is observable without
 * exiting.
 */
import './mocks/index.js';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import JobQueue, {
    JobQueuePublisher,
    JobQueueWorker,
    DEFAULT_IMQ_DRAIN_TIMEOUT,
} from '../index.js';
import { logger } from './mocks/index.js';

describe('JobQueue drain configuration', () => {
    const saved = { ...process.env };
    const keys = ['IMQ_DRAIN_ENABLE', 'IMQ_DRAIN_TIMEOUT', 'IMQ_DRAIN_REQUEUE'];

    beforeEach(() => {
        for (const key of keys) {
            delete process.env[key];
        }
    });

    afterEach(() => {
        for (const key of keys) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    });

    it('should default to off, allocating no tracking state', async () => {
        const queue: any = new JobQueue({ name: 'DrainOff', logger });

        queue.onPop(() => undefined);

        assert.equal(queue.drains, false);
        assert.equal(
            queue.inFlight,
            undefined,
            'the default path must not allocate a tracking set',
        );
        assert.notEqual(
            queue.imq.options.handleSignals,
            false,
            'the queue layer keeps its own signal handling when drain is off',
        );

        await queue.destroy();
    });

    it('should enable through IMQ_DRAIN_ENABLE=1', async () => {
        process.env.IMQ_DRAIN_ENABLE = '1';

        const queue: any = new JobQueue({ name: 'DrainEnv', logger });

        assert.equal(queue.drains, true);
        assert.ok(queue.inFlight instanceof Set);
        assert.equal(queue.drainTimeout, DEFAULT_IMQ_DRAIN_TIMEOUT);
        assert.equal(queue.drainRequeues, true);
        assert.equal(
            queue.imq.options.handleSignals,
            false,
            'the queue layer must not exit the process from under a drain',
        );

        await queue.destroy();
    });

    it('should enable through constructor options', async () => {
        const queue: any = new JobQueue({
            name: 'DrainOption',
            logger,
            drain: true,
            drainTimeout: 1234,
            drainRequeue: false,
        });

        assert.equal(queue.drains, true);
        assert.equal(queue.drainTimeout, 1234);
        assert.equal(queue.drainRequeues, false);

        await queue.destroy();
    });

    it('should let the constructor option override the environment', async () => {
        process.env.IMQ_DRAIN_ENABLE = '1';

        const queue: any = new JobQueue({
            name: 'DrainOverride',
            logger,
            drain: false,
        });

        assert.equal(queue.drains, false);
        assert.equal(queue.inFlight, undefined);

        await queue.destroy();
    });

    it('should read IMQ_DRAIN_TIMEOUT and IMQ_DRAIN_REQUEUE', async () => {
        process.env.IMQ_DRAIN_ENABLE = '1';
        process.env.IMQ_DRAIN_TIMEOUT = '2500';
        process.env.IMQ_DRAIN_REQUEUE = '0';

        const queue: any = new JobQueue({ name: 'DrainVars', logger });

        assert.equal(queue.drainTimeout, 2500);
        assert.equal(queue.drainRequeues, false);

        await queue.destroy();
    });

    it('should fail loudly on a non-numeric IMQ_DRAIN_ENABLE', () => {
        // `true` coerces to NaN under the numeric IMQ_* convention, so reading
        // it as "off" would leave the feature quietly inert
        process.env.IMQ_DRAIN_ENABLE = 'true';

        assert.throws(
            () => new JobQueue({ name: 'DrainBad', logger }),
            /IMQ_DRAIN_ENABLE must be 0 or 1/,
        );
    });

    it('should fail loudly on an unusable IMQ_DRAIN_TIMEOUT', () => {
        process.env.IMQ_DRAIN_ENABLE = '1';

        for (const bad of ['soon', '0', '-1']) {
            process.env.IMQ_DRAIN_TIMEOUT = bad;

            assert.throws(
                () => new JobQueue({ name: 'DrainBadTtl', logger }),
                /IMQ_DRAIN_TIMEOUT must be a positive number/,
                `"${bad}" must be rejected`,
            );
        }
    });
});

describe('JobQueue drain signal lifecycle', () => {
    it('should install nothing when draining is off', async () => {
        const baseline = process.listenerCount('SIGTERM');
        const queue: any = new JobQueue({ name: 'NoSignals', logger });

        assert.equal(
            process.listenerCount('SIGTERM'),
            baseline,
            'this package installs no handler of its own with drain off',
        );

        await queue.destroy();
    });

    it('should share one handler across every drainable queue', async () => {
        const foreign = (): void => undefined;

        process.on('SIGTERM', foreign);

        const baseline = process.listenerCount('SIGTERM');
        const worker: any = new JobQueueWorker({
            name: 'SharedA',
            logger,
            drain: true,
        });
        const publisher: any = new JobQueuePublisher({
            name: 'SharedB',
            logger,
            drain: true,
        });

        // one handler for the process, not one per queue: otherwise the first
        // queue to finish draining would exit out from under the second
        assert.equal(
            process.listenerCount('SIGTERM'),
            baseline + 1,
            'two drainable queues must share a single handler',
        );

        await worker.destroy();

        assert.equal(
            process.listenerCount('SIGTERM'),
            baseline + 1,
            'the handler stays while anything is still drainable',
        );

        await publisher.destroy();

        assert.equal(
            process.listenerCount('SIGTERM'),
            baseline,
            'the last destroy takes the handler back off',
        );
        assert.ok(
            process.listeners('SIGTERM').includes(foreign),
            'a foreign handler must be left alone throughout',
        );

        process.removeListener('SIGTERM', foreign);
    });
});
