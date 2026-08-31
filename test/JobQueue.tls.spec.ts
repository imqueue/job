/*!
 * TLS on the broker connection of a job queue
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
import './mocks/index.js';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import JobQueue, { JobQueuePublisher, JobQueueWorker } from '../index.js';
import { logger } from './mocks/index.js';

const CA = Buffer.from('-----BEGIN CERTIFICATE-----\nCA\n');

const VARS = [
    'IMQ_REDIS_TLS',
    'IMQ_REDIS_TLS_CA_FILE',
    'IMQ_REDIS_TLS_SERVERNAME',
];

describe('JobQueue TLS', () => {
    afterEach(() => {
        for (const name of VARS) {
            delete process.env[name];
        }
    });

    it('should carry TLS through to the underlying queue', async () => {
        const queue: any = new JobQueue({
            name: 'TlsJob',
            logger,
            tls: { ca: CA },
        });

        assert.deepEqual(queue.imq.options.tls, { ca: CA });

        await queue.destroy();
    });

    it('should accept the bare `true` form', async () => {
        const queue: any = new JobQueue({
            name: 'TlsJobTrue',
            logger,
            tls: true,
        });

        assert.equal(queue.imq.options.tls, true);

        await queue.destroy();
    });

    it('should carry it on a publisher and a worker alike', async () => {
        // all three constructors funnel through the same option mapping, and
        // a publisher that talks to the broker in the clear while its worker
        // does not would be a strange thing to ship
        const publisher: any = new JobQueuePublisher({
            name: 'TlsPub',
            logger,
            tls: { ca: CA },
        });
        const worker: any = new JobQueueWorker({
            name: 'TlsPub',
            logger,
            tls: { ca: CA },
        });

        assert.deepEqual(publisher.imq.options.tls, { ca: CA });
        assert.deepEqual(worker.imq.options.tls, { ca: CA });

        await publisher.destroy();
        await worker.destroy();
    });

    it('should leave the option unset when nothing asks for it', async () => {
        // it must stay absent rather than become an explicit undefined, or the
        // queue layer would have nothing to distinguish "not configured" from
        // "configured off" and its environment fallback could not run
        const queue: any = new JobQueue({ name: 'TlsJobNone', logger });
        const imq = queue.imq.imqs ? queue.imq.imqs[0] : queue.imq;

        assert.equal('tls' in imq.options, false);

        await queue.destroy();
    });

    it('should leave a queue that never asked for it untouched', async () => {
        // the guarantee for everyone who does not use this feature: the option
        // is absent, not present-and-undefined, so nothing they can observe
        // about the queue changes because it exists
        const queue: any = new JobQueue({ name: 'TlsJobPlain', logger });
        const imq = queue.imq.imqs ? queue.imq.imqs[0] : queue.imq;

        assert.equal('tls' in imq.options, false);

        await queue.destroy();
    });

    it('should be unaffected by unrelated IMQ_ variables', async () => {
        process.env.IMQ_REDIS_TLS_SERVERNAME = 'redis.internal';

        const queue: any = new JobQueue({ name: 'TlsJobUnrelated', logger });
        const imq = queue.imq.imqs ? queue.imq.imqs[0] : queue.imq;

        assert.equal('tls' in imq.options, false);

        await queue.destroy();
    });

    it('should pick TLS up from the environment', async () => {
        process.env.IMQ_REDIS_TLS = '1';

        const queue: any = new JobQueue({ name: 'TlsJobEnv', logger });

        assert.deepEqual(queue.imq.options.tls, {});

        await queue.destroy();
    });

    it('should let an explicit `false` decline the environment', async () => {
        process.env.IMQ_REDIS_TLS = '1';

        const queue: any = new JobQueue({
            name: 'TlsJobOff',
            logger,
            tls: false,
        });

        assert.equal(queue.imq.options.tls, false);

        await queue.destroy();
    });
});
