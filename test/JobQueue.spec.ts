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
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox, spy as makeSpy } from './mocks/spy.js';
import './mocks/index.js';
import { logger } from './mocks/index.js';
import JobQueue from '../index.js';

/** A logger of its own per test, so no other queue's line can be counted */
const capturing = (): any => {
    const captured: any = { info: [], warn: [], error: [] };
    const join = (args: any[]): string =>
        args.map(arg => String(arg)).join(' ');

    captured.logger = {
        log: () => undefined,
        info: (...args: any[]) => captured.info.push(join(args)),
        warn: (...args: any[]) => captured.warn.push(join(args)),
        error: (...args: any[]) => captured.error.push(join(args)),
    };

    return captured;
};

describe('JobQueue', () => {
    it('should be a class', () => {
        assert.equal(typeof JobQueue, 'function');
    });

    describe('constructor()', () => {
        it('should throw if name is not provided', () => {
            assert.throws(() => new (JobQueue as any)());
        });

        it('should not throw if name provided as minimum options', () => {
            assert.doesNotThrow(() => new JobQueue({ name: 'Test' }));
        });

        it('should use given logger', () => {
            const queue: any = new JobQueue({ name: 'Test', logger });
            assert.equal(queue.logger, logger);
        });

        it('should use console as default logger', () => {
            const queue: any = new JobQueue({ name: 'Test' });
            assert.equal(queue.logger, console);
        });
    });

    describe('name', () => {
        it('should match to given name', () => {
            assert.equal(new JobQueue({ name: 'TestName' }).name, 'TestName');
        });

        it('should be read-only', () => {
            const queue: any = new JobQueue({ name: 'Test' });

            assert.throws(() => (queue.name = 'TestName'));
        });
    });

    describe('start()', () => {
        let queue: JobQueue<any>;

        beforeEach(() => (queue = new JobQueue<any>({ name: 'Test', logger })));
        afterEach(async () => await queue.destroy());

        it('should throw if handler is not set', async () => {
            let err: any;

            try {
                await queue.start();
            } catch (e) {
                err = e;
            }

            assert.notEqual(err, undefined);
        });

        it('should not throw if handler is set', async () => {
            let err: any;

            (queue as any).handler = () => {};
            try {
                await queue.start();
            } catch (e) {
                err = e;
            }

            assert.equal(err, undefined);
        });

        it('should return this queue', async () => {
            (queue as any).handler = () => {};

            const res = await queue.start();

            assert.equal(res, queue);
        });

        it('should actually start', async () => {
            const spy = makeSpy((queue as any).imq, 'start');

            (queue as any).handler = () => {};
            await queue.start();

            assert.equal(spy.calledOnce, true);
            spy.restore();
        });
    });

    describe('stop()', () => {
        let queue: JobQueue<any>;

        beforeEach(() => (queue = new JobQueue<any>({ name: 'Test', logger })));
        afterEach(async () => await queue.destroy());

        it('should return this queue', async () => {
            const res = await queue.stop();

            assert.equal(res, queue);
        });

        it('should actually stop', async () => {
            const spy = makeSpy((queue as any).imq, 'stop');

            await queue.stop();

            assert.equal(spy.calledOnce, true);
            spy.restore();
        });
    });

    describe('destroy()', () => {
        let queue: JobQueue<any>;

        beforeEach(() => (queue = new JobQueue<any>({ name: 'Test', logger })));
        afterEach(async () => await queue.destroy());

        it('should return undefined', async () => {
            const res = await queue.destroy();

            assert.equal(res, undefined);
        });

        it('should actually destroy', async () => {
            const spy = makeSpy((queue as any).imq, 'destroy');

            await queue.destroy();

            assert.equal(spy.calledOnce, true);
            spy.restore();
        });
    });

    describe('push()', () => {
        let queue: JobQueue<any>;

        beforeEach(() => (queue = new JobQueue<any>({ name: 'Test', logger })));
        afterEach(async () => await queue.destroy());

        it('should throw if handler is not set', async () => {
            let err: any;

            try {
                await queue.push('');
            } catch (e) {
                err = e;
            }

            assert.notEqual(err, undefined);
        });

        it('should not throw if handler is set', async () => {
            let err: any;

            (queue as any).handler = () => {};
            try {
                await queue.push('');
            } catch (e) {
                err = e;
            }

            assert.equal(err, undefined);
        });

        it('should actually push', async () => {
            const spy = makeSpy((queue as any).imq, 'send');

            (queue as any).handler = () => {};
            await queue.push('');

            assert.equal(spy.calledOnce, true);
            spy.restore();
        });

        it('should actually push with given ttl and delay', async () => {
            const spy = makeSpy((queue as any).imq, 'send');

            (queue as any).handler = () => {};
            const now = Date.now();
            await queue.push('', { ttl: 100, delay: 10 });
            const [[name, { job, expire, delay }, jobDelay]] = spy.args;

            assert.equal(name, 'Test');
            assert.equal(job, '');
            assert.ok(expire <= now + 101);
            assert.ok(expire >= now + 100);
            assert.equal(delay, 10);
            assert.equal(jobDelay, 10);

            spy.restore();
        });

        it('should report a rejected enqueue with its scheduling', async () => {
            const cap = capturing();
            const own = new JobQueue<any>({ name: 'Own', logger: cap.logger });
            const send = makeSpy((own as any).imq, 'send').rejects(
                new Error('WRONGTYPE customer 000-00-0000'),
            );

            (own as any).handler = () => {};
            await own.push({ ssn: '000-00-0000' }, { ttl: 100, delay: 10 });
            await new Promise(resolve => setImmediate(resolve));

            assert.equal(cap.error.length, 1);
            assert.match(cap.error[0], /\[JobQueue\] push error/);
            assert.match(cap.error[0], /queue Own/);
            assert.match(cap.error[0], /delay 10/);
            assert.match(cap.error[0], /ttl 100/);
            assert.match(cap.error[0], /code WRONGTYPE/);
            assert.equal(cap.error[0].includes('000-00-0000'), false);

            send.restore();
            await own.destroy();
        });

        it('should write one line when core delivers one failure twice', async () => {
            const cap = capturing();
            const own = new JobQueue<any>({ name: 'Own', logger: cap.logger });
            const send = makeSpy((own as any).imq, 'send');

            (own as any).handler = () => {};
            await own.push('x');

            const report = send.args[0][3];

            assert.equal(
                typeof report,
                'function',
                'core must be given an error handler for the write',
            );
            assert.doesNotThrow(() => report(new Error('OOM nope')));
            assert.doesNotThrow(() => report(new Error('OOM nope')));

            const matched = cap.error.filter((one: string) =>
                /\[JobQueue\] push error/.test(one),
            );

            assert.equal(
                matched.length,
                1,
                'a doubly-delivered failure must write one line',
            );
            assert.match(matched[0], /delay none/);
            assert.match(matched[0], /ttl none/);
            assert.match(matched[0], /code OOM/);

            send.restore();
            await own.destroy();
        });

        it('should report every failed push separately', async () => {
            const cap = capturing();
            const own = new JobQueue<any>({ name: 'Own', logger: cap.logger });
            const send = makeSpy((own as any).imq, 'send');

            (own as any).handler = () => {};
            await own.push('x');
            await own.push('y', { delay: 500 });

            (send.args[0][3] as any)(new Error('OOM nope'));
            (send.args[1][3] as any)(new Error('OOM nope'));

            const matched = cap.error.filter((one: string) =>
                /\[JobQueue\] push error/.test(one),
            );

            // one line per failed push: no aggregation across pushes
            assert.equal(matched.length, 2);
            assert.match(matched[0], /delay none/);
            assert.match(matched[1], /delay 500/);

            send.restore();
            await own.destroy();
        });

        it('should survive a broken logger while reporting', async () => {
            const broken: any = {
                log: () => {},
                info: () => {},
                warn: () => {},
                error: () => {
                    throw new Error('logger is broken');
                },
            };
            const brokenQueue = new JobQueue<any>({
                name: 'Broken',
                logger: broken,
            });
            const send = makeSpy((brokenQueue as any).imq, 'send');

            (brokenQueue as any).handler = () => {};
            await brokenQueue.push('x');

            assert.doesNotThrow(() => send.args[0][3](new Error('boom')));

            send.restore();
            await brokenQueue.destroy();
        });
    });

    describe('onPop', () => {
        let queue: JobQueue<any>;

        beforeEach(() => (queue = new JobQueue<any>({ name: 'Test', logger })));
        afterEach(async () => await queue.destroy());

        it('should properly set handler', () => {
            const handler = () => {};

            queue.onPop(handler);
            queue.onPop(handler);

            assert.equal((queue as any).handler, handler);
            assert.equal((queue as any).imq.listenerCount('message'), 1);
        });
    });

    // The 'message' listener, reached directly rather than through emit(). It is
    // an async function, so as an event handler a rejection would escape as an
    // unhandled rejection — invisible to assert.rejects and liable to take the
    // whole process down. Calling it gives us the promise to assert on.
    describe("the 'message' listener", () => {
        const sandbox = createSandbox();
        let queue: JobQueue<any>;

        const deliver = (message: any): Promise<void> =>
            (queue as any).imq.listeners('message')[0](message);
        const deliver2 = (message: any, id: string): Promise<void> =>
            (queue as any).imq.listeners('message')[0](message, id);

        beforeEach(() => (queue = new JobQueue<any>({ name: 'Test', logger })));
        afterEach(async () => {
            sandbox.restore();
            await queue.destroy();
        });

        // Everything the guard is meant to reject. null and undefined used to
        // throw from the destructuring on the line after the warning; the
        // primitives destructured to all-undefined and reached the handler as
        // though `undefined` were a real job.
        for (const [label, message] of [
            ['null', null],
            ['undefined', undefined],
            ['a string', 'not a job'],
            ['a number', 42],
            ['a boolean', true],
        ] as [string, any][]) {
            it(`should warn and skip ${label}`, async () => {
                const handler = sandbox.spy();
                const warn = sandbox.spy(logger, 'warn');
                const send = sandbox.spy((queue as any).imq, 'send');

                queue.onPop(handler as any);

                await assert.doesNotReject(() => deliver(message));

                assert.equal(handler.called, false, 'handler must not run');
                assert.equal(warn.calledOnce, true, 'must warn once');
                assert.equal(send.called, false, 'must not re-queue');
            });
        }

        it('should hand a valid message to the handler', async () => {
            const handler = sandbox.spy();
            const warn = sandbox.spy(logger, 'warn');

            queue.onPop(handler as any);
            await deliver({ job: { id: 1 } });

            assert.equal(handler.calledOnce, true);
            assert.deepEqual(handler.args[0][0], { id: 1 });
            assert.equal(warn.called, false);
        });

        it('should re-schedule with the delay the handler returns', async () => {
            const send = sandbox.spy((queue as any).imq, 'send');
            const message = { job: 'x' };

            queue.onPop(() => 1000);
            await deliver(message);

            assert.equal(send.calledOnce, true);
            assert.deepEqual(send.args[0].slice(0, 3), ['Test', message, 1000]);
            assert.equal(
                typeof send.args[0][3],
                'function',
                'a late write failure must be reported through core',
            );
        });

        it('should re-schedule with the original delay when the handler throws', async () => {
            const send = sandbox.spy((queue as any).imq, 'send');
            const message = { job: 'x', delay: 250 };

            queue.onPop(() => {
                throw new Error('Job error');
            });
            await deliver(message);

            assert.equal(send.calledOnce, true);
            assert.deepEqual(send.args[0].slice(0, 3), ['Test', message, 250]);
            assert.equal(typeof send.args[0][3], 'function');
        });

        it('should report a failed handler with what happens next', async () => {
            const cap = capturing();
            const own = new JobQueue<any>({ name: 'Own', logger: cap.logger });
            const to = (message: any, id: string): Promise<void> =>
                (own as any).imq.listeners('message')[0](message, id);

            own.onPop(() => {
                throw new Error('WRONGTYPE customer 000-00-0000');
            });
            await to({ job: { ssn: '000-00-0000' }, delay: 250 }, 'msg-42');

            assert.equal(cap.error.length, 1);
            assert.match(cap.error[0], /Error handling job/);
            assert.match(cap.error[0], /queue Own/);
            assert.match(cap.error[0], /message msg-42/);
            assert.match(cap.error[0], /code WRONGTYPE/);
            assert.match(cap.error[0], /retry in 250 ms/);
            assert.equal(cap.error[0].includes('000-00-0000'), false);

            await own.destroy();
        });

        it('should report every failure of a row, ids and decisions apart', async () => {
            const cap = capturing();
            const own = new JobQueue<any>({ name: 'Own', logger: cap.logger });
            const to = (message: any, id: string): Promise<void> =>
                (own as any).imq.listeners('message')[0](message, id);

            own.onPop(() => {
                throw new Error('WRONGTYPE nope');
            });
            // same failure code twice within one minute, different messages
            // and different retry decisions: both lines must be written -
            // on master every handler failure wrote a line, and keeping
            // that is what tells the two messages apart
            await to({ job: 'a' }, 'msg-50');
            await to({ job: 'b', delay: 100 }, 'msg-51');

            assert.equal(cap.error.length, 2);
            assert.match(cap.error[0], /message msg-50/);
            assert.match(cap.error[0], /no retry/);
            assert.match(cap.error[1], /message msg-51/);
            assert.match(cap.error[1], /retry in 100 ms/);

            await own.destroy();
        });

        it('should say a failed handler gets no retry when none is due', async () => {
            const cap = capturing();
            const own = new JobQueue<any>({ name: 'Own', logger: cap.logger });

            own.onPop(() => {
                throw new Error('Job error');
            });
            await (own as any).imq.listeners('message')[0](
                { job: 'x' },
                'msg-43',
            );

            assert.equal(cap.error.length, 1);
            assert.match(cap.error[0], /no retry/);

            await own.destroy();
        });

        it('should report every retry suppressed by an expired ttl', async () => {
            const cap = capturing();
            const own = new JobQueue<any>({ name: 'Own', logger: cap.logger });

            own.onPop(() => 1000);
            await (own as any).imq.listeners('message')[0](
                { job: 'x', expire: Date.now() - 1 },
                'msg-44',
            );
            await (own as any).imq.listeners('message')[0](
                { job: 'y', expire: Date.now() - 1 },
                'msg-45',
            );

            // one line per expired job, each with its own message id
            assert.equal(cap.info.length, 2);
            assert.match(cap.info[0], /retry suppressed, ttl expired/);
            assert.match(cap.info[0], /queue Own/);
            assert.match(cap.info[0], /message msg-44/);
            assert.match(cap.info[1], /message msg-45/);

            await own.destroy();
        });

        it('should stay quiet when an expired job asked for no retry', async () => {
            const cap = capturing();
            const own = new JobQueue<any>({ name: 'Own', logger: cap.logger });

            own.onPop(() => undefined);
            await (own as any).imq.listeners('message')[0](
                { job: 'x', expire: Date.now() - 1 },
                'msg-45',
            );

            assert.equal(cap.info.length, 0);
            assert.equal(cap.error.length, 0);

            await own.destroy();
        });

        it('should report a failed re-schedule and still let it escape', async () => {
            const error = sandbox.spy(logger, 'error');
            const failure = new Error('WRONGTYPE nope');

            sandbox.spy((queue as any).imq, 'send').rejects(failure);
            queue.onPop(() => 1000);

            await assert.rejects(
                () => deliver2({ job: 'x' }, 'msg-46'),
                (err: any) => err === failure,
            );

            const line = String(error.args[0]?.[0]);

            assert.match(line, /Job re-schedule failed/);
            assert.match(line, /message msg-46/);
            assert.match(line, /code WRONGTYPE/);
        });

        it('should write one line when one re-schedule failure comes twice', async () => {
            const error = sandbox.spy(logger, 'error');
            const send = sandbox.spy((queue as any).imq, 'send');

            queue.onPop(() => 1000);
            await deliver2({ job: 'x' }, 'msg-47');

            const report = send.args[0][3];

            assert.equal(typeof report, 'function');
            assert.doesNotThrow(() => report(new Error('OOM nope')));
            assert.doesNotThrow(() => report(new Error('OOM nope')));

            const lines = error.args.map((one: any[]) => String(one[0]));
            const matched = lines.filter((one: string) =>
                /Job re-schedule failed/.test(one),
            );

            assert.equal(
                matched.length,
                1,
                'a doubly-delivered failure must write one line',
            );
            assert.match(matched[0], /code OOM/);
        });

        it('should report every failed re-schedule separately', async () => {
            const error = sandbox.spy(logger, 'error');
            const send = sandbox.spy((queue as any).imq, 'send');

            queue.onPop(() => 1000);
            await deliver2({ job: 'x' }, 'msg-48');
            await deliver2({ job: 'y' }, 'msg-49');

            (send.args[0][3] as any)(new Error('OOM nope'));
            (send.args[1][3] as any)(new Error('OOM nope'));

            const lines = error.args.map((one: any[]) => String(one[0]));
            const matched = lines.filter((one: string) =>
                /Job re-schedule failed/.test(one),
            );

            // one line per failed re-schedule, each with its own message id
            assert.equal(matched.length, 2);
            assert.match(matched[0], /message msg-48/);
            assert.match(matched[1], /message msg-49/);
        });

        it('should keep every re-scheduling decision it made before', async () => {
            const send = sandbox.spy((queue as any).imq, 'send');

            // a zero delay is a re-schedule, not a falsy skip
            queue.onPop(() => 0);
            await deliver2({ job: 'a' }, 'm1');

            // a resolved promise is awaited and used
            queue.onPop(() => Promise.resolve(700));
            await deliver2({ job: 'b' }, 'm2');

            // a rejected promise falls back to the message's own delay
            queue.onPop(() => Promise.reject(new Error('boom')));
            await deliver2({ job: 'c', delay: 250 }, 'm3');

            // anything not a number is not a re-schedule
            queue.onPop(() => 'soon' as any);
            await deliver2({ job: 'd' }, 'm4');

            // a non-numeric ttl never suppresses anything
            queue.onPop(() => 900);
            await deliver2({ job: 'e', expire: 'yesterday' }, 'm5');

            assert.deepEqual(
                send.args.map((one: any[]) => one[2]),
                [0, 700, 250, 900],
            );
        });

        it('should not let a broken logger cancel a re-schedule', async () => {
            // named difference from the previous release: the line is written
            // through a contained writer, so a logger which throws no longer
            // takes the re-scheduling down with it
            const broken: any = {
                log: () => {},
                info: () => {},
                warn: () => {},
                error: () => {
                    throw new Error('logger is broken');
                },
            };
            const brokenQueue = new JobQueue<any>({
                name: 'Broken',
                logger: broken,
            });
            const send = makeSpy((brokenQueue as any).imq, 'send');

            brokenQueue.onPop(() => {
                throw new Error('Job error');
            });

            await (brokenQueue as any).imq.listeners('message')[0](
                { job: 'x', delay: 100 },
                'm6',
            );

            assert.equal(send.calledOnce, true);
            assert.equal(send.args[0][2], 100);

            send.restore();
            await brokenQueue.destroy();
        });

        it('should not re-schedule a job whose ttl has passed', async () => {
            const send = sandbox.spy((queue as any).imq, 'send');
            const handler = sandbox.spy();

            queue.onPop(handler as any);
            // expire is consulted only AFTER the handler runs, so an expired job
            // still runs once and only loses its re-scheduling
            await deliver({ job: 'x', expire: Date.now() - 1, delay: 10 });

            assert.equal(handler.calledOnce, true);
            assert.equal(send.called, false);
        });
    });
});
