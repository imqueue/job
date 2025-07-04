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
