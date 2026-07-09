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
import { spy as makeSpy } from './mocks/spy.js';
import './mocks/index.js';
import { logger } from './mocks/index.js';
import JobQueue from '../index.js';

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

        // todo: add more coverage
    });
});
