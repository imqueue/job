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
import { logger } from './mocks';
import { expect } from 'chai';
import JobQueue from '..';
import * as sinon from 'sinon';

describe('JobQueue', () => {
    it('should be a class', () => {
        expect(typeof JobQueue).equals('function');
    });

    describe('constructor()', () => {
        it('should throw if name is not provided', () => {
            expect(() => new (JobQueue as any)()).to.throw;
        });

        it('should not throw if name provided as minimum options', () => {
            expect(() => new JobQueue({ name: 'Test' })).to.not.throw;
        });

        it('should use given logger', () => {
            const queue: any = new JobQueue({ name: 'Test', logger });
            expect(queue.logger).equals(logger);
        });

        it('should use console as default logger', () => {
            const queue: any = new JobQueue({ name: 'Test' });
            expect(queue.logger).equals(console);
        });
    });

    describe('name', () => {
        it('should match to given name', () => {
            expect(new JobQueue({ name: 'TestName' }).name).equals('TestName');
        });

        it('should be read-only', () => {
            const queue: any = new JobQueue({ name: 'Test' });

            expect(() => queue.name = 'TestName').to.throw;
        });
    });

    describe('start()', () => {
        let queue: JobQueue<any>;

        beforeEach(() => queue = new JobQueue<any>({ name: 'Test', logger }));
        afterEach(async () => await queue.destroy());

        it('should throw if handler is not set', async () => {
            let err: any;

            try { await queue.start() } catch(e) { err = e }

            expect(err).not.to.be.undefined;
        });

        it('should not throw if handler is set', async () => {
            let err: any;

            (queue as any).handler = () => {};
            try { await queue.start() } catch(e) { err = e }

            expect(err).to.be.undefined;
        });

        it('should return this queue', async () => {
            (queue as any).handler = () => {};

            const res = await queue.start();

            expect(res).equals(queue);
        });

        it('should actually start', async () => {
            const spy = sinon.spy((queue as any).imq, 'start');

            (queue as any).handler = () => {};
            await queue.start();

            expect(spy.calledOnce).to.be.true;
            spy.restore();
        });
    });

    describe('stop()', () => {
        let queue: JobQueue<any>;

        beforeEach(() => queue = new JobQueue<any>({ name: 'Test', logger }));
        afterEach(async () => await queue.destroy());

        it('should return this queue', async () => {
            const res = await queue.stop();

            expect(res).equals(queue);
        });

        it('should actually stop', async () => {
            const spy = sinon.spy((queue as any).imq, 'stop');

            await queue.stop();

            expect(spy.calledOnce).to.be.true;
            spy.restore();
        });
    });

    describe('destroy()', () => {
        let queue: JobQueue<any>;

        beforeEach(() => queue = new JobQueue<any>({ name: 'Test', logger }));
        afterEach(async () => await queue.destroy());

        it('should return undefined', async () => {
            const res = await queue.destroy();

            expect(res).to.be.undefined;
        });

        it('should actually destroy', async () => {
            const spy = sinon.spy((queue as any).imq, 'destroy');

            await queue.destroy();

            expect(spy.calledOnce).to.be.true;
            spy.restore();
        });
    });

    describe('push()', () => {
        let queue: JobQueue<any>;

        beforeEach(() => queue = new JobQueue<any>({ name: 'Test', logger }));
        afterEach(async () => await queue.destroy());

        it('should throw if handler is not set', async () => {
            let err: any;

            try { await queue.push('') } catch(e) { err = e }

            expect(err).not.to.be.undefined;
        });

        it('should not throw if handler is set', async () => {
            let err: any;

            (queue as any).handler = () => {};
            try { await queue.push('') } catch(e) { err = e }

            expect(err).to.be.undefined;
        });

        it('should actually push', async () => {
            const spy = sinon.spy((queue as any).imq, 'send');

            (queue as any).handler = () => {};
            await queue.push('');

            expect(spy.calledOnce).to.be.true;
            spy.restore();
        });

        it('should actually push with given ttl and delay', async () => {
            const spy = sinon.spy((queue as any).imq, 'send');

            (queue as any).handler = () => {};
            const now = Date.now();
            await queue.push('', { ttl: 100, delay: 10 });
            const [[name, { job, expire, delay }, jobDelay]] = spy.args;

            expect(name).equals('Test');
            expect(job).equals('');
            expect(expire).lte(now + 101);
            expect(expire).gte(now + 100);
            expect(delay).equals(10);
            expect(jobDelay).equals(10);

            spy.restore();
        });
    });

    describe('onPop', () => {
        let queue: JobQueue<any>;

        beforeEach(() => queue = new JobQueue<any>({ name: 'Test', logger }));
        afterEach(async () => await queue.destroy());

        it('should properly set handler', () => {
            const handler = () => {};

            queue.onPop(handler);
            queue.onPop(handler);

            expect((queue as any).handler).equals(handler);
            expect((queue as any).imq.listenerCount('message')).equals(1);
        });

        // todo: add more coverage
    });
});
